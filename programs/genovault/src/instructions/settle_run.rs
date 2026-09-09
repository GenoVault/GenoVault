use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::GenoVaultError;
use crate::instructions::dispatch::abort_computation;
use crate::state::{
    gross_for, platform_fee, Dataset, OwnerBalance, PlatformConfig, Run, RunAccumulator, RunResult,
    RunStatus, REPORT_CIPHERTEXTS,
};
use crate::{ArciumSignerAccount, ID, ID_CONST};

/// Розкриття звіту й розподіл плати (`T026`, `FR-014`, `FR-016`, `FR-018b`).
///
/// # Чому це три інструкції, а не одна
///
/// Розкриття — обчислення в Arcium, і його результат приходить окремою
/// транзакцією через callback. Нарахування — 50 власників, і в одну транзакцію
/// вони не вміщаються. Повернення різниці — переказ, який має статись рівно
/// один раз і рівно після того, як усі нарахування зроблені. Три різні події,
/// три різні набори шляхів відмови:
///
/// 1. `dispatch_reveal` — диспетчер ставить в чергу четвертий контур рецепта.
///    Дозволено лише коли пул вичерпано: розкрити звіт, не закривши останній
///    датасет, означало б заплатити всім, крім його власника.
/// 2. `frequencies_reveal_callback` — MPC повертає звіт під ключем покупця,
///    розмір когорти й сторожа `unclosed`. Програма кладе звіт у `RunResult`,
///    записує число, за яким рахуватиме оплату, і більше нічого не рухає.
/// 3. `settle_dataset` × N, далі `finalize_run` — гроші.
///
/// # Чому callback не рухає грошей
///
/// Callback приходить транзакцією, яку складає не наш клієнт. Токен-переказ у
/// ньому означав би, що закритий ATA покупця або відсутній акаунт балансу
/// власника валить callback цілком — накопичувач лишається зайнятим, прогін
/// висить у `running`, і депозит не повертається ніколи. Тому callback лише
/// записує числа: усе, що може не скластися, роблять окремі інструкції, які
/// можна повторити.
///
/// # Хто це кличе
///
/// `settle_dataset` і `finalize_run` — **будь-хто**. Вони не мають жодного
/// вибору: суми рахуються з `Run` чистими функціями, гроші йдуть на баланс
/// власника датасету й на токен-акаунт покупця, і зловмисник, який покличе їх
/// усі, зробить рівно те, чого від нього хотіли. Право підпису тут захищало б
/// не гроші, а тільки можливість тягнути з виплатою.

pub const COMP_DEF_OFFSET_FREQUENCIES_REVEAL: u32 = comp_def_offset("frequencies_reveal");

// ── Події ───────────────────────────────────────────────────────────────────

/// Звіт готовий: покупець може його забрати, програма — рахувати оплату.
#[event]
pub struct RunRevealed {
    pub run: Pubkey,
    pub records_included: u32,
    pub suppressed: bool,
    pub result_hash: [u8; 32],
}

