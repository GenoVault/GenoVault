//! Тести згоди (`T011`, `FR-005`, `FR-007`).
//!
//! Чиста логіка перевірки живе юніт-тестами в `state/consent.rs`. Тут — те,
//! чого юніт не бачить: ланцюг версій, права власника і час ланцюга.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::consent::SetConsentArgs;
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::state::{buyer_category, use_type, Consent, Dataset};
use genovault::GenoVaultError;
use mollusk_svm::result::ProgramResult;
use mollusk_svm::Mollusk;
use solana_account::Account;

mod harness;
use harness::*;

const DATASET_ID: &str = "exome-cohort-2026";

fn default_args() -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY | use_type::RARE_DISEASE,
        forbidden_uses: 0,
        buyer_categories: buyer_category::ACADEMIC | buyer_category::NON_PROFIT,
        expires_at: None,
    }
}

fn register_ix(owner: Pubkey, dataset: Pubkey) -> Instruction {
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RegisterDataset {
            owner,
            dataset,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::RegisterDataset {
            args: RegisterDatasetArgs {
                dataset_id: DATASET_ID.to_string(),
                content_hash: [7u8; 32],
                record_count_claimed: 10_000,
                price_per_1k: 25_000_000,
            },
        }
        .data(),
    }
}

fn set_consent_ix(
    owner: Pubkey,
    dataset: Pubkey,
    previous_consent: Option<Pubkey>,
    next_version: u32,
    args: SetConsentArgs,
) -> Instruction {
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::SetConsent {
            owner,
            dataset,
            previous_consent,
            consent: consent_pda(&dataset, next_version),
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::SetConsent { args }.data(),
    }
}

/// Датасет із порожньою згодою — стартова точка всіх тестів нижче.
struct Fixture {
    mollusk: Mollusk,
    owner: Pubkey,
    dataset: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

fn with_dataset() -> Fixture {
    let mollusk = mollusk();
    let owner = Pubkey::new_unique();
    let dataset = dataset_pda(&owner, DATASET_ID);

    let mut accounts = vec![
        (owner, funded_wallet()),
        empty(dataset),
        system_program(),
    ];
    // Місце під перші три версії згоди — mollusk не створює акаунтів сам.
    for version in 1..=3u32 {
        accounts.push(empty(consent_pda(&dataset, version)));
    }

    let result = mollusk.process_instruction(&register_ix(owner, dataset), &accounts);
    assert_eq!(result.program_result, ProgramResult::Success);

    Fixture {
        mollusk,
        owner,
        dataset,
        accounts: result.resulting_accounts,
    }
}

/// Датасет із першою версією згоди.
fn with_consent() -> Fixture {
    let f = with_dataset();
    let ix = set_consent_ix(f.owner, f.dataset, None, 1, default_args());
    let result = f.mollusk.process_instruction(&ix, &f.accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "перша згода має записуватись: {:?}",
        result.program_result
    );
    Fixture {
        accounts: result.resulting_accounts,
        ..f
    }
}

#[test]
fn the_first_consent_has_no_predecessor() {
    let f = with_consent();
    let consent: Consent = read(&f.accounts, &consent_pda(&f.dataset, 1));

    assert_eq!(consent.dataset, f.dataset);
    assert_eq!(consent.version, 1);
    assert_eq!(consent.allowed_uses, default_args().allowed_uses);
    assert!(consent.prev_version.is_none());
    assert!(consent.revoked_at.is_none());

    let dataset: Dataset = read(&f.accounts, &f.dataset);
    assert_eq!(
        dataset.consent_version, 1,
        "датасет має знати, де шукати чинну згоду"
    );
}

#[test]
fn a_new_version_points_at_the_old_one_and_leaves_it_alone() {
    let f = with_consent();
    let first = consent_pda(&f.dataset, 1);

    let ix = set_consent_ix(
        f.owner,
        f.dataset,
        Some(first),
        2,
        SetConsentArgs {
            allowed_uses: use_type::ALL,
            forbidden_uses: use_type::PHARMA_COMMERCIAL,
            ..default_args()
        },
    );
    let result = f.mollusk.process_instruction(&ix, &f.accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "{:?}",
        result.program_result
    );

    let second: Consent = read(&result.resulting_accounts, &consent_pda(&f.dataset, 2));
    assert_eq!(second.version, 2);
    assert_eq!(second.prev_version, Some(first));
    assert_eq!(second.forbidden_uses, use_type::PHARMA_COMMERCIAL);

    // Головне у `FR-005`: попередня версія лишилась така, як була.
    let previous: Consent = read(&result.resulting_accounts, &first);
    assert_eq!(previous.version, 1);
    assert_eq!(previous.allowed_uses, default_args().allowed_uses);
    assert_eq!(previous.forbidden_uses, 0);
}

#[test]
fn a_second_version_without_the_first_is_refused() {
    let f = with_consent();

    // Адреса нової версії правильна — клієнт лише «забув» попередню, щоб
    // обірвати ланцюг. Саме цей випадок і має ловити програма: акаунт другої
    // версії без посилання на першу читався б як перша згода датасету.
    let ix = set_consent_ix(f.owner, f.dataset, None, 2, default_args());
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::PreviousConsentMissing)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn a_foreign_consent_cannot_be_passed_as_the_predecessor() {
    let f = with_consent();

    // Другий власник із власним датасетом і власною згодою — саме те, що
    // спробував би підставити клієнт, який будує ланцюг сам. Ланцюг має
    // будувати програма: інакше «посилання на попередню» не доводить нічого.
    let stranger = Pubkey::new_unique();
    let foreign_dataset = dataset_pda(&stranger, DATASET_ID);
    let foreign_consent = consent_pda(&foreign_dataset, 1);

    let mut accounts = f.accounts.clone();
    accounts.push((stranger, funded_wallet()));
    accounts.push(empty(foreign_dataset));
    accounts.push(empty(foreign_consent));

    let registered = f
        .mollusk
        .process_instruction(&register_ix(stranger, foreign_dataset), &accounts);
    assert_eq!(registered.program_result, ProgramResult::Success);

    let consented = f.mollusk.process_instruction(
        &set_consent_ix(stranger, foreign_dataset, None, 1, default_args()),
        &registered.resulting_accounts,
    );
    assert_eq!(consented.program_result, ProgramResult::Success);

    let ix = set_consent_ix(f.owner, f.dataset, Some(foreign_consent), 2, default_args());
    let result = f
        .mollusk
        .process_instruction(&ix, &consented.resulting_accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn a_stranger_cannot_set_consent() {
    let f = with_dataset();
    let stranger = Pubkey::new_unique();

    let ix = set_consent_ix(stranger, f.dataset, None, 1, default_args());
    let mut accounts = f.accounts.clone();
    accounts.push((stranger, funded_wallet()));

    let result = f.mollusk.process_instruction(&ix, &accounts);
    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn a_consent_that_allows_nothing_is_refused() {
    let f = with_dataset();

    // Дозвіл і заборона гасять одне одного повністю. Це відкликання, вдягнене
    // як згода: у журналі воно не мало б ані дати відкликання, ані причини.
    let ix = set_consent_ix(
        f.owner,
        f.dataset,
        None,
        1,
        SetConsentArgs {
            allowed_uses: use_type::ONCOLOGY,
            forbidden_uses: use_type::ONCOLOGY,
            ..default_args()
        },
    );
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentAllowsNothing)),
        "{:?}",
        result.program_result
    );
}

#[test]
fn bits_outside_the_dictionary_are_refused() {
    let f = with_dataset();

    let unknown_use = set_consent_ix(
        f.owner,
        f.dataset,
        None,
        1,
        SetConsentArgs {
            allowed_uses: use_type::ONCOLOGY | 1 << 30,
            ..default_args()
        },
    );
    assert_eq!(
        custom_error_code(&f.mollusk.process_instruction(&unknown_use, &f.accounts)),
        Some(expected(GenoVaultError::UnknownUseType)),
        "біт «про запас» став би дозволом сам собою, коли словник розширять"
    );

    let unknown_category = set_consent_ix(
        f.owner,
        f.dataset,
        None,
        1,
        SetConsentArgs {
            buyer_categories: 1 << 20,
            ..default_args()
        },
    );
    assert_eq!(
        custom_error_code(&f.mollusk.process_instruction(&unknown_category, &f.accounts)),
        Some(expected(GenoVaultError::UnknownBuyerCategory))
    );
}

#[test]
fn an_expiry_in_the_past_is_refused() {
    let f = with_dataset();
    let now = f.mollusk.sysvars.clock.unix_timestamp;

    let ix = set_consent_ix(
        f.owner,
        f.dataset,
        None,
        1,
        SetConsentArgs {
            expires_at: Some(now),
            ..default_args()
        },
    );
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentExpiryInPast)),
        "згода, що вже протухла на момент запису, — це не згода: {:?}",
        result.program_result
    );
}

