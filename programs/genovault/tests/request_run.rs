//! Тести замовлення прогону (`T024`, `FR-013`, `FR-015a`, `FR-016`).
//!
//! Чиста арифметика вартості й машина станів живуть юніт-тестами в
//! `state/run.rs`. Тут — те, чого юніт не бачить: склад пулу з
//! `remaining_accounts`, перевірка згоди кожного датасету ончейн, стеля
//! депозиту й сам переказ у сейф.
//!
//! Переказ перевіряється по-справжньому, а не «все, крім нього»: Token-2022
//! їде в стенд окремою програмою. Тест, який зупиняється перед CPI, зеленіє на
//! найдорожчій частині інструкції — тій, що рухає гроші.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::consent::SetConsentArgs;
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::instructions::request_run::{RequestRunArgs, RECIPE_FREQUENCIES};
use genovault::state::{buyer_category, use_type, Dataset, PlatformConfig, Run, RunStatus};
use genovault::GenoVaultError;
use mollusk_svm::result::{InstructionResult, ProgramResult};
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::token2022;
use solana_account::Account;
use solana_program_option::COption;
use spl_token_interface::state::{Account as TokenAccountState, AccountState, Mint as MintState};

mod harness;
use harness::*;

/// Ціна датасету: 25 000 000 за 1000 записів, 10 000 записів → 250 000 000.
const PRICE_PER_1K: u64 = 25_000_000;
const RECORDS: u64 = 10_000;
const COST: u64 = PRICE_PER_1K / 1_000 * RECORDS;
const DECIMALS: u8 = 6;
const BUYER_FUNDS: u64 = 10_000_000_000;
const FEE_BPS: u16 = 700;
const NONCE: u64 = 42;

fn vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PlatformConfig::VAULT_SEED], &genovault::ID)
}

fn mint_account() -> Account {
    token2022::create_account_for_mint(MintState {
        mint_authority: COption::Some(Pubkey::new_unique()),
        supply: BUYER_FUNDS,
        decimals: DECIMALS,
        is_initialized: true,
        freeze_authority: COption::None,
    })
}

fn token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    token2022::create_account_for_token_account(TokenAccountState {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    })
}

fn token_amount(accounts: &[(Pubkey, Account)], key: &Pubkey) -> u64 {
    let (_, account) = accounts
        .iter()
        .find(|(candidate, _)| candidate == key)
        .expect("токен-акаунт має бути серед результатів");
    u64::from_le_bytes(account.data[64..72].try_into().expect("amount — 8 байтів"))
}

fn default_consent() -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY | use_type::RARE_DISEASE,
        forbidden_uses: 0,
        buyer_categories: buyer_category::ACADEMIC | buyer_category::NON_PROFIT,
        expires_at: None,
    }
}

fn register_ix(owner: Pubkey, dataset: Pubkey, dataset_id: &str) -> Instruction {
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
                dataset_id: dataset_id.to_string(),
                content_hash: [7u8; 32],
                record_count_claimed: RECORDS,
                price_per_1k: PRICE_PER_1K,
            },
        }
        .data(),
    }
}

fn set_consent_ix(
    owner: Pubkey,
    dataset: Pubkey,
    previous: Option<Pubkey>,
    version: u32,
    args: SetConsentArgs,
) -> Instruction {
    Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::SetConsent {
            owner,
            dataset,
            previous_consent: previous,
            consent: consent_pda(&dataset, version),
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::SetConsent { args }.data(),
    }
}

/// Платформа, сейф, два датасети зі згодою і покупець із грошима.
struct Fixture {
    mollusk: Mollusk,
    buyer: Pubkey,
    buyer_tokens: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
    config: Pubkey,
    datasets: Vec<Pubkey>,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    /// Пари «датасет + чинна згода» в тому порядку, в якому їх читає програма.
    fn pool(&self, datasets: &[Pubkey]) -> Vec<AccountMeta> {
        datasets
            .iter()
            .flat_map(|dataset| {
                [
                    AccountMeta::new_readonly(*dataset, false),
                    AccountMeta::new_readonly(consent_pda(dataset, 1), false),
                ]
            })
            .collect()
    }