/// Нарахування одному власнику (`FR-018b`).
///
/// Несе всі три числа, з яких порахована частка, а не тільки підсумок: `FR-018`
/// прямо вимагає, щоб власник бачив, з чого вона вийшла. Без `records_included`
/// прогону «мій внесок — 1 000 записів» не пояснює нічого.
#[event]
pub struct DatasetSettled {
    pub run: Pubkey,
    pub dataset: Pubkey,
    pub owner: Pubkey,
    pub records_included: u32,
    pub run_records_included: u32,
    pub price_per_1k: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

/// Прогін закрито: всім нараховано, різницю повернуто (`SC-006`).
#[event]
pub struct RunCompleted {
    pub run: Pubkey,
    pub settled_amount: u64,
    pub refunded: u64,
}

/// Розкриття повернулось зі сторожем `unclosed = 1`.
///
/// Означає, що останній датасет пулу не закрито в MPC: його записи вже в
/// когорті, але внеску на них ніхто не оголосив, і частка мовчки розтеклася б
/// між рештою власників. Ончейн ми цього не допускаємо (`dispatch_reveal`
/// вимагає вичерпаного пулу), тож сюди можна потрапити тільки якщо ончейн-облік
/// розійшовся з тим, що рахував рецепт. Платити з таких чисел не можна — прогін
/// іде в `failed`, депозит повертається повністю (`FR-016`).
#[event]
pub struct RunRevealRefused {
    pub run: Pubkey,
    pub computation: Pubkey,
    pub unclosed: u32,
}

// ── Публікація: розкриття звіту ─────────────────────────────────────────────

#[queue_computation_accounts("frequencies_reveal", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DispatchReveal<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    /// Акаунт під звіт створюється тут, до постановки в чергу: callback
    /// платника не має, а віддавати результат нікуди — це втратити прогін, за
    /// який уже заплачено.
    ///
    /// `init`, а не `init_if_needed`: другого розкриття не буває. Невдале
    /// обчислення переводить прогін у `failed` (`accept_reveal`), а зайнятий
    /// накопичувач не дає поставити в чергу ще одне — тож акаунт або
    /// створюється один раз, або не створюється взагалі. Два `init_if_needed` в
    /// одній структурі до того ж не вміщаються в 4 КіБ кадру `try_accounts` на
    /// SBF, і збірка каже про це рядком «overwrites values in the frame».
    #[account(
        init,
        payer = payer,
        space = 8 + RunResult::INIT_SPACE,
        seeds = [RunResult::SEED, run.key().as_ref()],
        bump,
    )]
    pub result: Box<Account<'info, RunResult>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_REVEAL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    // Обидва в `Box`, на відміну від сусідніх черг: ця структура несе на один
    // акаунт більше (`result`), і `try_accounts` на SBF виходить за 4 КіБ
    // кадру. Збірка каже про це рядком «overwrites values in the frame», і це
    // не попередження про стиль, а невизначена поведінка в мережі.
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn queue_reveal(ctx: Context<DispatchReveal>, computation_offset: u64) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    ctx.accounts.accumulator.require_ready()?;
    require!(
        ctx.accounts.run.status == RunStatus::Running,
        GenoVaultError::RunNotRunning
    );
    // Пул мусить бути вичерпаний: незакритий датасет означає записи в когорті,
    // на які ніхто не оголосив внеску. Той самий сторож стоїть і всередині
    // рецепта (`unclosed`) — тут він ловить помилку до того, як за неї
    // заплатять обчисленням.
    require!(
        ctx.accounts.run.pool_exhausted(),
        GenoVaultError::RunPoolNotExhausted
    );
    require!(
        ctx.accounts.run.result_hash.is_none(),
        GenoVaultError::RunRevealAlreadyDone
    );

    let run_key = ctx.accounts.run.key();
    ctx.accounts.result.run = run_key;
    ctx.accounts.result.bump = ctx.bumps.result;

    let computation = ctx.accounts.computation_account.key();
    ctx.accounts.accumulator.arm(computation)?;

    // Порядок аргументів дублює сигнатуру `frequencies_reveal`: накопичувач і
    // ключ читача. Ключ — із `Run`, тобто від покупця й із моменту замовлення:
    // аргументом публікації диспетчер зашифрував би звіт на себе.
    let mut args = ArgBuilder::new().plaintext_u128(ctx.accounts.accumulator.nonce);
    for ciphertext in ctx.accounts.accumulator.ciphertexts.iter() {
        args = args.encrypted_u128(*ciphertext);
    }
    let args = args.x25519_pubkey(ctx.accounts.run.buyer_x25519).build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![FrequenciesRevealCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &reveal_callback_accounts(
                run_key,
                ctx.accounts.accumulator.key(),
                ctx.accounts.result.key(),
            ),
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

// ── Callback розкриття ──────────────────────────────────────────────────────

#[callback_accounts("frequencies_reveal")]
#[derive(Accounts)]
pub struct FrequenciesRevealCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_REVEAL))]
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
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    #[account(
        mut,
        seeds = [RunResult::SEED, run.key().as_ref()],
        bump = result.bump,
        constraint = result.run == run.key() @ GenoVaultError::RunResultForeignRun,
    )]
    pub result: Box<Account<'info, RunResult>>,
}

