//! Згода як передумова публікації в MPC (`T037`, `FR-006`).
//!
//! Обчислювальний шар не отримує доступу до даних, якщо перевірка згоди не
//! пройдена. На ланцюзі це тримається не окремою перевіркою перед публікацією,
//! а тим, що публікувати **нема чого**: усе, що диспетчер робить із прогоном
//! (`open_run`, `write_batch`, `dispatch_*`), починається з акаунта `Run`, а
//! `Run` пише лише `request_run` — і пише його після перевірки згоди кожного
//! датасету пулу.
//!
//! Тому тут три твердження, і разом вони замикають шлях:
//! - відхилене замовлення не лишає по собі нічого — ані акаунта, ані депозиту;
//! - без акаунта прогону диспетчер не відкриє ні накопичувача, ні буфера;
//! - акаунт прогону, який написав хтось інший, а не програма, прогоном не є.
//!
//! Далі за `open_run` — черга обчислень Arcium, якої на стенді немає. Але
//! кожна її інструкція бере той самий `Run` за тими самими seeds, тож для неї
//! ці твердження ті самі.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::consent::SetConsentArgs;
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::instructions::request_run::{RequestRunArgs, RECIPE_FREQUENCIES};
use genovault::state::{
    buyer_category, use_type, FrequenciesParams, Run, RunDataset, RunStatus, FILTER_ANY,
    RECIPE_PARAMS_LEN,
};
use genovault::GenoVaultError;
use mollusk_svm::result::{InstructionResult, ProgramResult};
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::token2022;
use solana_account::Account;

mod harness;
use harness::*;

const PRICE_PER_1K: u64 = 25_000_000;
const RECORDS: u64 = 10_000;
const COST: u64 = PRICE_PER_1K / 1_000 * RECORDS;
const DECIMALS: u8 = 6;
const BUYER_FUNDS: u64 = 10_000_000_000;
const FEE_BPS: u16 = 700;
const NONCE: u64 = 42;
const BUYER_KEY: [u8; 32] = [5u8; 32];

const FREQUENCIES_PARAMS: FrequenciesParams = FrequenciesParams {
    min_age: 18,
    max_age: 90,
    sex_filter: FILTER_ANY,
    affected_filter: FILTER_ANY,
};

/// Вузька згода: лише онкологія, лише академічним. Усе інше — відмова зі
/// своєю причиною.
fn narrow_consent() -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY,
        forbidden_uses: use_type::PHARMA_COMMERCIAL,
        buyer_categories: buyer_category::ACADEMIC,
        expires_at: None,
    }
}

fn args(use_type: u32, buyer_category: u32, dispatcher: Pubkey) -> RequestRunArgs {
    RequestRunArgs {
        nonce: NONCE,
        recipe_id: RECIPE_FREQUENCIES,
        use_type,
        buyer_category,
        max_escrow: COST * 2,
        buyer_x25519: BUYER_KEY,
        dispatcher,
        recipe_params: FREQUENCIES_PARAMS.encode(),
    }
}

