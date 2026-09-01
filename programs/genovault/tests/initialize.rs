//! Тести інструкції `initialize` (`T009`, `FR-019`).
//!
//! Стенд — `tests/harness/`: `mollusk-svm` поверх зібраного `genovault.so`.
//!
//! Запуск: `scripts/wsl-test-program.sh` (спершу збирає .so).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use genovault::instructions::initialize::TOKEN_2022_PROGRAM_ID;
use genovault::state::{PlatformConfig, MAX_FEE_BPS};
use genovault::GenoVaultError;
use mollusk_svm::result::ProgramResult;
use mollusk_svm::Mollusk;
use solana_account::Account;

mod harness;
use harness::*;

/// Мінт як акаунт, а не як аргумент: перевірка `owner` має що перевіряти лише
/// тоді, коли акаунт реально їде в транзакції.
fn mint_account(owner: Pubkey) -> Account {
    Account {
        lamports: LAMPORTS_PER_SOL,
        data: vec![0u8; 82],
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

struct Fixture {
    mollusk: Mollusk,
    authority: Pubkey,
    mint: Pubkey,
    config: Pubkey,
    bump: u8,
    accounts: Vec<(Pubkey, Account)>,
}

fn fixture(mint_owner: Pubkey) -> Fixture {
    let mollusk = mollusk();
    let authority = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let (config, bump) = config_pda();

    let accounts = vec![
        (authority, funded_wallet()),
        empty(config),
        (mint, mint_account(mint_owner)),
        system_program(),
    ];

    Fixture {
        mollusk,
        authority,
        mint,
        config,
        bump,
        accounts,
    }
}

fn initialize_ix(authority: Pubkey, config: Pubkey, mint: Pubkey, fee_bps: u16) -> Instruction {
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::Initialize {
            authority,
            config,
            mint,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::Initialize { fee_bps }.data(),
    }
}

#[test]
fn writes_config_readable_by_anyone() {
    let f = fixture(TOKEN_2022_PROGRAM_ID);
    let ix = initialize_ix(f.authority, f.config, f.mint, 250);

    let result = f.mollusk.process_instruction(&ix, &f.accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "initialize має проходити: {:?}",
        result.program_result
    );

    let (_, account) = result
        .resulting_accounts
        .iter()
        .find(|(key, _)| *key == f.config)
        .expect("акаунт конфігурації має існувати після initialize");

    let config = PlatformConfig::try_deserialize(&mut account.data.as_slice())
        .expect("конфігурація має читатися стороннім кодом без нашого API");

    assert_eq!(config.authority, f.authority);
    assert_eq!(config.mint, f.mint);
    assert_eq!(config.fee_bps, 250);
    assert!(!config.paused, "платформа не стартує на паузі");
    assert_eq!(config.bump, f.bump);
    assert_eq!(account.owner, genovault::ID);
}

#[test]
fn accepts_fee_exactly_at_the_cap() {
    let f = fixture(TOKEN_2022_PROGRAM_ID);
    let ix = initialize_ix(f.authority, f.config, f.mint, MAX_FEE_BPS);

    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "межа включна: {MAX_FEE_BPS} bps — це ще дозволено"
    );
}

#[test]
fn rejects_fee_above_the_cap() {
    let f = fixture(TOKEN_2022_PROGRAM_ID);
    let ix = initialize_ix(f.authority, f.config, f.mint, MAX_FEE_BPS + 1);

    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::FeeBpsTooHigh)),
        "комісія понад межу має падати іменною помилкою, а не мовчки: {:?}",
        result.program_result
    );
}

#[test]
fn rejects_mint_outside_token_2022() {
    // Мінт зі старого SPL Token не має конфіденційного розширення й ніколи
    // його не отримає: розширення вмикаються лише при створенні мінта.
    let f = fixture(system_program_id());
    let ix = initialize_ix(f.authority, f.config, f.mint, 250);

    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintOwner)),
        "мінт поза Token-2022 має відхилятись: {:?}",
        result.program_result
    );
}

#[test]
fn cannot_be_run_twice() {
    let f = fixture(TOKEN_2022_PROGRAM_ID);
    let ix = initialize_ix(f.authority, f.config, f.mint, 250);

    let first = f.mollusk.process_instruction(&ix, &f.accounts);
    assert_eq!(first.program_result, ProgramResult::Success);

    // Другий прогін бачить уже ініціалізовану конфігурацію. Якби `init` тут
    // пропускав, оператор міняв би комісію заднім числом, і `FR-019`
    // («фіксована на момент замовлення») лишався б лише на папері.
    let second_ix = initialize_ix(f.authority, f.config, f.mint, MAX_FEE_BPS);
    let second = f
        .mollusk
        .process_instruction(&second_ix, &first.resulting_accounts);

    assert_ne!(
        second.program_result,
        ProgramResult::Success,
        "повторний initialize має падати"
    );
}
