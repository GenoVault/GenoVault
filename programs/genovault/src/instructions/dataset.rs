use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;
use crate::state::{Dataset, DatasetStatus, DATASET_ID_MAX_LEN};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterDatasetArgs {
    pub dataset_id: String,
    pub content_hash: [u8; 32],
    pub record_count_claimed: u64,
    pub price_per_1k: u64,
}

#[derive(Accounts)]
#[instruction(args: RegisterDatasetArgs)]
pub struct RegisterDataset<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Dataset::INIT_SPACE,
        seeds = [Dataset::SEED, owner.key().as_ref(), args.dataset_id.as_bytes()],
        bump,
    )]
    pub dataset: Account<'info, Dataset>,
    pub system_program: Program<'info, System>,
}

/// Спільний набір для трьох інструкцій, що міняють уже наявний датасет.
///
/// Ідентифікатор у seeds береться з самого акаунта, а не з аргументу: тоді
/// підмінити датасет чужим просто нема чим — сходитись мусять і власник, і
/// збережений усередині ідентифікатор.
#[derive(Accounts)]
pub struct UpdateDataset<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        has_one = owner @ GenoVaultError::NotDatasetOwner,
        seeds = [Dataset::SEED, owner.key().as_ref(), dataset.dataset_id.as_bytes()],
        bump = dataset.bump,
    )]
    pub dataset: Account<'info, Dataset>,
}

#[event]
pub struct DatasetRegistered {
    pub dataset: Pubkey,
    pub owner: Pubkey,
    pub dataset_id: String,
    pub version: u32,
    pub content_hash: [u8; 32],
    pub record_count_claimed: u64,
    pub price_per_1k: u64,
}

/// Подія на кожну версію — це і є «стару не перезаписано» (`FR-003`).
///
/// Акаунт тримає лише поточний стан; попередній відбиток лишається в журналі
/// разом із номером версії, і `Run` кожного прогону вказує на ту версію, по
/// якій ішов.
#[event]
pub struct DatasetVersionAdded {
    pub dataset: Pubkey,
    pub version: u32,
    pub previous_content_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub record_count_claimed: u64,
}

#[event]
pub struct DatasetPriceChanged {
    pub dataset: Pubkey,
    pub previous_price_per_1k: u64,
    pub price_per_1k: u64,
}

#[event]
pub struct DatasetRetired {
    pub dataset: Pubkey,
    pub owner: Pubkey,
    pub version: u32,
}

/// Нульовий відбиток — найдешевша ознака того, що вміст не порахували, а поле
/// лишили як є. Ончейн його прийняти не можна: за таким «відбитком» ніхто
/// нічого не звірить, а `FR-004` саме про звірку.
fn require_real_hash(content_hash: &[u8; 32]) -> Result<()> {
    require!(
        content_hash.iter().any(|byte| *byte != 0),
        GenoVaultError::EmptyContentHash
    );
    Ok(())
}

pub fn register(ctx: Context<RegisterDataset>, args: RegisterDatasetArgs) -> Result<()> {
    // Довший ідентифікатор до цього місця не доходить: деривація PDA впаде
    // раніше на межі seed. Перевірка лишається, щоб межа була названа тут, а
    // не читалась із чужої помилки.
    require!(
        !args.dataset_id.is_empty() && args.dataset_id.len() <= DATASET_ID_MAX_LEN,
        GenoVaultError::DatasetIdLength
    );
    require!(
        args.record_count_claimed > 0,
        GenoVaultError::EmptyDataset
    );
    require_real_hash(&args.content_hash)?;

    let owner = ctx.accounts.owner.key();
    ctx.accounts.dataset.set_inner(Dataset {
        owner,
        dataset_id: args.dataset_id.clone(),
        version: 1,
        content_hash: args.content_hash,
        record_count_claimed: args.record_count_claimed,
        price_per_1k: args.price_per_1k,
        consent_version: 0,
        status: DatasetStatus::Active,
        verified_badge: None,
        bump: ctx.bumps.dataset,
    });

    emit!(DatasetRegistered {
        dataset: ctx.accounts.dataset.key(),
        owner,
        dataset_id: args.dataset_id,
        version: 1,
        content_hash: args.content_hash,
        record_count_claimed: args.record_count_claimed,
        price_per_1k: args.price_per_1k,
    });
    Ok(())
}

pub fn update_content(
    ctx: Context<UpdateDataset>,
    content_hash: [u8; 32],
    record_count_claimed: u64,
) -> Result<()> {
    let dataset = &mut ctx.accounts.dataset;
    require!(dataset.is_active(), GenoVaultError::DatasetNotActive);
    require!(record_count_claimed > 0, GenoVaultError::EmptyDataset);
    require_real_hash(&content_hash)?;
    // Версія без зміни вмісту зробила б номер версії брехливим: покупець,
    // який звіряє відбиток прогону, побачив би дві різні версії з однаковими
    // даними й не мав би способу зрозуміти, яка з них та сама.
    require!(
        dataset.content_hash != content_hash,
        GenoVaultError::DatasetContentUnchanged
    );

    let previous_content_hash = dataset.content_hash;
    dataset.version = dataset
        .version
        .checked_add(1)
        .ok_or(GenoVaultError::DatasetVersionOverflow)?;
    dataset.content_hash = content_hash;
    dataset.record_count_claimed = record_count_claimed;

    emit!(DatasetVersionAdded {
        dataset: dataset.key(),
        version: dataset.version,
        previous_content_hash,
        content_hash,
        record_count_claimed,
    });
    Ok(())
}

pub fn set_price(ctx: Context<UpdateDataset>, price_per_1k: u64) -> Result<()> {
    let dataset = &mut ctx.accounts.dataset;
    require!(dataset.is_active(), GenoVaultError::DatasetNotActive);

    let previous_price_per_1k = dataset.price_per_1k;
    dataset.price_per_1k = price_per_1k;

    // Ціна, що діє на прогін, фіксується в `Run` при замовленні (`T024`).
    // Подія тут потрібна саме тому: без неї покупець не має способу показати,
    // яка ціна стояла на момент його замовлення.
    emit!(DatasetPriceChanged {
        dataset: dataset.key(),
        previous_price_per_1k,
        price_per_1k,
    });
    Ok(())
}

pub fn retire(ctx: Context<UpdateDataset>) -> Result<()> {
    let dataset = &mut ctx.accounts.dataset;
    require!(dataset.is_active(), GenoVaultError::DatasetNotActive);
    dataset.status = DatasetStatus::Retired;

    // Акаунт не закривається. Завершені прогони посилаються на цей датасет, і
    // зникла адреса зробила б їх нечитними для того, хто звіряє журнал
    // (`FR-025`).
    emit!(DatasetRetired {
        dataset: dataset.key(),
        owner: dataset.owner,
        version: dataset.version,
    });
    Ok(())
}
