//! Тести датасету (`T010`, `FR-001`, `FR-003`, `FR-015`).
//!
//! Стенд той самий, що в `initialize.rs`: `mollusk-svm` поверх зібраного .so.
//! Помічники поки продубльовані навмисно — спільний стенд витягується в `T013`,
//! коли комплектів стане три-чотири. Витягувати спільне з двох файлів рано:
//! перша спроба узагальнення майже завжди вгадує не той шов.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::state::{Dataset, DatasetStatus};
use mollusk_svm::result::{InstructionResult, ProgramResult};
use mollusk_svm::Mollusk;
use solana_account::Account;

/// `GenoVaultError` нумерується з 6000 у порядку оголошення в `errors.rs`.
const ERR_DATASET_ID_LENGTH: u32 = 6002;
const ERR_EMPTY_DATASET: u32 = 6003;
const ERR_EMPTY_CONTENT_HASH: u32 = 6004;
const ERR_DATASET_NOT_ACTIVE: u32 = 6006;
const ERR_DATASET_CONTENT_UNCHANGED: u32 = 6007;
/// Код Anchor для порушеного `seeds = [...]`.
const ANCHOR_CONSTRAINT_SEEDS: u32 = 2006;

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const DATASET_ID: &str = "exome-cohort-2026";
const PRICE_PER_1K: u64 = 25_000_000;
const RECORDS: u64 = 12_500;

fn hash(seed: u8) -> [u8; 32] {
    [seed; 32]
}

fn funded_wallet() -> Account {
    Account {
        lamports: 10 * LAMPORTS_PER_SOL,
        data: Vec::new(),
        owner: solana_sdk_ids::system_program::ID,
        executable: false,
        rent_epoch: 0,
    }
}

fn dataset_pda(owner: &Pubkey, dataset_id: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[Dataset::SEED, owner.as_ref(), dataset_id.as_bytes()],
        &genovault::ID,
    )
    .0
}

fn register_ix(owner: Pubkey, args: RegisterDatasetArgs) -> Instruction {
    let dataset = dataset_pda(&owner, &args.dataset_id);
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RegisterDataset {
            owner,
            dataset,
            system_program: solana_sdk_ids::system_program::ID,
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

fn custom_error_code(result: &InstructionResult) -> Option<u32> {
    match &result.program_result {
        ProgramResult::Failure(ProgramError::Custom(code)) => Some(*code),
        _ => None,
    }
}

fn read_dataset(accounts: &[(Pubkey, Account)], key: &Pubkey) -> Dataset {
    let (_, account) = accounts
        .iter()
        .find(|(k, _)| k == key)
        .expect("акаунт датасету має бути в результаті");
    Dataset::try_deserialize(&mut account.data.as_slice()).expect("датасет має читатися")
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
    let mollusk = Mollusk::new(&genovault::ID, "genovault");
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);

    let accounts = vec![
        (owner, funded_wallet()),
        (dataset, Account::default()),
        mollusk_svm::program::keyed_account_for_system_program(),
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
    let dataset = read_dataset(&r.accounts, &r.dataset);

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
    let mollusk = Mollusk::new(&genovault::ID, "genovault");
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);
    let accounts = vec![
        (owner, funded_wallet()),
        (dataset, Account::default()),
        mollusk_svm::program::keyed_account_for_system_program(),
    ];

    let args = RegisterDatasetArgs {
        content_hash: [0u8; 32],
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(ERR_EMPTY_CONTENT_HASH),
        "нульовий відбиток нічого не доводить: {:?}",
        result.program_result
    );
}

#[test]
fn register_rejects_a_dataset_without_records() {
    let mollusk = Mollusk::new(&genovault::ID, "genovault");
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);
    let accounts = vec![
        (owner, funded_wallet()),
        (dataset, Account::default()),
        mollusk_svm::program::keyed_account_for_system_program(),
    ];

    let args = RegisterDatasetArgs {
        record_count_claimed: 0,
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(ERR_EMPTY_DATASET),
        "{:?}",
        result.program_result
    );
}

#[test]
fn register_rejects_an_empty_dataset_id() {
    let mollusk = Mollusk::new(&genovault::ID, "genovault");
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, "");
    let accounts = vec![
        (owner, funded_wallet()),
        (dataset, Account::default()),
        mollusk_svm::program::keyed_account_for_system_program(),
    ];

    let args = RegisterDatasetArgs {
        dataset_id: String::new(),
        ..default_args()
    };
    let result = mollusk.process_instruction(&register_ix(owner, args), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(ERR_DATASET_ID_LENGTH),
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

    let dataset = read_dataset(&result.resulting_accounts, &r.dataset);
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
        Some(ERR_DATASET_CONTENT_UNCHANGED),
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
        Some(ANCHOR_CONSTRAINT_SEEDS),
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
        read_dataset(&result.resulting_accounts, &r.dataset).price_per_1k,
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

    let dataset = read_dataset(&retired.resulting_accounts, &r.dataset);
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
        Some(ERR_DATASET_NOT_ACTIVE),
        "{:?}",
        after.program_result
    );
}