struct Fixture {
    mollusk: Mollusk,
    buyer: Pubkey,
    buyer_tokens: Pubkey,
    dispatcher: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
    config: Pubkey,
    dataset: Pubkey,
    owner: Pubkey,
    run: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    fn new() -> Self {
        let mut mollusk = mollusk();
        token2022::add_program(&mut mollusk);

        let authority = Pubkey::new_unique();
        let buyer = Pubkey::new_unique();
        let buyer_tokens = Pubkey::new_unique();
        let dispatcher = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (config, _) = config_pda();
        let (vault, _) = vault_pda();
        let owner = Pubkey::new_unique();
        let dataset = dataset_pda(&owner, "exome-alpha");
        let run = run_pda(&buyer, NONCE);

        let mut accounts = vec![
            (authority, funded_wallet()),
            (buyer, funded_wallet()),
            (dispatcher, funded_wallet()),
            (owner, funded_wallet()),
            empty(config),
            empty(vault),
            empty(dataset),
            empty(consent_pda(&dataset, 1)),
            empty(run),
            empty(accumulator_pda(&run).0),
            empty(batch_buffer_pda(&run).0),
            (mint, mint_account(DECIMALS, BUYER_FUNDS)),
            (buyer_tokens, token_account(mint, buyer, BUYER_FUNDS)),
            system_program(),
            token2022::keyed_account(),
        ];

        let steps = [
            Instruction {
                program_id: genovault::ID,
                accounts: genovault::accounts::Initialize {
                    authority,
                    config,
                    mint,
                    system_program: system_program_id(),
                }
                .to_account_metas(None),
                data: genovault::instruction::Initialize { fee_bps: FEE_BPS }.data(),
            },
            Instruction {
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
            },
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
                        dataset_id: "exome-alpha".to_string(),
                        content_hash: [7u8; 32],
                        record_count_claimed: RECORDS,
                        price_per_1k: PRICE_PER_1K,
                    },
                }
                .data(),
            },
            Instruction {
                program_id: genovault::ID,
                accounts: genovault::accounts::SetConsent {
                    owner,
                    dataset,
                    previous_consent: None,
                    consent: consent_pda(&dataset, 1),
                    system_program: system_program_id(),
                }
                .to_account_metas(None),
                data: genovault::instruction::SetConsent {
                    args: narrow_consent(),
                }
                .data(),
            },
        ];
        for step in &steps {
            let result = mollusk.process_instruction(step, &accounts);
            assert_eq!(result.program_result, ProgramResult::Success, "підготовка");
            accounts = result.resulting_accounts;
        }

        Self {
            mollusk,
            buyer,
            buyer_tokens,
            dispatcher,
            mint,
            vault,
            config,
            dataset,
            owner,
            run,
            accounts,
        }
    }

    fn apply(&mut self, instruction: &Instruction) -> InstructionResult {
        let result = self
            .mollusk
            .process_instruction(instruction, &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    fn request_ix(&self, use_type: u32, buyer_category: u32) -> Instruction {
        let mut accounts = genovault::accounts::RequestRun {
            buyer: self.buyer,
            config: self.config,
            run: self.run,
            mint: self.mint,
            buyer_tokens: self.buyer_tokens,
            vault: self.vault,
            token_program: token2022::ID,
            system_program: system_program_id(),
        }
        .to_account_metas(None);
        accounts.push(AccountMeta::new_readonly(self.dataset, false));
        accounts.push(AccountMeta::new_readonly(
            consent_pda(&self.dataset, 1),
            false,
        ));
        Instruction {
            program_id: genovault::ID,
            accounts,
            data: genovault::instruction::RequestRun {
                args: args(use_type, buyer_category, self.dispatcher),
            }
            .data(),
        }
    }

    fn revoke_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::RevokeConsent {
                owner: self.owner,
                dataset: self.dataset,
                consent: consent_pda(&self.dataset, 1),
            }
            .to_account_metas(None),
            data: genovault::instruction::RevokeConsent {}.data(),
        }
    }

    fn open_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::OpenRun {
                dispatcher: self.dispatcher,
                run: self.run,
                accumulator: accumulator_pda(&self.run).0,
                buffer: batch_buffer_pda(&self.run).0,
                system_program: system_program_id(),
            }
            .to_account_metas(None),
            data: genovault::instruction::OpenRun {}.data(),
        }
    }

    fn account(&self, key: &Pubkey) -> &Account {
        &self
            .accounts
            .iter()
            .find(|(candidate, _)| candidate == key)
            .expect("акаунт є у фікстурі")
            .1
    }

    fn assert_nothing_happened(&self) {
        let run = self.account(&self.run);
        assert!(run.data.is_empty(), "акаунта прогону не створено");
        assert_eq!(run.lamports, 0);
        assert!(self.account(&accumulator_pda(&self.run).0).data.is_empty());
        assert!(self.account(&batch_buffer_pda(&self.run).0).data.is_empty());
        assert_eq!(
            token_amount(&self.accounts, &self.vault),
            0,
            "сейф порожній"
        );
        assert_eq!(
            token_amount(&self.accounts, &self.buyer_tokens),
            BUYER_FUNDS,
            "депозит не рухався"
        );
    }
}

