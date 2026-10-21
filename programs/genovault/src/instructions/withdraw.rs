use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::{OwnerBalance, PlatformConfig};

/// An owner withdrew part of what was accrued (`FR-020`).
///
/// `withdrawn` is already the total after this withdrawal: the next request is
/// built from it without reading the account, and the log reconciles without
/// summing.
#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub accrued: u64,
    pub withdrawn: u64,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The only one who can move this balance. Unlike `settle_dataset` and
    /// `finalize_run`, the signature here is the right itself.
    pub owner: Signer<'info>,
    /// The pause is deliberately not checked: it stops new runs, not payment
    /// for work already done.
    #[account(seeds = [PlatformConfig::SEED], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, PlatformConfig>>,
    /// The address comes from the signer, not from an argument: no choice of
    /// accounts finds someone else's balance under one's own signature.
    #[account(
        mut,
        seeds = [OwnerBalance::SEED, owner.key().as_ref()],
        bump = owner_balance.bump,
    )]
    pub owner_balance: Box<Account<'info, OwnerBalance>>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// The money goes to the owner's own token account. The owner does sign
    /// here, and a free recipient would look like a convenience, but the
    /// transaction is built by the API (`POST /withdrawals`) and the owner
    /// signs it in a wallet. A swapped recipient in such a transaction is a
    /// withdrawal into someone else's pocket under the owner's signature; a
    /// pinned one is at worst the wrong amount paid to the owner.
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
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

/// Withdrawal from the vault to the owner's own token account (`T049`,
/// `FR-020`).
///
/// The platform withdraws its fee the same way: its balance is the same
/// `OwnerBalance` under `PlatformConfig.authority`.
pub fn withdraw(ctx: Context<Withdraw>, amount: u64, withdrawn_before: u64) -> Result<()> {
    ctx.accounts
        .owner_balance
        .withdraw(amount, withdrawn_before)?;

    let seeds: &[&[u8]] = &[PlatformConfig::SEED, &[ctx.accounts.config.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_tokens.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let balance = &ctx.accounts.owner_balance;
    emit!(Withdrawn {
        owner: balance.owner,
        amount,
        accrued: balance.accrued,
        withdrawn: balance.withdrawn,
    });
    Ok(())
}
