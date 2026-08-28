use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_PROBE_SUM: u32 = comp_def_offset("probe_sum");

declare_id!("9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb");

/// Каркас програми GenoVault.
///
/// Тут поки один каркасний прохід через MPC — він доводить, що ланцюг
/// «черга обчислень → вузли → callback» замикається на нашому репозиторії.
/// Стан продукту (конфігурація, датасети, згоди, прогони, нарахування)
/// приходить задачами T009-T012, справжні рецепти — T018.
#[arcium_program]
pub mod genovault {
    use super::*;

    pub fn init_probe_sum_comp_def(ctx: Context<InitProbeSumCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    pub fn probe_sum(
        ctx: Context<ProbeSum>,
        computation_offset: u64,
        ciphertext_0: [u8; 32],
        ciphertext_1: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_0)
            .encrypted_u8(ciphertext_1)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ProbeSumCallback::callback_ix(
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

    #[arcium_callback(encrypted_ix = "probe_sum")]
    pub fn probe_sum_callback(
        ctx: Context<ProbeSumCallback>,
        output: SignedComputationOutputs<ProbeSumOutput>,
    ) -> Result<()> {
        // Підпис кластера перевіряється до того, як результат кудись піде:
        // без цього будь-хто міг би підсунути свій результат замість MPC.
        let verified = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ProbeSumOutput { field_0 }) => field_0,
            Err(_) => return Err(GenoVaultError::AbortedComputation.into()),
        };

        emit!(ProbeSumEvent {
            result: verified.ciphertexts[0],
            nonce: verified.nonce.to_le_bytes(),
        });
        Ok(())
    }
}

#[queue_computation_accounts("probe_sum", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ProbeSum<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROBE_SUM))]
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

#[callback_accounts("probe_sum")]
#[derive(Accounts)]
pub struct ProbeSumCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROBE_SUM))]
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

#[init_computation_definition_accounts("probe_sum", payer)]
#[derive(Accounts)]
pub struct InitProbeSumCompDef<'info> {
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

#[event]
pub struct ProbeSumEvent {
    pub result: [u8; 32],
    pub nonce: [u8; 16],
}

#[error_code]
pub enum GenoVaultError {
    #[msg("Обчислення перервано")]
    AbortedComputation,
}
