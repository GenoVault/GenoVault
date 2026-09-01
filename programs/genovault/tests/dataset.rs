//! Тести датасету (`T010`, `FR-001`, `FR-003`, `FR-015`).
//!
//! Стенд — `tests/harness/`: `mollusk-svm` поверх зібраного .so.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::state::{Dataset, DatasetStatus};
use genovault::GenoVaultError;
use mollusk_svm::result::ProgramResult;
use mollusk_svm::Mollusk;
use solana_account::Account;

mod harness;
use harness::*;

const DATASET_ID: &str = "exome-cohort-2026";
const PRICE_PER_1K: u64 = 25_000_000;
const RECORDS: u64 = 12_500;

fn hash(seed: u8) -> [u8; 32] {
    [seed; 32]
}

fn register_ix(owner: Pubkey, args: RegisterDatasetArgs) -> Instruction {
    let dataset = dataset_pda(&owner, &args.dataset_id);
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RegisterDataset {
            owner,
            dataset,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::RegisterDataset { args }.data(),
    }
}

fn update_accounts(owner: Pubkey, dataset: Pubkey) -> Vec<AccountMeta> {
    genovault::accounts::UpdateDataset { owner, dataset }.to_account_metas(None)
}

fn default_args() -> RegisterDatasetArgs {
    RegisterDatasetArgs {
        dataset_id: DATASET_ID.to_string(),
        content_hash: hash(1),
        record_count_claimed: RECORDS,
        price_per_1k: PRICE_PER_1K,
    }
}

/// Зареєстрований датасет разом зі станом акаунтів після реєстрації — основа
/// для тестів, що міняють уже наявний датасет.
struct Registered {
    mollusk: Mollusk,
    owner: Pubkey,
    dataset: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

fn registered() -> Registered {
    let mollusk = mollusk();
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);

    let accounts = vec![
        (owner, funded_wallet()),
        empty(dataset),
        system_program(),
    ];

    let result = mollusk.process_instruction(&register_ix(owner, default_args()), &accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "реєстрація має проходити: {:?}",
        result.program_result
    );

    Registered {
        mollusk,
        owner,
        dataset,
        accounts: result.resulting_accounts,
    }
}

#[test]
fn register_writes_the_first_version() {
    let r = registered();
    let dataset = read::<Dataset>(&r.accounts, &r.dataset);

    assert_eq!(dataset.owner, r.owner);
    assert_eq!(dataset.dataset_id, DATASET_ID);
    assert_eq!(dataset.version, 1, "перша версія — 1, не 0");
    assert_eq!(dataset.content_hash, hash(1));
    assert_eq!(dataset.record_count_claimed, RECORDS);
    assert_eq!(dataset.price_per_1k, PRICE_PER_1K);
    assert_eq!(dataset.status, DatasetStatus::Active);
    assert!(
        dataset.verified_badge.is_none(),
        "позначка підтвердження не з'являється сама — її ставить оператор (T060)"
    );
}

#[test]
fn register_rejects_an_empty_content_hash() {
    let mollusk = mollusk();
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);
    let accounts = vec![
        (owner, funded_wallet()),
        empty(dataset),
        system_program(),
    ];

    let args = RegisterDatasetArgs {
        content_hash: [0u8; 32],
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::EmptyContentHash)),
        "нульовий відбиток нічого не доводить: {:?}",
        result.program_result
    );
}

#[test]
fn register_rejects_a_dataset_without_records() {
    let mollusk = mollusk();
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);
    let accounts = vec![
        (owner, funded_wallet()),
        empty(dataset),
        system_program(),
    ];

    let args = RegisterDatasetArgs {
        record_count_claimed: 0,
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::EmptyDataset)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn register_rejects_an_empty_dataset_id() {
    let mollusk = mollusk();
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, "");
    let accounts = vec![
        (owner, funded_wallet()),
        empty(dataset),
        system_program(),
    ];

    let args = RegisterDatasetArgs {
        dataset_id: String::new(),
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::DatasetIdLength)),
        "порожній ідентифікатор дає валідний PDA, тому ловити його має програма: {:?}",
        result.program_result
    );
}

#[test]
fn new_content_bumps_the_version() {
    let r = registered();
    let ix = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(r.owner, r.dataset),
        data: genovault::instruction::UpdateDatasetContent {
            content_hash: hash(2),
            record_count_claimed: RECORDS + 500,
        }
        .data(),
    };

    let result = r.mollusk.process_instruction(&ix, &r.accounts);
    assert_eq!(result.program_result, ProgramResult::Success);

    let dataset = read::<Dataset>(&result.resulting_accounts, &r.dataset);
    assert_eq!(dataset.version, 2);
    assert_eq!(dataset.content_hash, hash(2));
    assert_eq!(dataset.record_count_claimed, RECORDS + 500);
}

#[test]
fn the_same_content_is_not_a_new_version() {
    let r = registered();
    let ix = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(r.owner, r.dataset),
        data: genovault::instruction::UpdateDatasetContent {
            content_hash: hash(1),
            record_count_claimed: RECORDS,
        }
        .data(),
    };

    let result = r.mollusk.process_instruction(&ix, &r.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::DatasetContentUnchanged)),
        "номер версії має щось означати: {:?}",
        result.program_result
    );
}

#[test]
fn a_stranger_cannot_touch_someone_elses_dataset() {
    let r = registered();
    let stranger = Pubkey::new_unique();

    let ix = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(stranger, r.dataset),
        data: genovault::instruction::SetDatasetPrice { price_per_1k: 1 }.data(),
    };

    let mut accounts = r.accounts.clone();
    accounts.push((stranger, funded_wallet()));
    let result = r.mollusk.process_instruction(&ix, &accounts);

    // Спрацьовує саме перевірка seeds: ідентифікатор власника входить у
    // деривацію, тож із чужим підписом адреса просто не сходиться. `has_one`
    // лишається другим рубежем на випадок, якщо seeds колись зміняться.
    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn price_changes_and_stays_readable() {
    let r = registered();
    let ix = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(r.owner, r.dataset),
        data: genovault::instruction::SetDatasetPrice {
            price_per_1k: PRICE_PER_1K * 2,
        }
        .data(),
    };

    let result = r.mollusk.process_instruction(&ix, &r.accounts);
    assert_eq!(result.program_result, ProgramResult::Success);
    assert_eq!(
        read::<Dataset>(&result.resulting_accounts, &r.dataset).price_per_1k,
        PRICE_PER_1K * 2
    );
}

#[test]
fn a_retired_dataset_stops_accepting_changes() {
    let r = registered();
    let retire = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(r.owner, r.dataset),
        data: genovault::instruction::RetireDataset {}.data(),
    };

    let retired = r.mollusk.process_instruction(&retire, &r.accounts);
    assert_eq!(retired.program_result, ProgramResult::Success);

    let dataset = read::<Dataset>(&retired.resulting_accounts, &r.dataset);
    assert_eq!(dataset.status, DatasetStatus::Retired);
    assert_eq!(
        dataset.version, 1,
        "зняття з каталогу не є новою версією вмісту"
    );

    let update = Instruction {
        program_id: genovault::ID,
        accounts: update_accounts(r.owner, r.dataset),
        data: genovault::instruction::UpdateDatasetContent {
            content_hash: hash(3),
            record_count_claimed: RECORDS,
        }
        .data(),
    };
    let after = r
        .mollusk
        .process_instruction(&update, &retired.resulting_accounts);

    assert_eq!(
        custom_error_code(&after),
        Some(expected(GenoVaultError::DatasetNotActive)),
        "{:?}",
        after.program_result
    );
}
