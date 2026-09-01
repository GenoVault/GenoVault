use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;
use crate::state::{buyer_category, use_type, Consent, Dataset};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SetConsentArgs {
    pub allowed_uses: u32,
    pub forbidden_uses: u32,
    pub buyer_categories: u32,
    pub expires_at: Option<i64>,
}

#[derive(Accounts)]
pub struct SetConsent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        has_one = owner @ GenoVaultError::NotDatasetOwner,
        seeds = [Dataset::SEED, owner.key().as_ref(), dataset.dataset_id.as_bytes()],
        bump = dataset.bump,
    )]
    pub dataset: Account<'info, Dataset>,
    /// Попередня версія згоди — або `None` для першої.
    ///
    /// Акаунт приймається як `Option`, а не як окремий набір інструкцій: так
    /// ланцюг версій будує сама програма, і клієнт не може зв'язати нову
    /// згоду з довільною чужою.
    #[account(
        seeds = [Consent::SEED, dataset.key().as_ref(), &dataset.consent_version.to_le_bytes()],
        bump = previous_consent.bump,
    )]
    pub previous_consent: Option<Account<'info, Consent>>,
    #[account(
        init,
        payer = owner,
        space = 8 + Consent::INIT_SPACE,
        seeds = [
            Consent::SEED,
            dataset.key().as_ref(),
            &dataset.consent_version.saturating_add(1).to_le_bytes(),
        ],
        bump,
    )]
    pub consent: Account<'info, Consent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeConsent<'info> {
    pub owner: Signer<'info>,
    #[account(
        has_one = owner @ GenoVaultError::NotDatasetOwner,
        seeds = [Dataset::SEED, owner.key().as_ref(), dataset.dataset_id.as_bytes()],
        bump = dataset.bump,
    )]
    pub dataset: Account<'info, Dataset>,
    #[account(
        mut,
        seeds = [Consent::SEED, dataset.key().as_ref(), &dataset.consent_version.to_le_bytes()],
        bump = consent.bump,
    )]
    pub consent: Account<'info, Consent>,
}

#[event]
pub struct ConsentSet {
    pub dataset: Pubkey,
    pub consent: Pubkey,
    pub version: u32,
    pub previous_version: Option<Pubkey>,
    pub allowed_uses: u32,
    pub forbidden_uses: u32,
    pub buyer_categories: u32,
    pub expires_at: Option<i64>,
}

#[event]
pub struct ConsentRevoked {
    pub dataset: Pubkey,
    pub consent: Pubkey,
    pub version: u32,
    pub revoked_at: i64,
}

pub fn set(ctx: Context<SetConsent>, args: SetConsentArgs) -> Result<()> {
    let dataset = &mut ctx.accounts.dataset;
    require!(dataset.is_active(), GenoVaultError::DatasetNotActive);

    // Біти поза словником не відхиляють ліниво, а саме забороняють: маска, у
    // якій щось увімкнено «про запас», виглядає як ширша згода, ніж вона є, і
    // стане нею сама собою, коли словник розширять.
    require!(
        args.allowed_uses & !use_type::ALL == 0 && args.forbidden_uses & !use_type::ALL == 0,
        GenoVaultError::UnknownUseType
    );
    require!(
        args.buyer_categories & !buyer_category::ALL == 0,
        GenoVaultError::UnknownBuyerCategory
    );

    // Згода, яка після заборон не дозволяє нічого, — це відкликання, вдягнене
    // як згода. Різниця не косметична: відкликання має свою дату й свою
    // причину відмови, і плутати їх у журналі не можна.
    require!(
        args.allowed_uses & !args.forbidden_uses != 0,
        GenoVaultError::ConsentAllowsNothing
    );
    require!(
        args.buyer_categories != 0,
        GenoVaultError::ConsentAllowsNothing
    );

    let now = Clock::get()?.unix_timestamp;
    if let Some(expires_at) = args.expires_at {
        require!(expires_at > now, GenoVaultError::ConsentExpiryInPast);
    }

    let version = dataset
        .consent_version
        .checked_add(1)
        .ok_or(GenoVaultError::ConsentVersionOverflow)?;

    // Перша згода не має попередньої; далі попередня обов'язкова, інакше
    // ланцюг версій рвався б і `FR-005` доводився б лише нашим словом.
    let previous_version = match (&ctx.accounts.previous_consent, version) {
        (None, 1) => None,
        (Some(previous), _) => Some(previous.key()),
        (None, _) => return Err(GenoVaultError::PreviousConsentMissing.into()),
    };

    ctx.accounts.consent.set_inner(Consent {
        dataset: dataset.key(),
        version,
        allowed_uses: args.allowed_uses,
        forbidden_uses: args.forbidden_uses,
        buyer_categories: args.buyer_categories,
        expires_at: args.expires_at,
        revoked_at: None,
        prev_version: previous_version,
        bump: ctx.bumps.consent,
    });
    dataset.consent_version = version;

    emit!(ConsentSet {
        dataset: dataset.key(),
        consent: ctx.accounts.consent.key(),
        version,
        previous_version,
        allowed_uses: args.allowed_uses,
        forbidden_uses: args.forbidden_uses,
        buyer_categories: args.buyer_categories,
        expires_at: args.expires_at,
    });
    Ok(())
}

pub fn revoke(ctx: Context<RevokeConsent>) -> Result<()> {
    let consent = &mut ctx.accounts.consent;
    require!(
        consent.revoked_at.is_none(),
        GenoVaultError::ConsentAlreadyRevoked
    );

    let now = Clock::get()?.unix_timestamp;
    consent.revoked_at = Some(now);

    // Версія не зростає і акаунт не закривається: відкликання — це подія в
    // історії згоди, а не нова згода. Прогони, завершені до цієї миті,
    // посилаються саме на цю версію й лишаються дійсними (`FR-007`).
    emit!(ConsentRevoked {
        dataset: consent.dataset,
        consent: consent.key(),
        version: consent.version,
        revoked_at: now,
    });
    Ok(())
}