    fn request_ix(&self, pool: Vec<AccountMeta>, args: RequestRunArgs) -> Instruction {
        let mut accounts = genovault::accounts::RequestRun {
            buyer: self.buyer,
            config: self.config,
            run: run_pda(&self.buyer, args.nonce),
            mint: self.mint,
            buyer_tokens: self.buyer_tokens,
            vault: self.vault,
            token_program: token2022::ID,
            system_program: system_program_id(),
        }
        .to_account_metas(None);
        accounts.extend(pool);

        Instruction {
            program_id: genovault::ID,
            accounts,
            data: genovault::instruction::RequestRun { args }.data(),
        }
    }

    fn request(&self, args: RequestRunArgs) -> InstructionResult {
        let pool = self.pool(&self.datasets);
        self.mollusk
            .process_instruction(&self.request_ix(pool, args), &self.accounts)
    }
}

fn args() -> RequestRunArgs {
    RequestRunArgs {
        nonce: NONCE,
        recipe_id: RECIPE_FREQUENCIES,
        use_type: use_type::ONCOLOGY,
        buyer_category: buyer_category::ACADEMIC,
        max_escrow: COST * 2,
    }
}

fn fixture_with(dataset_ids: &[&str], consents: &[SetConsentArgs]) -> Fixture {
    let mut mollusk = mollusk();
    token2022::add_program(&mut mollusk);

    let authority = Pubkey::new_unique();
    let buyer = Pubkey::new_unique();
    let buyer_tokens = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let (config, _) = config_pda();
    let (vault, _) = vault_pda();

    let mut accounts = vec![
        (authority, funded_wallet()),
        (buyer, funded_wallet()),
        empty(config),
        empty(vault),
        (mint, mint_account()),
        (buyer_tokens, token_account(mint, buyer, BUYER_FUNDS)),
        system_program(),
        token2022::keyed_account(),
    ];

    // 1. Платформа.
    let initialize = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::Initialize {
            authority,
            config,
            mint,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::Initialize { fee_bps: FEE_BPS }.data(),
    };
    let result = mollusk.process_instruction(&initialize, &accounts);
    assert_eq!(result.program_result, ProgramResult::Success, "initialize");
    accounts = result.resulting_accounts;

    // 2. Сейф платформи — окремим кроком, як у розгортанні.
    let init_vault = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::InitializeVault {
            authority,
            config,
            mint,
            vault,
            token_program: token2022::ID,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::InitializeVault {}.data(),
    };
    let result = mollusk.process_instruction(&init_vault, &accounts);
    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "сейф має створюватись: {:?}",
        result.program_result
    );
    accounts = result.resulting_accounts;

    // 3. Датасети зі згодою — кожен від свого власника, як у справжньому пулі.
    let mut datasets = Vec::new();
    for (index, dataset_id) in dataset_ids.iter().enumerate() {
        let owner = Pubkey::new_unique();
        let dataset = dataset_pda(&owner, dataset_id);
        accounts.push((owner, funded_wallet()));
        accounts.push(empty(dataset));
        accounts.push(empty(consent_pda(&dataset, 1)));
        accounts.push(empty(consent_pda(&dataset, 2)));

        let result = mollusk.process_instruction(&register_ix(owner, dataset, dataset_id), &accounts);
        assert_eq!(result.program_result, ProgramResult::Success, "реєстрація");
        accounts = result.resulting_accounts;

        let consent = consents.get(index).cloned().unwrap_or_else(default_consent);
        let result =
            mollusk.process_instruction(&set_consent_ix(owner, dataset, None, 1, consent), &accounts);
        assert_eq!(result.program_result, ProgramResult::Success, "згода");
        accounts = result.resulting_accounts;

        datasets.push(dataset);
    }

    accounts.push(empty(run_pda(&buyer, NONCE)));

    Fixture {
        mollusk,
        buyer,
        buyer_tokens,
        mint,
        vault,
        config,
        datasets,
        accounts,
    }
}

fn fixture() -> Fixture {
    fixture_with(&["exome-alpha", "exome-beta"], &[])
}

// ── Успішний шлях ────────────────────────────────────────────────────────────

