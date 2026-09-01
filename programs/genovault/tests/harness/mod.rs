//! Спільний стенд для тестів програми (`T013`).
//!
//! Лежить у `tests/harness/`, а не в `tests/harness.rs`: файл прямо в `tests/`
//! cargo вважає окремим тестовим бінарником і додає до звіту порожній
//! «running 0 tests». Тека такого не робить, а `mod harness;` знаходить її
//! однаково.
//!
//! Тут — тільки побудова стану й читання результату. Твердження лишаються в
//! самих тестах разом зі своїми поясненнями: винесене твердження втрачає те,
//! заради чого воно написане.

#![allow(dead_code)]

use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use genovault::state::{Consent, Dataset, PlatformConfig, Run};
use genovault::GenoVaultError;
use mollusk_svm::result::{InstructionResult, ProgramResult};
use mollusk_svm::Mollusk;
use solana_account::Account;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// Стенд поверх зібраного `genovault.so`.
///
/// Саме поверх .so, а не викликом хендлерів: перевірки Anchor (`init`,
/// `seeds`, `has_one`, `owner`) живуть у згенерованому `try_accounts`, і тест
/// на хендлер пройшов би повз рівно те, на що ми покладаємось.
pub fn mollusk() -> Mollusk {
    Mollusk::new(&genovault::ID, "genovault")
}

pub fn funded_wallet() -> Account {
    Account {
        lamports: 10 * LAMPORTS_PER_SOL,
        data: Vec::new(),
        owner: solana_sdk_ids::system_program::ID,
        executable: false,
        rent_epoch: 0,
    }
}

/// Місце під акаунт, який створить сама програма: mollusk не заводить
/// акаунтів автоматично, і забутий рядок виглядає як помилка в програмі.
pub fn empty(key: Pubkey) -> (Pubkey, Account) {
    (key, Account::default())
}

pub fn system_program() -> (Pubkey, Account) {
    mollusk_svm::program::keyed_account_for_system_program()
}

pub fn system_program_id() -> Pubkey {
    solana_sdk_ids::system_program::ID
}

// ── Адреси ───────────────────────────────────────────────────────────────────

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PlatformConfig::SEED], &genovault::ID)
}

pub fn dataset_pda(owner: &Pubkey, dataset_id: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[Dataset::SEED, owner.as_ref(), dataset_id.as_bytes()],
        &genovault::ID,
    )
    .0
}

pub fn consent_pda(dataset: &Pubkey, version: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[Consent::SEED, dataset.as_ref(), &version.to_le_bytes()],
        &genovault::ID,
    )
    .0
}

pub fn run_pda(buyer: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[Run::SEED, buyer.as_ref(), &nonce.to_le_bytes()],
        &genovault::ID,
    )
    .0
}

// ── Читання результату ───────────────────────────────────────────────────────

/// Код помилки з самого enum, а не з таблиці констант: додати помилку в
/// середину `errors.rs` — звичайна річ, а зсунуті вручну числа роблять тест,
/// який зеленіє на неправильній причині відмови.
pub fn expected(error: GenoVaultError) -> u32 {
    error.into()
}

/// Те саме для вбудованих кодів Anchor (`ConstraintSeeds`, `ConstraintOwner`).
pub fn anchor_code(error: anchor_lang::error::ErrorCode) -> u32 {
    error.into()
}

pub fn custom_error_code(result: &InstructionResult) -> Option<u32> {
    match &result.program_result {
        ProgramResult::Failure(ProgramError::Custom(code)) => Some(*code),
        _ => None,
    }
}

pub fn is_success(result: &InstructionResult) -> bool {
    result.program_result == ProgramResult::Success
}

pub fn read<T: AccountDeserialize>(accounts: &[(Pubkey, Account)], key: &Pubkey) -> T {
    let (_, account) = accounts
        .iter()
        .find(|(candidate, _)| candidate == key)
        .expect("акаунт має бути серед результатів інструкції");
    T::try_deserialize(&mut account.data.as_slice()).expect("акаунт має читатися")
}
