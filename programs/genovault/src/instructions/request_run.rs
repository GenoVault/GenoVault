use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::GenoVaultError;
use crate::state::{
    dataset_cost, Consent, Dataset, PlatformConfig, Run, RunStatus, MAX_RUN_DATASETS,
};

/// Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`) — `T024`.
///
/// # Чому це одна транзакція
///
/// Склад прогону їде в `remaining_accounts` парами «датасет + його чинна
/// згода», і пул на 50 датасетів — це 100 акаунтів, тобто транзакція з
/// таблицею пошуку адрес. Порційне складання прогону кількома транзакціями
/// коштувало б дешевше клієнту й дорожче змісту: `FR-007` каже, що відкликання
/// діє на прогони, **замовлені після нього**, а `SC-005` міряє це в секундах.
/// Замовлення, розтягнуте на чотири транзакції, робить «замовлений після»
/// питанням без однієї відповіді — власник відкликає згоду між порціями, і
/// половина пулу перевірена за старим станом.
///
/// # Що саме перевіряється
///
/// Згода перевіряється тут, а не при публікації в MPC, з тієї ж причини: момент
/// замовлення має бути точкою. Публікація (`T025`) читає вже перевірений `Run`.
///
/// Ціну й обсяг бере програма з акаунтів датасетів, а не з аргументів: число,
/// яке передав би покупець, він же й занизив би. Покупець передає лише стелю
/// `max_escrow` — і це не формальність, а захист від того, що власник підняв
/// ціну між квотою і підписом: транзакція має впасти, а не мовчки списати
/// більше, ніж покупець бачив.
///
/// # Чого тут немає
///
/// Перевірки, що шифротекст лежить у сховищі: програма про сховище не знає й
/// знати не може. Її робить квота (`ciphertext-missing`), а прогін по датасету
/// без байтів впаде на публікації й поверне депозит повністю (`FR-016`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RequestRunArgs {
    /// Обраний покупцем; він же в seeds, тож два прогони не сплутати.
    pub nonce: u64,
    pub recipe_id: u16,
    pub use_type: u32,
    pub buyer_category: u32,
    /// Стеля, вище якої покупець не згоден. Зазвичай — число з квоти.
    pub max_escrow: u64,
}

/// Каталог рецептів на боці програми (`FR-011a`).
///
/// Список, а не діапазон: рецепт існує тоді, коли для нього розгорнуте
/// визначення обчислення, і «будь-який номер до N» дозволив би замовити прогін
/// за номером, якому не відповідає жоден контур. Дзеркало
/// `packages/shared/src/recipes.ts`.
pub const RECIPE_FREQUENCIES: u16 = 1;
pub const KNOWN_RECIPES: [u16; 1] = [RECIPE_FREQUENCIES];

#[derive(Accounts)]
#[instruction(args: RequestRunArgs)]
pub struct RequestRun<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [PlatformConfig::SEED], bump = config.bump)]
    pub config: Account<'info, PlatformConfig>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Run::INIT_SPACE,
        seeds = [Run::SEED, buyer.key().as_ref(), &args.nonce.to_le_bytes()],
        bump,
    )]
    pub run: Account<'info, Run>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = buyer,
        token::token_program = token_program,
    )]
    pub buyer_tokens: InterfaceAccount<'info, TokenAccount>,
    /// Сейф платформи. Один на всі прогони — див. `PlatformConfig::VAULT_SEED`.
    #[account(
        mut,
        seeds = [PlatformConfig::VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: [dataset_0, consent_0, dataset_1, consent_1, …]
}

/// Прогін прийнято: склад, умови й заблокована сума — усе публічне.
///
/// Подія несе рівно те, чим третя сторона звіряє журнал із мережею (`FR-025`),
/// і нічого понад: складу пулу й суми депозиту вистачає, щоб перерахувати
/// розподіл, коли він настане.
#[event]
pub struct RunRequested {
    pub run: Pubkey,
    pub buyer: Pubkey,
    pub nonce: u64,
    pub recipe_id: u16,
    pub use_type: u32,
    pub buyer_category: u32,
    pub datasets: Vec<Pubkey>,
    pub fee_bps: u16,
    pub escrow_amount: u64,
    pub created_at: i64,
}