#[test]
fn locks_the_upper_bound_and_records_the_pool() {
    let f = fixture();
    let result = f.request(args());

    assert_eq!(
        result.program_result,
        ProgramResult::Success,
        "замовлення має проходити: {:?}",
        result.program_result
    );

    let run: Run = read(&result.resulting_accounts, &run_pda(&f.buyer, NONCE));
    assert_eq!(run.buyer, f.buyer);
    assert_eq!(run.status, RunStatus::Accepted);
    assert_eq!(run.datasets, f.datasets, "склад пулу — у порядку акаунтів");
    assert_eq!(
        run.escrow_amount,
        COST * 2,
        "депозит рахує програма з ончейн-цін, а не з аргументів покупця"
    );
    assert_eq!(run.settled_count, 0);
    assert_eq!(run.settled_amount, 0);
    assert!(run.result_hash.is_none());
}

#[test]
fn moves_the_deposit_into_the_vault() {
    let f = fixture();
    let result = f.request(args());
    assert!(is_success(&result));

    assert_eq!(
        token_amount(&result.resulting_accounts, &f.vault),
        COST * 2,
        "заблоковане мусить лежати в сейфі, а не лишитись обіцянкою"
    );
    assert_eq!(
        token_amount(&result.resulting_accounts, &f.buyer_tokens),
        BUYER_FUNDS - COST * 2
    );
}

#[test]
fn freezes_the_fee_at_order_time() {
    // Копія комісії, а не посилання на конфігурацію: інакше зміна комісії
    // переписувала б умови вже замовленого прогону (`FR-019`).
    let f = fixture();
    let result = f.request(args());
    let run: Run = read(&result.resulting_accounts, &run_pda(&f.buyer, NONCE));
    assert_eq!(run.fee_bps, FEE_BPS);
}

#[test]
fn a_dataset_smaller_than_a_thousand_records_is_not_free() {
    // Заокруглення вниз зробило б безкоштовним будь-який датасет, менший за
    // тисячу записів. Тут ціна 1 000 за тисячу і 9 записів → 9, а не 0.
    let f = fixture_with(&["exome-alpha"], &[]);
    let owner = Pubkey::new_unique();
    let dataset_id = "tiny-cohort";
    let dataset = dataset_pda(&owner, dataset_id);

    let mut accounts = f.accounts.clone();
    accounts.push((owner, funded_wallet()));
    accounts.push(empty(dataset));
    accounts.push(empty(consent_pda(&dataset, 1)));

    let register = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RegisterDataset {
            owner,
            dataset,
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::RegisterDataset {
            args: RegisterDatasetArgs {
                dataset_id: dataset_id.to_string(),
                content_hash: [9u8; 32],
                record_count_claimed: 9,
                price_per_1k: 1_000,
            },
        }
        .data(),
    };
    let result = f.mollusk.process_instruction(&register, &accounts);
    assert!(is_success(&result), "реєстрація малого датасету");
    accounts = result.resulting_accounts;

    let result = f.mollusk.process_instruction(
        &set_consent_ix(owner, dataset, None, 1, default_consent()),
        &accounts,
    );
    assert!(is_success(&result));
    accounts = result.resulting_accounts;

    let pool = f.pool(&[dataset]);
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &accounts);
    assert!(is_success(&result), "{:?}", result.program_result);

    let run: Run = read(&result.resulting_accounts, &run_pda(&f.buyer, NONCE));
    assert_eq!(run.escrow_amount, 9, "9 записів за ціною 1000 — це 9, не 0");
}

// ── Згода як умова ───────────────────────────────────────────────────────────

#[test]
fn a_revoked_consent_stops_the_whole_order() {
    // `FR-007`: відкликання діє на прогони, замовлені після нього. Пул падає
    // цілком — половини замовлення не буває.
    let f = fixture();
    let owner_of_second = {
        let dataset: Dataset = read(&f.accounts, &f.datasets[1]);
        dataset.owner
    };

    let revoke = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::RevokeConsent {
            owner: owner_of_second,
            dataset: f.datasets[1],
            consent: consent_pda(&f.datasets[1], 1),
        }
        .to_account_metas(None),
        data: genovault::instruction::RevokeConsent {}.data(),
    };
    let revoked = f.mollusk.process_instruction(&revoke, &f.accounts);
    assert!(is_success(&revoked), "відкликання має проходити");

    let pool = f.pool(&f.datasets);
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &revoked.resulting_accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentIsRevoked))
    );
}