/// Стан, який має право міняти callback розкриття.
///
/// Три акаунти замість двох: `RunResult` приймає сам звіт. Порядок той самий,
/// у якому вони оголошені в `FrequenciesRevealCallback` — `callback_ix` додає
/// їх після своїх шести обов'язкових.
fn reveal_callback_accounts(run: Pubkey, accumulator: Pubkey, result: Pubkey) -> [CallbackAccount; 3] {
    [
        CallbackAccount {
            pubkey: run,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: accumulator,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: result,
            is_writable: true,
        },
    ]
}

/// Звіт повернувся з MPC.
///
/// Накопичувач тут **звільняється, а не оновлюється**: розкриття його не
/// змінює — воно читає. Після цього прогін уже має результат, і другого
/// розкриття не буде: `result_hash` не порожній.
///
/// `unclosed = 1` — не «дивне число», а свідчення, що ончейн-облік розійшовся з
/// тим, що рахував рецепт. Платити з таких чисел не можна, і мовчки округлити
/// їх нема куди: прогін іде в `failed`, звідки депозит повертається повністю.
pub fn accept_reveal(
    run_key: Pubkey,
    run: &mut Run,
    accumulator: &mut RunAccumulator,
    result: &mut RunResult,
    computation: Pubkey,
    outcome: Option<([u8; 32], u128, [[u8; 32]; REPORT_CIPHERTEXTS], u32, u32)>,
) -> Result<()> {
    let Some((encryption_key, nonce, ciphertexts, records_included, unclosed)) = outcome else {
        return abort_computation(run_key, run, accumulator, computation);
    };

    accumulator.release(computation)?;

    if unclosed != 0 {
        run.fail()?;
        emit!(RunRevealRefused {
            run: run_key,
            computation,
            unclosed,
        });
        return Ok(());
    }

    let result_hash = RunResult::digest(&encryption_key, nonce, &ciphertexts);
    // Числа лягають у `Run` першими: якщо когорта й внески не сходяться, звіт
    // не має права стати результатом, за який хтось заплатить.
    let suppressed = records_included == 0;
    run.record_reveal(result_hash, records_included, suppressed)?;

    result.encryption_key = encryption_key;
    result.nonce = nonce;
    result.ciphertexts = ciphertexts;
    result.records_included = records_included;
    result.suppressed = suppressed;

    emit!(RunRevealed {
        run: run_key,
        records_included,
        suppressed,
        result_hash,
    });
    Ok(())
}

// ── Нарахування власнику ────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(index: u32)]
pub struct SettleDataset<'info> {
    /// Платить за акаунти балансів, якщо їх ще немає. Підпис тут не дає жодних
    /// прав: суми рахуються з `Run`, і покликати це може будь-хто.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [PlatformConfig::SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    /// Датасет із того самого рядка прогону. Потрібен рівно заради власника:
    /// ціна й внесок уже лежать у `Run` і навмисно не перечитуються звідси —
    /// власник вільний змінити ціну після замовлення, а умови прогону — ні.
    #[account(
        constraint = run
            .datasets
            .get(index as usize)
            .map(|entry| entry.dataset)
            == Some(dataset.key()) @ GenoVaultError::RunDatasetMismatch,
    )]
    pub dataset: Box<Account<'info, Dataset>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + OwnerBalance::INIT_SPACE,
        seeds = [OwnerBalance::SEED, dataset.owner.as_ref()],
        bump,
    )]
    pub owner_balance: Box<Account<'info, OwnerBalance>>,
    /// Комісія платформи лягає на такий самий баланс, як у власника даних:
    /// окремий шлях для неї був би місцем, де платформа рухає гроші не так, як
    /// усі.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + OwnerBalance::INIT_SPACE,
        seeds = [OwnerBalance::SEED, config.authority.as_ref()],
        bump,
    )]
    pub platform_balance: Box<Account<'info, OwnerBalance>>,
    pub system_program: Program<'info, System>,
}

