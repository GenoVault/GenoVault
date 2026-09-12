//! Адреси, які клієнт мусить вгадати без нашого коду (`T029`).
//!
//! Кожна з них деривується двічі: тут — із seeds програми, у
//! `packages/sdk/tests/pda.test.ts` — із seeds, виписаних у TypeScript. Обидва
//! боки звіряються з тими самими літералами base58, тож змінений seed валить
//! той бік, який не змінювали.
//!
//! Навіщо взагалі два джерела. Резолвер Anchor обчислює seeds не завжди:
//! `consent` у програмі має `consent_version.saturating_add(1)`, а вираз він не
//! рахує, — і клієнт, який деривує сам, уже існує (`T017`). Питання не в тому,
//! дублювати чи ні, а в тому, ловиться розходження тестом чи транзакцією в
//! мережі.
//!
//! Асоційований токен-акаунт тут теж не зайвий: у `packages/sdk` він
//! обчислюється трьома seeds руками, без `@solana/spl-token`, і цей тест —
//! єдине місце, де ця формула звіряється з реалізацією, якій вірить мережа.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use genovault::state::{PlatformConfig, Run, RunResult};

/// Ті самі два ключі, що в тесті SDK. Значення довільні; важливо, щоб вони
/// збігалися з тим боком, інакше звірка перевіряє два різні питання.
const BUYER: &str = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const MINT: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NONCE: u64 = 42;

fn buyer() -> Pubkey {
    BUYER.parse().unwrap()
}

#[test]
fn vault_address_matches_sdk() {
    let (vault, _) = Pubkey::find_program_address(&[PlatformConfig::VAULT_SEED], &genovault::ID);
    assert_eq!(vault.to_string(), "8gn6vk6KDHJ3Gt8Act7gK1A8ZEHYvbSHJREABxPkJxSK");
}

#[test]
fn run_address_matches_sdk() {
    let (run, _) = Pubkey::find_program_address(
        &[Run::SEED, buyer().as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    assert_eq!(run.to_string(), "7wGaxUS9vcfmAzTbPMCBAEvbbkTTYPEoHshmywLsEJej");
}

#[test]
fn run_result_address_matches_sdk() {
    let (run, _) = Pubkey::find_program_address(
        &[Run::SEED, buyer().as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    let (result, _) = Pubkey::find_program_address(&[RunResult::SEED, run.as_ref()], &genovault::ID);
    assert_eq!(
        result.to_string(),
        "7JwGcRD9xizCpbEtHSA4jYab5W7bv7uWmut8Km9L1yt4"
    );
}

#[test]
fn associated_token_address_matches_sdk() {
    let mint: Pubkey = MINT.parse().unwrap();
    let ata = get_associated_token_address_with_program_id(
        &buyer(),
        &mint,
        &anchor_spl::token_2022::ID,
    );
    assert_eq!(ata.to_string(), "ESuX35w52w3g46Q6nJyntikFxoNRR7EAyEfryrJGr2DV");
}

/// Порядок байтів нонса — не деталь кодування.
///
/// `1` і `2^56` це той самий байт на різних кінцях, тож на big-endian ці два
/// прогони отримали б адреси один одного: покупець, який замовив другий,
/// потрапив би в акаунт першого.
#[test]
fn nonce_is_little_endian() {
    let (first, _) = Pubkey::find_program_address(
        &[Run::SEED, buyer().as_ref(), &1u64.to_le_bytes()],
        &genovault::ID,
    );
    let (swapped, _) = Pubkey::find_program_address(
        &[Run::SEED, buyer().as_ref(), &1u64.to_be_bytes()],
        &genovault::ID,
    );
    assert_ne!(first, swapped);
    assert_eq!(first.to_string(), "8KP4d8tJXLtxrVGjTQASsfH4iHYbnqQwVCauyXayMnS6");
}