#[test]
fn each_refusal_names_its_own_constraint() {
    // `FR-008`: покупець має бачити, що саме спрацювало, а не «доступ
    // заборонено». Кожен рядок тут — окреме рішення власника.
    let forbidden = SetConsentArgs {
        forbidden_uses: use_type::ONCOLOGY,
        ..default_consent()
    };
    let f = fixture_with(&["exome-alpha"], &[forbidden]);
    assert_eq!(
        custom_error_code(&f.request(args())),
        Some(expected(GenoVaultError::UseTypeForbidden))
    );

    let other_use = SetConsentArgs {
        allowed_uses: use_type::CARDIOLOGY,
        ..default_consent()
    };
    let f = fixture_with(&["exome-alpha"], &[other_use]);
    assert_eq!(
        custom_error_code(&f.request(args())),
        Some(expected(GenoVaultError::UseTypeNotAllowed))
    );

    let other_buyer = SetConsentArgs {
        buyer_categories: buyer_category::COMMERCIAL,
        ..default_consent()
    };
    let f = fixture_with(&["exome-alpha"], &[other_buyer]);
    assert_eq!(
        custom_error_code(&f.request(args())),
        Some(expected(GenoVaultError::BuyerCategoryNotAllowed))
    );
}

#[test]
fn a_consent_from_another_dataset_does_not_open_this_one() {
    // Найдорожча підміна з можливих: покупець підсовує дозвільну згоду чужого
    // датасету й отримує доступ, якого власник цих даних не давав.
    let strict = SetConsentArgs {
        allowed_uses: use_type::CARDIOLOGY,
        ..default_consent()
    };
    let f = fixture_with(&["exome-alpha", "exome-beta"], &[strict, default_consent()]);

    let pool = vec![
        AccountMeta::new_readonly(f.datasets[0], false),
        // Згода другого датасету — вона дозволяє онкологію.
        AccountMeta::new_readonly(consent_pda(&f.datasets[1], 1), false),
    ];

    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentDatasetMismatch))
    );
}

#[test]
fn an_older_consent_version_does_not_count() {
    // Стара, дозвільніша згода лишається в ланцюгу назавжди (`FR-005`), тож
    // без цієї перевірки звузити згоду було б неможливо.
    let f = fixture_with(&["exome-alpha"], &[default_consent()]);
    let owner = {
        let dataset: Dataset = read(&f.accounts, &f.datasets[0]);
        dataset.owner
    };

    let narrowed = SetConsentArgs {
        allowed_uses: use_type::CARDIOLOGY,
        ..default_consent()
    };
    let second = f.mollusk.process_instruction(
        &set_consent_ix(
            owner,
            f.datasets[0],
            Some(consent_pda(&f.datasets[0], 1)),
            2,
            narrowed,
        ),
        &f.accounts,
    );
    assert!(is_success(&second), "друга версія: {:?}", second.program_result);

    // Пул із першою версією — тією, що дозволяла онкологію.
    let pool = vec![
        AccountMeta::new_readonly(f.datasets[0], false),
        AccountMeta::new_readonly(consent_pda(&f.datasets[0], 1), false),
    ];
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &second.resulting_accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentVersionStale))
    );
}

#[test]
fn a_dataset_without_consent_cannot_be_ordered() {
    let f = fixture_with(&["exome-alpha"], &[]);

    // Другий датасет — зареєстрований, але без жодної згоди.
    let owner = Pubkey::new_unique();
    let dataset_id = "no-consent";
    let dataset = dataset_pda(&owner, dataset_id);
    let mut accounts = f.accounts.clone();
    accounts.push((owner, funded_wallet()));
    accounts.push(empty(dataset));
    accounts.push(empty(consent_pda(&dataset, 1)));

    let result = f
        .mollusk
        .process_instruction(&register_ix(owner, dataset, dataset_id), &accounts);
    assert!(is_success(&result));
    accounts = result.resulting_accounts;

    // Акаунт згоди не існує — Anchor валить розбір акаунтів, і це теж названа
    // відмова, просто його власною.
    let pool = vec![
        AccountMeta::new_readonly(dataset, false),
        AccountMeta::new_readonly(consent_pda(&dataset, 1), false),
    ];
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &accounts);

    assert!(
        !is_success(&result),
        "датасет без згоди не може потрапити в прогін"
    );
}