pub fn request<'info>(
    ctx: Context<'info, RequestRun<'info>>,
    args: RequestRunArgs,
) -> Result<()> {
    let config = &ctx.accounts.config;

    // Пауза зупиняє нові прогони, а не вже прийняті: інакше вона стала б
    // способом не платити власникам за виконану роботу.
    require!(!config.paused, GenoVaultError::PlatformPaused);
    require!(
        KNOWN_RECIPES.contains(&args.recipe_id),
        GenoVaultError::UnknownRecipe
    );

    let infos = ctx.remaining_accounts;
    // Непарна кількість означає, що клієнт загубив згоду або датасет. Далі це
    // виявилось би зсувом на одиницю: згода одного датасету перевірилась би
    // проти сусіднього.
    require!(
        !infos.is_empty() && infos.len() % 2 == 0,
        GenoVaultError::RunAccountsMalformed
    );
    require!(
        infos.len() / 2 <= MAX_RUN_DATASETS,
        GenoVaultError::RunTooManyDatasets
    );

    let now = Clock::get()?.unix_timestamp;
    let mut datasets: Vec<Pubkey> = Vec::with_capacity(infos.len() / 2);
    let mut escrow: u64 = 0;

    for pair in infos.chunks_exact(2) {
        // `Account::try_from` перевіряє власника акаунта й дискримінатор, тобто
        // що це справді наш `Dataset`, а не чужі байти потрібної довжини.
        // Seeds тут не перераховуються навмисно: автентичність стану дає
        // власник акаунта, а зайва деривація на 50 датасетах коштує CU.
        let dataset: Account<Dataset> = Account::try_from(&pair[0])?;
        let consent: Account<Consent> = Account::try_from(&pair[1])?;

        require!(dataset.is_active(), GenoVaultError::DatasetNotActive);
        require!(
            dataset.consent_version != 0,
            GenoVaultError::ConsentMissing
        );
        // Прив'язка згоди до датасету — не формальність: без неї покупець
        // підсунув би дозвільну згоду чужого датасету й пройшов би перевірку,
        // якої власник цих даних не давав.
        require!(
            consent.dataset == dataset.key(),
            GenoVaultError::ConsentDatasetMismatch
        );
        // Саме чинна версія, а не будь-яка з ланцюга: історія лишається
        // читною (`FR-005`), і стара, дозвільніша згода вічно лежить поруч.
        require!(
            consent.version == dataset.consent_version,
            GenoVaultError::ConsentVersionStale
        );

        consent.check(now, args.use_type, args.buyer_category)?;

        escrow = escrow
            .checked_add(dataset_cost(
                dataset.price_per_1k,
                dataset.record_count_claimed,
            )?)
            .ok_or(GenoVaultError::RunEscrowOverflow)?;
        datasets.push(dataset.key());
    }

    // Порожній склад, перебір і дублікат — усе тут. Дублікат заплатив би
    // одному власнику двічі за той самий вміст і зламав би `SC-006`.
    Run::validate_datasets(&datasets)?;

    require!(
        escrow <= args.max_escrow,
        GenoVaultError::RunEscrowAboveMax
    );

    // Переказ **після** всіх перевірок: транзакція атомарна, але порядок читає
    // людина, і «спершу взяли гроші, потім подивились» — не той порядок.
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        escrow,
        ctx.accounts.mint.decimals,
    )?;

    let run_key = ctx.accounts.run.key();
    let buyer = ctx.accounts.buyer.key();

    ctx.accounts.run.set_inner(Run {
        buyer,
        nonce: args.nonce,
        recipe_id: args.recipe_id,
        use_type: args.use_type,
        buyer_category: args.buyer_category,
        datasets: datasets.clone(),
        // Копія комісії, а не посилання на конфігурацію: інакше зміна комісії
        // переписувала б умови вже замовленого прогону (`FR-019`).
        fee_bps: config.fee_bps,
        escrow_amount: escrow,
        settled_count: 0,
        settled_amount: 0,
        status: RunStatus::Accepted,
        result_hash: None,
        created_at: now,
        bump: ctx.bumps.run,
    });

    emit!(RunRequested {
        run: run_key,
        buyer,
        nonce: args.nonce,
        recipe_id: args.recipe_id,
        use_type: args.use_type,
        buyer_category: args.buyer_category,
        datasets,
        fee_bps: config.fee_bps,
        escrow_amount: escrow,
        created_at: now,
    });
    Ok(())
}

/// Створення сейфа платформи — одноразово, після `initialize`.
///
/// Окремою інструкцією, а не всередині `initialize`, навмисно: `initialize`
/// свідомо не тягне `anchor-spl` і перевіряє мінт лише за власником акаунта.
/// Об'єднати їх означало б переписати вже закриту інструкцію заради економії
/// одного виклику в скрипті розгортання.
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [PlatformConfig::SEED],
        bump = config.bump,
        has_one = authority,
        has_one = mint,
    )]
    pub config: Account<'info, PlatformConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [PlatformConfig::VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub mint: Pubkey,
}

pub fn create_vault(ctx: Context<InitializeVault>) -> Result<()> {
    emit!(VaultInitialized {
        vault: ctx.accounts.vault.key(),
        mint: ctx.accounts.mint.key(),
    });
    Ok(())
}
