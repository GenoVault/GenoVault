use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::GenoVaultError;
pub use instructions::*;
pub use state::*;

// Зсуви трьох контурів прогону живуть у `instructions/dispatch.rs` разом зі
// своїми чергами й callback'ами. Четвертий (`frequencies_reveal`) з'явиться в
// `T026`: константа без користувача — це попередження в кожній збірці, а не
// заготовка.

declare_id!("9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb");

/// Програма GenoVault.
///
/// Рецепт «частоти й розподіли» (`T018`, `T019`) живе в `encrypted-ixs`
/// чотирма контурами, і тут розгортаються їхні визначення обчислень. Прогін
/// проходить їх по черзі: `dispatch_init` створює накопичувач, `dispatch_fold`
/// згортає батчі з буферного акаунта, `dispatch_close_dataset` оголошує внесок
/// кожного датасету пулу (`T025`). Розкриття звіту покупцю й розподіл плати —
/// `T026`.
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

    /// Відкриває прогін під публікацію: накопичувач і буферний акаунт (`T025`).
    ///
    /// Платить диспетчер, і rent за буфер (~0,49 SOL) повертається йому ж на
    /// `close_batch_buffer`.
    pub fn open_run(ctx: Context<OpenRun>) -> Result<()> {
        instructions::dispatch::open(ctx)
    }

    /// Дорощує буферний акаунт на один крок. Шість викликів на прогін: акаунт,
    /// створений через CPI, не буває більшим за 10 КіБ, а батч — 70 656 байтів.
    pub fn grow_batch_buffer(ctx: Context<GrowBatchBuffer>) -> Result<()> {
        instructions::dispatch::grow_buffer(ctx)
    }

    /// Кладе шматок шифротексту в буфер. Конверт їде в ланцюг транзакціями по
    /// ~950 байтів — інших у Solana не буває.
    pub fn write_batch(ctx: Context<WriteBatch>, offset: u32, bytes: Vec<u8>) -> Result<()> {
        instructions::dispatch::write(ctx, offset, bytes)
    }

    /// Повертає rent за буфер, коли пул вичерпано або прогін завершився.
    pub fn close_batch_buffer(ctx: Context<CloseBatchBuffer>) -> Result<()> {
        instructions::dispatch::close_buffer(ctx)
    }

    /// Публікація в Arcium: порожній накопичувач під цей прогін (`FR-010`).
    ///
    /// Нулі, зашифровані ключем MXE, може зробити тільки сам MXE — програма
    /// цього ключа не має, і в цьому суть (`FR-004a`).
    pub fn dispatch_init(ctx: Context<DispatchInit>, computation_offset: u64) -> Result<()> {
        instructions::dispatch::queue_init(ctx, computation_offset)
    }

    /// Публікація в Arcium: згортка батча з буферного акаунта.
    pub fn dispatch_fold(
        ctx: Context<DispatchFold>,
        computation_offset: u64,
        live: u8,
    ) -> Result<()> {
        instructions::dispatch::queue_fold(ctx, computation_offset, live)
    }

    /// Публікація в Arcium: оголошення внеску поточного датасету (`FR-018a`).
    pub fn dispatch_close_dataset(
        ctx: Context<DispatchCloseDataset>,
        computation_offset: u64,
    ) -> Result<()> {
        instructions::dispatch::queue_close_dataset(ctx, computation_offset)
    }

    #[arcium_callback(encrypted_ix = "frequencies_init")]
    pub fn frequencies_init_callback(
        ctx: Context<FrequenciesInitCallback>,
        output: SignedComputationOutputs<FrequenciesInitOutput>,
    ) -> Result<()> {
        // Підпис кластера перевіряється до того, як результат кудись піде:
        // без цього будь-хто міг би підсунути свій накопичувач замість MPC.
        let verified = output
            .verify_output(
                &ctx.accounts.cluster_account,
                &ctx.accounts.computation_account,
            )
            .ok()
            .map(|FrequenciesInitOutput { field_0 }| (field_0.nonce, field_0.ciphertexts));

        let run_key = ctx.accounts.run.key();
        instructions::dispatch::accept_accumulator(
            run_key,
            &mut ctx.accounts.run,
            &mut ctx.accounts.accumulator,
            ctx.accounts.computation_account.key(),
            verified,
        )
    }

    #[arcium_callback(encrypted_ix = "frequencies_fold")]
    pub fn frequencies_fold_callback(
        ctx: Context<FrequenciesFoldCallback>,
        output: SignedComputationOutputs<FrequenciesFoldOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(
                &ctx.accounts.cluster_account,
                &ctx.accounts.computation_account,
            )
            .ok()
            .map(|FrequenciesFoldOutput { field_0 }| (field_0.nonce, field_0.ciphertexts));

        let run_key = ctx.accounts.run.key();
        instructions::dispatch::accept_accumulator(
            run_key,
            &mut ctx.accounts.run,
            &mut ctx.accounts.accumulator,
            ctx.accounts.computation_account.key(),
            verified,
        )
    }

    #[arcium_callback(encrypted_ix = "frequencies_close_dataset")]
    pub fn frequencies_close_dataset_callback(
        ctx: Context<FrequenciesCloseDatasetCallback>,
        output: SignedComputationOutputs<FrequenciesCloseDatasetOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(
                &ctx.accounts.cluster_account,
                &ctx.accounts.computation_account,
            )
            .ok()
            // Кортеж контуру приїжджає одним полем: `field_0` — це весь
            // `(накопичувач, внесок, below_floor)`, а не перший його елемент.
            .map(|FrequenciesCloseDatasetOutput { field_0 }| {
                let FrequenciesCloseDatasetOutputStruct0 {
                    field_0: accumulator,
                    field_1: contribution,
                    field_2: below_floor,
                } = field_0;
                (
                    accumulator.nonce,
                    accumulator.ciphertexts,
                    contribution,
                    below_floor,
                )
            });

        let run_key = ctx.accounts.run.key();
        instructions::dispatch::accept_dataset_close(
            run_key,
            &mut ctx.accounts.run,
            &mut ctx.accounts.accumulator,
            ctx.accounts.computation_account.key(),
            verified,
        )
    }
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