// ── Гроші й склад ────────────────────────────────────────────────────────────

#[test]
fn the_buyer_ceiling_stops_a_price_raised_after_the_quote() {
    // Власник підняв ціну між квотою і підписом. Транзакція має впасти, а не
    // мовчки списати більше, ніж покупець бачив.
    let f = fixture();
    let result = f.request(RequestRunArgs {
        max_escrow: COST * 2 - 1,
        ..args()
    });

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunEscrowAboveMax))
    );
    assert_eq!(
        token_amount(&f.accounts, &f.buyer_tokens),
        BUYER_FUNDS,
        "невдале замовлення не рухає грошей"
    );
}

#[test]
fn the_same_dataset_twice_is_refused() {
    // Дублікат заплатив би одному власнику двічі за той самий вміст і зламав
    // би сходження сум (`SC-006`).
    let f = fixture();
    let pool = f.pool(&[f.datasets[0], f.datasets[0]]);
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunDuplicateDataset))
    );
}

#[test]
fn an_odd_number_of_accounts_is_refused() {
    // Загублена згода зсунула б усі пари на одиницю: згода одного датасету
    // перевірилась би проти сусіднього.
    let f = fixture();
    let mut pool = f.pool(&f.datasets);
    pool.pop();
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunAccountsMalformed))
    );
}

#[test]
fn a_pool_without_datasets_is_refused() {
    let f = fixture();
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(Vec::new(), args()), &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunAccountsMalformed))
    );
}

#[test]
fn an_unknown_recipe_is_refused() {
    // Каталог рецептів фіксований (`FR-011a`): номер без розгорнутого
    // визначення обчислення — це прогін, який ніхто не виконає.
    let f = fixture();
    let result = f.request(RequestRunArgs {
        recipe_id: 7,
        ..args()
    });

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::UnknownRecipe))
    );
}

#[test]
fn a_retired_dataset_cannot_be_ordered() {
    let f = fixture();
    let owner = {
        let dataset: Dataset = read(&f.accounts, &f.datasets[0]);
        dataset.owner
    };

    let retire = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::UpdateDataset {
            owner,
            dataset: f.datasets[0],
        }
        .to_account_metas(None),
        data: genovault::instruction::RetireDataset {}.data(),
    };
    let retired = f.mollusk.process_instruction(&retire, &f.accounts);
    assert!(is_success(&retired), "зняття: {:?}", retired.program_result);

    let pool = f.pool(&f.datasets);
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &retired.resulting_accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::DatasetNotActive))
    );
}

#[test]
fn a_foreign_account_cannot_pose_as_a_dataset() {
    // `Account::try_from` перевіряє власника й дискримінатор — саме на це ми
    // покладаємось замість перерахунку seeds на кожному з 50 датасетів.
    let f = fixture();
    let impostor = Pubkey::new_unique();
    let mut accounts = f.accounts.clone();
    accounts.push((
        impostor,
        Account {
            lamports: LAMPORTS_PER_SOL,
            data: vec![0u8; 200],
            owner: system_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    ));

    let pool = vec![
        AccountMeta::new_readonly(impostor, false),
        AccountMeta::new_readonly(consent_pda(&f.datasets[0], 1), false),
    ];
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)),
        "чужий акаунт не може вдавати датасет"
    );
}

#[test]
fn a_paused_platform_accepts_no_new_runs() {
    // Пауза зупиняє нові прогони, а не вже прийняті: інакше вона стала б
    // способом не платити власникам за виконану роботу.
    let f = fixture();
    let mut accounts = f.accounts.clone();
    let config: PlatformConfig = read(&accounts, &f.config);
    let paused = PlatformConfig {
        paused: true,
        ..config
    };
    for (key, account) in accounts.iter_mut() {
        if key == &f.config {
            let mut data = Vec::with_capacity(8 + PlatformConfig::INIT_SPACE);
            data.extend_from_slice(&account.data[..8]);
            paused.serialize(&mut data).expect("конфігурація серіалізується");
            data.resize(account.data.len(), 0);
            account.data = data;
        }
    }

    let pool = f.pool(&f.datasets);
    let result = f
        .mollusk
        .process_instruction(&f.request_ix(pool, args()), &accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::PlatformPaused))
    );
}