#[test]
fn revocation_marks_the_current_version_and_is_not_repeatable() {
    let f = with_consent();
    let current = consent_pda(&f.dataset, 1);

    let revoke = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RevokeConsent {
            owner: f.owner,
            dataset: f.dataset,
            consent: current,
        }
        .to_account_metas(None),
        data: genovault::instruction::RevokeConsent {}.data(),
    };

    let result = f.mollusk.process_instruction(&revoke, &f.accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "{:?}",
        result.program_result
    );

    let consent: Consent = read(&result.resulting_accounts, &current);
    assert!(consent.revoked_at.is_some());
    assert_eq!(
        consent.version, 1,
        "відкликання — подія в історії згоди, а не нова версія"
    );

    let again = f
        .mollusk
        .process_instruction(&revoke, &result.resulting_accounts);
    assert_eq!(
        custom_error_code(&again),
        Some(expected(GenoVaultError::ConsentAlreadyRevoked)),
        "друге відкликання зсунуло б дату й зробило журнал брехливим"
    );
}

#[test]
fn consent_survives_the_dataset_being_updated() {
    let f = with_consent();

    let update = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::UpdateDataset {
            owner: f.owner,
            dataset: f.dataset,
        }
        .to_account_metas(None),
        data: genovault::instruction::UpdateDatasetContent {
            content_hash: [9u8; 32],
            record_count_claimed: 11_000,
        }
        .data(),
    };

    let result = f.mollusk.process_instruction(&update, &f.accounts);
    assert_eq!(result.program_result, ProgramResult::Success);

    // Нова версія вмісту не скидає згоду: власник погоджувався на тип
    // використання, а не на конкретний файл.
    let dataset: Dataset = read(&result.resulting_accounts, &f.dataset);
    assert_eq!(dataset.version, 2);
    assert_eq!(dataset.consent_version, 1);
}
