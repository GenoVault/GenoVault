use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;
use crate::state::{PlatformConfig, MAX_FEE_BPS};

/// Мінт із конфіденційним розширенням буває лише в Token-2022: у класичному
/// SPL Token розширень немає взагалі. Перевірка власника акаунта відсікає
/// найдешевшу помилку розгортання — конфігурацію на звичайний мінт, з якою
/// `FR-021` тихо стає недосяжним аж до `T054`.
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [PlatformConfig::SEED],
        bump,
    )]
    pub config: Account<'info, PlatformConfig>,
    /// CHECK: тут перевіряється лише те, що акаунт належить Token-2022.
    /// Наявність конфіденційного розширення звіряється в `T054`, коли мінт
    /// з'явиться; робити це зараз означало б тягнути `anchor-spl` заради
    /// перевірки, яку нічим перевірити.
    #[account(owner = TOKEN_2022_PROGRAM_ID)]
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Публічна поява платформи: після цієї події будь-хто знає комісію й мінт,
/// не читаючи наш інтерфейс (`FR-019`, `FR-026`).
#[event]
pub struct PlatformInitialized {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub fee_bps: u16,
}

pub fn handler(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, GenoVaultError::FeeBpsTooHigh);

    let authority = ctx.accounts.authority.key();
    let mint = ctx.accounts.mint.key();

    ctx.accounts.config.set_inner(PlatformConfig {
        authority,
        mint,
        fee_bps,
        paused: false,
        bump: ctx.bumps.config,
    });

    emit!(PlatformInitialized {
        authority,
        mint,
        fee_bps,
    });
    Ok(())
}
