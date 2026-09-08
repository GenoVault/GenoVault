use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::GenoVaultError;
pub use instructions::*;
pub use state::*;

// Зсуви решти трьох контурів (`frequencies_fold`, `frequencies_close_dataset`,
// `frequencies_reveal`) з'являться разом зі своїми чергами й callback'ами у
// `T025`-`T026`: константа без користувача — це попередження в кожній збірці,
// а не заготовка.
const COMP_DEF_OFFSET_FREQUENCIES_INIT: u32 = comp_def_offset("frequencies_init");

declare_id!("9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb");

/// Програма GenoVault.
///
/// Рецепт «частоти й розподіли» (`T018`, `T019`) живе в `encrypted-ixs`
/// чотирма контурами, і тут розгортаються їхні визначення обчислень. Виклик
/// `frequencies_init` поки не належить жодному прогону — він доводить, що
/// ланцюг «черга обчислень → вузли → callback» замикається на цьому
/// репозиторії. Замовлення прогону з перевіркою згоди й депозитом приходить
/// у `T024`, згортка батчів і розкриття — у `T025`-`T026`.
#[arcium_program]
pub mod genovault {
    use super::*;

    /// Одноразове розгортання платформи (`FR-019`).
    ///
    /// Повторний виклик падає на `init`: конфігурація існує в єдиному
    /// екземплярі, і мовчазне перезаписування комісії було б рівно тим, від
    /// чого захищає межа `MAX_FEE_BPS`.
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        instructions::initialize::handler(ctx, fee_bps)
    }

    /// Реєстрація датасету (`FR-001`, `FR-003`).
    pub fn register_dataset(
        ctx: Context<RegisterDataset>,
        args: RegisterDatasetArgs,
    ) -> Result<()> {
        instructions::dataset::register(ctx, args)
    }

    /// Нова версія вмісту (`FR-003`). Стара не зникає: на неї посилаються
    /// прогони, що вже пройшли, і подія в журналі.
    pub fn update_dataset_content(
        ctx: Context<UpdateDataset>,
        content_hash: [u8; 32],
        record_count_claimed: u64,
    ) -> Result<()> {
        instructions::dataset::update_content(ctx, content_hash, record_count_claimed)
    }

    /// Ціна за 1000 записів (`FR-015`).
    pub fn set_dataset_price(ctx: Context<UpdateDataset>, price_per_1k: u64) -> Result<()> {
        instructions::dataset::set_price(ctx, price_per_1k)
    }

    /// Зняття датасету з каталогу. Акаунт лишається — на нього посилаються
    /// завершені прогони.
    pub fn retire_dataset(ctx: Context<UpdateDataset>) -> Result<()> {
        instructions::dataset::retire(ctx)
    }

    /// Нова версія згоди (`FR-005`). Попередня лишається окремим акаунтом,
    /// на який посилається нова.
    pub fn set_consent(ctx: Context<SetConsent>, args: SetConsentArgs) -> Result<()> {
        instructions::consent::set(ctx, args)
    }

    /// Відкликання згоди однією дією (`FR-007`). Діє на прогони, замовлені
    /// після нього; завершені лишаються дійсними.
    pub fn revoke_consent(ctx: Context<RevokeConsent>) -> Result<()> {
        instructions::consent::revoke(ctx)
    }

    /// Сейф платформи — токен-акаунт під депозити (`FR-016`). Одноразово,
    /// після `initialize`.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::request_run::create_vault(ctx)
    }

    /// Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`).
    ///
    /// Склад пулу їде в `remaining_accounts` парами «датасет + чинна згода».
    /// Одна транзакція, бо момент замовлення має бути точкою: `FR-007` каже,
    /// що відкликання діє на прогони, замовлені **після** нього.
    pub fn request_run<'info>(
        ctx: Context<'info, RequestRun<'info>>,
        args: RequestRunArgs,
    ) -> Result<()> {
        instructions::request_run::request(ctx, args)
    }

    /// Розгортання визначення обчислення для `frequencies_init`.
    ///
    /// Визначень чотири, бо в Arcium кожен контур — окремий акаунт, і без
    /// нього обчислення не поставити в чергу. Розгортаються один раз на мережу.
    pub fn init_frequencies_init_comp_def(ctx: Context<InitFrequenciesInitCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    /// Визначення для `frequencies_fold` — згортки батча записів.
    pub fn init_frequencies_fold_comp_def(ctx: Context<InitFrequenciesFoldCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    /// Визначення для `frequencies_close_dataset` — оголошення внеску датасету.
    pub fn init_frequencies_close_dataset_comp_def(
        ctx: Context<InitFrequenciesCloseDatasetCompDef>,
    ) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    /// Визначення для `frequencies_reveal` — розкриття звіту покупцю.
    pub fn init_frequencies_reveal_comp_def(
        ctx: Context<InitFrequenciesRevealCompDef>,
    ) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    /// Створює порожній накопичувач частот.
    ///
    /// Прогону ця інструкція поки не належить: `Run`, перевірка згоди й
    /// депозит приходять у `T024`, згортка батчів і розкриття — у
    /// `T025`-`T026`. Вона стоїть тут із тієї ж причини, з якої тут раніше
    /// стояв каркасний `probe_sum`: доводить, що ланцюг «програма → черга
    /// обчислень → MPC-вузли → callback» замикається на цьому репозиторії.
    /// Різниця в тому, що тепер це справжній рецепт із каталогу, а не
    /// заглушка, яка додає два числа.
    pub fn frequencies_init(ctx: Context<FrequenciesInit>, computation_offset: u64) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Аргументів немає: порожній накопичувач залежить тільки від форми
        // рецепта, а її знає сам контур.
        queue_computation(
            ctx.accounts,
            computation_offset,
            ArgBuilder::new().build(),
            vec![FrequenciesInitCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "frequencies_init")]
    pub fn frequencies_init_callback(
        ctx: Context<FrequenciesInitCallback>,
        output: SignedComputationOutputs<FrequenciesInitOutput>,
    ) -> Result<()> {
        // Підпис кластера перевіряється до того, як результат кудись піде:
        // без цього будь-хто міг би підсунути свій накопичувач замість MPC.
        let verified = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(FrequenciesInitOutput { field_0 }) => field_0,
            Err(_) => return Err(GenoVaultError::AbortedComputation.into()),
        };

        emit!(AccumulatorCreated {
            nonce: verified.nonce.to_le_bytes(),
            ciphertexts: verified.ciphertexts,
        });
        Ok(())
    }
}