#[test]
fn a_refused_order_leaves_nothing_behind() {
    // Кожна причина відмови — своя, і після кожної стан той самий, що й до
    // замовлення. Депозит перевіряється окремо від акаунта: інструкція, яка
    // впала після переказу, відкотилась би цілком, але це знає рантайм, а
    // тест зобов'язаний подивитись сам.
    let cases: [(u32, u32, GenoVaultError); 3] = [
        (
            use_type::CARDIOLOGY,
            buyer_category::ACADEMIC,
            GenoVaultError::UseTypeNotAllowed,
        ),
        (
            use_type::PHARMA_COMMERCIAL,
            buyer_category::ACADEMIC,
            GenoVaultError::UseTypeForbidden,
        ),
        (
            use_type::ONCOLOGY,
            buyer_category::COMMERCIAL,
            GenoVaultError::BuyerCategoryNotAllowed,
        ),
    ];

    for (use_type, buyer_category, error) in cases {
        let mut f = Fixture::new();
        let result = f.apply(&f.request_ix(use_type, buyer_category));
        assert_eq!(custom_error_code(&result), Some(expected(error)));
        f.assert_nothing_happened();
    }
}

#[test]
fn a_revoked_consent_refuses_the_order_the_same_way() {
    let mut f = Fixture::new();
    assert!(is_success(&f.apply(&f.revoke_ix())));

    let result = f.apply(&f.request_ix(use_type::ONCOLOGY, buyer_category::ACADEMIC));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentIsRevoked))
    );
    f.assert_nothing_happened();
}

#[test]
fn nothing_opens_for_a_run_that_was_never_accepted() {
    // Диспетчер, якого назвав покупець, приходить відкривати прогін, якого
    // не прийняли. Без `Run` немає ні seeds для накопичувача, ні для буфера —
    // байтам датасету просто нікуди лягти.
    let mut f = Fixture::new();
    let refused = f.apply(&f.request_ix(use_type::CARDIOLOGY, buyer_category::ACADEMIC));
    assert!(!is_success(&refused));

    let result = f.apply(&f.open_ix());
    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(
            anchor_lang::error::ErrorCode::AccountNotInitialized
        ))
    );
    f.assert_nothing_happened();
}

#[test]
fn a_run_the_program_did_not_write_is_not_a_run() {
    // Хтось кладе під адресу прогону правильні байти `Run` зі статусом
    // `Accepted` — але акаунт належить не програмі. Перевірку згоди робить
    // лише `request_run`, і саме тому програма вірить тільки тому `Run`, який
    // написала сама.
    let mut f = Fixture::new();
    let (_, bump) = Pubkey::find_program_address(
        &[Run::SEED, f.buyer.as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    let forged = Run {
        buyer: f.buyer,
        dispatcher: f.dispatcher,
        nonce: NONCE,
        recipe_id: RECIPE_FREQUENCIES,
        recipe_params: [0u8; RECIPE_PARAMS_LEN],
        use_type: use_type::CARDIOLOGY,
        buyer_category: buyer_category::ACADEMIC,
        buyer_x25519: BUYER_KEY,
        datasets: vec![RunDataset {
            dataset: f.dataset,
            price_per_1k: PRICE_PER_1K,
            records_included: 0,
            below_floor: false,
            settled: false,
        }],
        fee_bps: FEE_BPS,
        escrow_amount: COST,
        settled_count: 0,
        settled_amount: 0,
        refunded: false,
        status: RunStatus::Accepted,
        result_hash: None,
        records_included: 0,
        suppressed: false,
        dataset_cursor: 0,
        folded_batches: 0,
        folded_hash: [0u8; 32],
        created_at: 0,
        bump,
    };
    let mut account = stored(&forged, LAMPORTS_PER_SOL);
    account.owner = Pubkey::new_unique();
    let slot = f
        .accounts
        .iter()
        .position(|(key, _)| *key == f.run)
        .expect("місце під прогін є");
    f.accounts[slot].1 = account;

    let result = f.apply(&f.open_ix());
    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(
            anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram
        ))
    );
    assert!(f.account(&accumulator_pda(&f.run).0).data.is_empty());
    assert!(f.account(&batch_buffer_pda(&f.run).0).data.is_empty());
}