pub fn settle(ctx: Context<SettleDataset>, index: u32) -> Result<()> {
    let index = index as usize;
    let run_key = ctx.accounts.run.key();

    let gross = gross_for(&ctx.accounts.run, index)?;
    let fee = platform_fee(gross, ctx.accounts.run.fee_bps)?;
    // Частка власника — відніманням, а не другим множенням: інакше залишок від
    // ділення зник би, і `SC-006` не зійшовся б на одну одиницю.
    let net = gross - fee;

    ctx.accounts.run.settle(index, gross)?;

    let owner_balance = &mut ctx.accounts.owner_balance;
    owner_balance.owner = ctx.accounts.dataset.owner;
    owner_balance.bump = ctx.bumps.owner_balance;
    owner_balance.accrue(net)?;

    let platform_balance = &mut ctx.accounts.platform_balance;
    platform_balance.owner = ctx.accounts.config.authority;
    platform_balance.bump = ctx.bumps.platform_balance;
    platform_balance.accrue(fee)?;

    let entry = ctx.accounts.run.datasets[index];
    emit!(DatasetSettled {
        run: run_key,
        dataset: entry.dataset,
        owner: ctx.accounts.dataset.owner,
        records_included: entry.records_included,
        run_records_included: ctx.accounts.run.records_included,
        price_per_1k: entry.price_per_1k,
        gross,
        fee,
        net,
    });
    Ok(())
}

// ── Закриття прогону ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct FinalizeRun<'info> {
    #[account(seeds = [PlatformConfig::SEED], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// Різниця повертається покупцю, і тільки йому: `authority` тут — умова, а
    /// не зручність. Без неї той, хто кличе інструкцію, назвав би своїм
    /// токен-акаунтом будь-який.
    #[account(
        mut,
        token::mint = mint,
        token::authority = run.buyer,
        token::token_program = token_program,
    )]
    pub buyer_tokens: InterfaceAccount<'info, TokenAccount>,
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
}

/// Повертає різницю покупцю й переводить прогін у `completed` (`FR-016`).
///
/// Порядок «спершу всім нарахувати, потім повернути решту» тримає `complete()`:
/// повернути різницю раніше означало б віддати покупцю гроші, які ще належать
/// власникам, чиї нарахування не пройшли.
pub fn finalize(ctx: Context<FinalizeRun>) -> Result<()> {
    let run = &ctx.accounts.run;
    require!(run.status == RunStatus::Running, GenoVaultError::RunNotRunning);
    require!(
        run.result_hash.is_some(),
        GenoVaultError::RunResultMissing
    );
    require!(
        run.settled_count == run.dataset_count(),
        GenoVaultError::RunSettlementIncomplete
    );

    let refund = run.refund_amount();
    if refund > 0 {
        let seeds: &[&[u8]] = &[PlatformConfig::SEED, &[ctx.accounts.config.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_tokens.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            refund,
            ctx.accounts.mint.decimals,
        )?;
    }

    let run_key = ctx.accounts.run.key();
    ctx.accounts.run.complete()?;

    emit!(RunCompleted {
        run: run_key,
        settled_amount: ctx.accounts.run.settled_amount,
        refunded: refund,
    });
    Ok(())
}

// ── Повернення rent за накопичувач ──────────────────────────────────────────

#[derive(Accounts)]
pub struct CloseAccumulator<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub dispatcher: Signer<'info>,
    #[account(
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
        close = dispatcher,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
}