#[queue_computation_accounts("frequencies_init", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FrequenciesInit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_INIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("frequencies_init")]
#[derive(Accounts)]
pub struct FrequenciesInitCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_INIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: адресу перевіряє програма Arcium; verify_output читає з неї дані слота.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: перевіряється обмеженням address.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("frequencies_init", payer)]
#[derive(Accounts)]
pub struct InitFrequenciesInitCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: перевіряє програма Arcium; тут акаунт ще не ініціалізований.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: перевіряє програма Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: програма таблиць пошуку адрес.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("frequencies_fold", payer)]
#[derive(Accounts)]
pub struct InitFrequenciesFoldCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: перевіряє програма Arcium; тут акаунт ще не ініціалізований.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: перевіряє програма Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: програма таблиць пошуку адрес.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("frequencies_close_dataset", payer)]
#[derive(Accounts)]
pub struct InitFrequenciesCloseDatasetCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: перевіряє програма Arcium; тут акаунт ще не ініціалізований.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: перевіряє програма Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: програма таблиць пошуку адрес.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("frequencies_reveal", payer)]
#[derive(Accounts)]
pub struct InitFrequenciesRevealCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: перевіряє програма Arcium; тут акаунт ще не ініціалізований.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: перевіряє програма Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: програма таблиць пошуку адрес.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Порожній накопичувач, зашифрований ключем MXE.
///
/// Розшифрувати його не може ніхто, крім кластера: подія існує, щоб клієнт мав
/// що передати першій згортці, а не щоб хтось прочитав вміст.
#[event]
pub struct AccumulatorCreated {
    pub nonce: [u8; 16],
    pub ciphertexts: [[u8; 32]; 24],
}