/// Накопичувач більше не потрібен — rent повертається тому, хто його вніс.
///
/// Дозволено після розкриття або в кінцевому статусі, і саме в такому порядку:
/// закритий накопичувач посеред прогону — це згортка, якій нема в що сідати.
/// Прогін, який закінчився `failed`, теж має право повернути своє: гроші
/// диспетчера не мусять лишатись у мережі через чужу невдачу.
pub fn reclaim(ctx: Context<CloseAccumulator>) -> Result<()> {
    let run = &ctx.accounts.run;
    require!(
        run.result_hash.is_some() || run.status.is_terminal(),
        GenoVaultError::RunNotRunning
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{RunDataset, ACCUMULATOR_CIPHERTEXTS, RECIPE_PARAMS_LEN};

    const CIPHERTEXTS: [[u8; 32]; REPORT_CIPHERTEXTS] = [[6u8; 32]; REPORT_CIPHERTEXTS];
    const KEY: [u8; 32] = [8u8; 32];

    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    fn code(result: Result<()>) -> u32 {
        match result.expect_err("очікувалась відмова") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        }
    }

    /// Прогін із двома датасетами, обидва закриті, накопичувач у польоті.
    fn revealing() -> (Pubkey, Run, RunAccumulator, RunResult, Pubkey) {
        let run_key = Pubkey::new_unique();
        let run = Run {
            buyer: Pubkey::new_unique(),
            dispatcher: Pubkey::new_unique(),
            nonce: 1,
            recipe_id: 1,
            recipe_params: [0u8; RECIPE_PARAMS_LEN],
            use_type: 1,
            buyer_category: 1,
            buyer_x25519: [4u8; 32],
            datasets: vec![
                RunDataset {
                    dataset: Pubkey::new_unique(),
                    price_per_1k: 100_000,
                    records_included: 1_000,
                    below_floor: false,
                    settled: false,
                },
                RunDataset {
                    dataset: Pubkey::new_unique(),
                    price_per_1k: 50_000,
                    records_included: 2_000,
                    below_floor: false,
                    settled: false,
                },
            ],
            fee_bps: 700,
            escrow_amount: 1_000_000,
            settled_count: 0,
            settled_amount: 0,
            status: RunStatus::Running,
            result_hash: None,
            records_included: 0,
            suppressed: false,
            dataset_cursor: 2,
            folded_batches: 10,
            folded_hash: [1u8; 32],
            created_at: 0,
            bump: 255,
        };
        let accumulator = RunAccumulator {
            run: run_key,
            nonce: 5,
            ciphertexts: [[2u8; 32]; ACCUMULATOR_CIPHERTEXTS],
            ready: true,
            pending: None,
            bump: 255,
        };
        let result = RunResult {
            run: run_key,
            encryption_key: [0u8; 32],
            nonce: 0,
            ciphertexts: [[0u8; 32]; REPORT_CIPHERTEXTS],
            records_included: 0,
            suppressed: false,
            bump: 255,
        };
        let computation = Pubkey::new_unique();
        (run_key, run, accumulator, result, computation)
    }

    #[test]
    fn the_report_lands_in_its_account_and_the_run_gets_its_number() {
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        acc.arm(computation).unwrap();

        accept_reveal(
            run_key,
            &mut run,
            &mut acc,
            &mut result,
            computation,
            Some((KEY, 77, CIPHERTEXTS, 3_000, 0)),
        )
        .unwrap();

        assert_eq!(run.records_included, 3_000);
        assert!(!run.suppressed);
        assert_eq!(
            run.result_hash,
            Some(RunResult::digest(&KEY, 77, &CIPHERTEXTS))
        );
        assert_eq!(result.ciphertexts, CIPHERTEXTS);
        assert_eq!(result.encryption_key, KEY);
        assert_eq!(result.nonce, 77);
        assert!(
            acc.ready && acc.pending.is_none(),
            "розкриття читає накопичувач, а не міняє його"
        );
        assert_eq!(run.status, RunStatus::Running);
    }

    #[test]
    fn a_small_cohort_comes_back_as_a_run_that_owes_nothing() {
        // `MIN_COHORT` не пройдено: рецепт віддав нулі, `records_included = 0`.
        // Прогін відбувся — статус лишається `running` до розподілу, а
        // нараховувати нема чого й депозит повертається повністю (`FR-016`).
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        run.datasets[0].records_included = 0;
        run.datasets[0].below_floor = true;
        run.datasets[1].records_included = 0;
        run.datasets[1].below_floor = true;
        acc.arm(computation).unwrap();

        accept_reveal(
            run_key,
            &mut run,
            &mut acc,
            &mut result,
            computation,
            Some((KEY, 1, CIPHERTEXTS, 0, 0)),
        )
        .unwrap();

        assert!(run.suppressed);
        assert!(result.suppressed);
        assert_eq!(run.refund_amount(), run.escrow_amount);
        assert_eq!(gross_for(&run, 0).unwrap(), 0);
    }

    #[test]
    fn an_unclosed_dataset_fails_the_run_instead_of_paying_from_it() {
        // Сторож рецепта: записи в когорті є, внеску на них ніхто не оголосив.
        // Заплатити з таких чисел означало б розлити чужу частку між рештою.
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        acc.arm(computation).unwrap();

        accept_reveal(
            run_key,
            &mut run,
            &mut acc,
            &mut result,
            computation,
            Some((KEY, 1, CIPHERTEXTS, 3_000, 1)),
        )
        .unwrap();

        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.result_hash.is_none(), "звіт не став результатом");
        assert_eq!(result.records_included, 0);
    }

    #[test]
    fn a_cohort_smaller_than_the_contributions_is_refused() {
        // Ончейн-облік і рецепт порахували різні речі. Мовчки взяти менше
        // число означало б заплатити власникам за записи, яких у когорті немає.
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        acc.arm(computation).unwrap();

        assert_eq!(
            code(accept_reveal(
                run_key,
                &mut run,
                &mut acc,
                &mut result,
                computation,
                Some((KEY, 1, CIPHERTEXTS, 2_999, 0)),
            )),
            expected(GenoVaultError::RunRecordsBelowContributions)
        );
    }

    #[test]
    fn a_failed_reveal_fails_the_run_without_wedging_it() {
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        acc.arm(computation).unwrap();

        accept_reveal(run_key, &mut run, &mut acc, &mut result, computation, None).unwrap();

        assert_eq!(run.status, RunStatus::Failed);
        assert!(acc.pending.is_none(), "накопичувач не лишається зайнятим");
        assert!(run.result_hash.is_none());
    }

    #[test]
    fn the_second_reveal_cannot_replace_the_first() {
        let (run_key, mut run, mut acc, mut result, first) = revealing();
        acc.arm(first).unwrap();
        accept_reveal(
            run_key,
            &mut run,
            &mut acc,
            &mut result,
            first,
            Some((KEY, 1, CIPHERTEXTS, 3_000, 0)),
        )
        .unwrap();

        let second = Pubkey::new_unique();
        acc.arm(second).unwrap();
        assert_eq!(
            code(accept_reveal(
                run_key,
                &mut run,
                &mut acc,
                &mut result,
                second,
                Some(([9u8; 32], 2, [[9u8; 32]; REPORT_CIPHERTEXTS], 9_000, 0)),
            )),
            expected(GenoVaultError::RunResultAlreadyRecorded),
            "покупець уже бачить перший звіт як свій результат"
        );
    }

    #[test]
    fn settling_walks_every_dataset_exactly_once() {
        let (run_key, mut run, mut acc, mut result, computation) = revealing();
        acc.arm(computation).unwrap();
        accept_reveal(
            run_key,
            &mut run,
            &mut acc,
            &mut result,
            computation,
            Some((KEY, 1, CIPHERTEXTS, 3_000, 0)),
        )
        .unwrap();

        let first = gross_for(&run, 0).unwrap();
        run.settle(0, first).unwrap();
        assert_eq!(
            code(run.settle(0, first)),
            expected(GenoVaultError::RunAlreadySettled),
            "лічильник дійшов би до кінця, не помітивши обділеного власника"
        );

        let second = gross_for(&run, 1).unwrap();
        run.settle(1, second).unwrap();
        run.complete().unwrap();

        assert_eq!(run.status, RunStatus::Completed);
        assert_eq!(run.settled_amount, first + second);
    }
}
