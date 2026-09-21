//! Відкликання не чіпає прогонів, замовлених до нього (`T036`, `FR-007`).
//!
//! `tests/request_run.rs` доводить першу половину `FR-007`: замовлення після
//! відкликання відхиляється. Тут — друга: прогін, замовлений **до**, живе
//! далі, і різниця між двома замовленнями на тому самому пулі — лише мить, у
//! яку вони зроблені.
//!
//! Що саме означає «живе далі» на стенді, де програми Arcium немає: акаунт
//! прогону не змінюється ні на байт, депозит лишається в сейфі, а диспетчер
//! відкриває прогін під обчислення так само, як відкрив би без відкликання.
//! Далі шлях іде через чергу обчислень, якої тут немає; розподіл плати після
//! розкриття доводить `tests/settle_run.rs`, і він згоди не читає взагалі.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::consent::SetConsentArgs;
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::instructions::request_run::{RequestRunArgs, RECIPE_FREQUENCIES};
use genovault::state::{
    buyer_category, use_type, Consent, Dataset, FrequenciesParams, Run, RunAccumulator, RunStatus,
    FILTER_ANY,
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

/// Два замовлення на одному пулі: до відкликання і після.
const NONCE_BEFORE: u64 = 42;
const NONCE_AFTER: u64 = 43;

const BUYER_KEY: [u8; 32] = [5u8; 32];

const FREQUENCIES_PARAMS: FrequenciesParams = FrequenciesParams {
    min_age: 18,
    max_age: 90,
    sex_filter: FILTER_ANY,
    affected_filter: FILTER_ANY,
};

fn consent_args() -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY | use_type::RARE_DISEASE,
        forbidden_uses: 0,
        buyer_categories: buyer_category::ACADEMIC | buyer_category::NON_PROFIT,
        expires_at: None,
    }
}

fn args(nonce: u64, dispatcher: Pubkey) -> RequestRunArgs {
    RequestRunArgs {
        nonce,
        recipe_id: RECIPE_FREQUENCIES,
        use_type: use_type::ONCOLOGY,
        buyer_category: buyer_category::ACADEMIC,
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
    datasets: Vec<Pubkey>,
    owners: Vec<Pubkey>,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    /// Платформа, сейф, два датасети зі згодою, покупець із грошима і
    /// диспетчер — той самий шлях, що й у `tests/request_run.rs`.
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

        let mut accounts = vec![
            (authority, funded_wallet()),
            (buyer, funded_wallet()),
            (dispatcher, funded_wallet()),
            empty(config),
            empty(vault),
            (mint, mint_account(DECIMALS, BUYER_FUNDS)),
            (buyer_tokens, token_account(mint, buyer, BUYER_FUNDS)),
            system_program(),
            token2022::keyed_account(),
        ];

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
        assert_eq!(result.program_result, ProgramResult::Success, "сейф");
        accounts = result.resulting_accounts;

        let mut datasets = Vec::new();
        let mut owners = Vec::new();
        for dataset_id in ["exome-alpha", "exome-beta"] {
            let owner = Pubkey::new_unique();
            let dataset = dataset_pda(&owner, dataset_id);
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
                        content_hash: [7u8; 32],
                        record_count_claimed: RECORDS,
                        price_per_1k: PRICE_PER_1K,
                    },
                }
                .data(),
            };
            let result = mollusk.process_instruction(&register, &accounts);
            assert_eq!(result.program_result, ProgramResult::Success, "реєстрація");
            accounts = result.resulting_accounts;

            let set_consent = Instruction {
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
                    args: consent_args(),
                }
                .data(),
            };
            let result = mollusk.process_instruction(&set_consent, &accounts);
            assert_eq!(result.program_result, ProgramResult::Success, "згода");
            accounts = result.resulting_accounts;

            datasets.push(dataset);
            owners.push(owner);
        }

        for nonce in [NONCE_BEFORE, NONCE_AFTER] {
            let run = run_pda(&buyer, nonce);
            accounts.push(empty(run));
            accounts.push(empty(accumulator_pda(&run).0));
            accounts.push(empty(batch_buffer_pda(&run).0));
        }

        Self {
            mollusk,
            buyer,
            buyer_tokens,
            dispatcher,
            mint,
            vault,
            config,
            datasets,
            owners,
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

    fn request_ix(&self, nonce: u64) -> Instruction {
        let mut accounts = genovault::accounts::RequestRun {
            buyer: self.buyer,
            config: self.config,
            run: run_pda(&self.buyer, nonce),
            mint: self.mint,
            buyer_tokens: self.buyer_tokens,
            vault: self.vault,
            token_program: token2022::ID,
            system_program: system_program_id(),
        }
        .to_account_metas(None);
        for dataset in &self.datasets {
            accounts.push(AccountMeta::new_readonly(*dataset, false));
            accounts.push(AccountMeta::new_readonly(consent_pda(dataset, 1), false));
        }
        Instruction {
            program_id: genovault::ID,
            accounts,
            data: genovault::instruction::RequestRun {
                args: args(nonce, self.dispatcher),
            }
            .data(),
        }
    }

    fn revoke_ix(&self, index: usize) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::RevokeConsent {
                owner: self.owners[index],
                dataset: self.datasets[index],
                consent: consent_pda(&self.datasets[index], 1),
            }
            .to_account_metas(None),
            data: genovault::instruction::RevokeConsent {}.data(),
        }
    }

    fn open_ix(&self, nonce: u64) -> Instruction {
        let run = run_pda(&self.buyer, nonce);
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::OpenRun {
                dispatcher: self.dispatcher,
                run,
                accumulator: accumulator_pda(&run).0,
                buffer: batch_buffer_pda(&run).0,
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
}

#[test]
fn a_run_ordered_before_revocation_is_left_alone() {
    let mut f = Fixture::new();
    let run = run_pda(&f.buyer, NONCE_BEFORE);

    let result = f.apply(&f.request_ix(NONCE_BEFORE));
    assert!(is_success(&result), "{:?}", result.program_result);
    let run_before = f.account(&run).clone();
    let vault_before = token_amount(&f.accounts, &f.vault);
    assert_eq!(vault_before, COST * 2, "депозит за обидва датасети в сейфі");

    let result = f.apply(&f.revoke_ix(1));
    assert!(is_success(&result), "{:?}", result.program_result);
    let consent: Consent = read(&f.accounts, &consent_pda(&f.datasets[1], 1));
    assert!(consent.revoked_at.is_some(), "згоду відкликано");

    // Акаунт прогону — байт у байт той самий: відкликання не переписує
    // статусу, не знімає датасету з пулу і не рухає депозиту.
    assert_eq!(f.account(&run).data, run_before.data);
    assert_eq!(f.account(&run).lamports, run_before.lamports);
    assert_eq!(token_amount(&f.accounts, &f.vault), vault_before);

    let state: Run = read(&f.accounts, &run);
    assert_eq!(state.status, RunStatus::Accepted);
    assert_eq!(
        state.datasets.len(),
        2,
        "відкликаний датасет лишається в пулі"
    );
    assert_eq!(state.escrow_amount, COST * 2);
}

#[test]
fn the_dispatcher_still_opens_a_run_ordered_before_revocation() {
    // `FR-006` перевіряє згоду як умову виконання — при замовленні. Далі
    // обчислювальний шар веде прогін за тим, що зафіксовано в `Run`, і
    // відкликання посеред дороги його не зупиняє: інакше «завершені прогони
    // лишаються дійсними» трималось би на тому, що власник не встиг.
    let mut f = Fixture::new();
    let run = run_pda(&f.buyer, NONCE_BEFORE);

    assert!(is_success(&f.apply(&f.request_ix(NONCE_BEFORE))));
    assert!(is_success(&f.apply(&f.revoke_ix(1))));

    let result = f.apply(&f.open_ix(NONCE_BEFORE));
    assert!(is_success(&result), "{:?}", result.program_result);

    let accumulator: RunAccumulator = read(&f.accounts, &accumulator_pda(&run).0);
    assert_eq!(accumulator.run, run, "накопичувач створено під цей прогін");
}

#[test]
fn the_same_pool_ordered_after_revocation_is_refused() {
    // Той самий пул, той самий покупець, ті самі аргументи — інший лише
    // момент. До відкликання замовлення проходить, після — відхиляється, і
    // відмова називає саме відкликання, а не «тип не дозволений».
    let mut f = Fixture::new();

    assert!(is_success(&f.apply(&f.request_ix(NONCE_BEFORE))));
    assert!(is_success(&f.apply(&f.revoke_ix(1))));

    let result = f.apply(&f.request_ix(NONCE_AFTER));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentIsRevoked))
    );

    // І гроші за відхилене замовлення не рухались: сейф тримає рівно перший
    // депозит.
    assert_eq!(token_amount(&f.accounts, &f.vault), COST * 2);
    let state: Run = read(&f.accounts, &run_pda(&f.buyer, NONCE_BEFORE));
    assert_eq!(
        state.status,
        RunStatus::Accepted,
        "перший прогін не зачепило"
    );
}

#[test]
fn a_new_consent_after_revocation_reopens_ordering_without_touching_the_old_run() {
    // Відкликання — подія в історії згоди, а не її кінець: власник дає нову
    // версію, і замовлення знову проходить. Старий прогін і далі посилається
    // на версію 1, яка так і лишається відкликаною.
    let mut f = Fixture::new();
    let old_run = run_pda(&f.buyer, NONCE_BEFORE);
    let dataset = f.datasets[1];

    assert!(is_success(&f.apply(&f.request_ix(NONCE_BEFORE))));
    let old_run_data = f.account(&old_run).data.clone();
    assert!(is_success(&f.apply(&f.revoke_ix(1))));

    f.accounts.push(empty(consent_pda(&dataset, 2)));
    let renew = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::SetConsent {
            owner: f.owners[1],
            dataset,
            previous_consent: Some(consent_pda(&dataset, 1)),
            consent: consent_pda(&dataset, 2),
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::SetConsent {
            args: consent_args(),
        }
        .data(),
    };
    let result = f.apply(&renew);
    assert!(is_success(&result), "{:?}", result.program_result);

    // Замовлення після оновлення бере чинну версію — другу.
    let mut request = f.request_ix(NONCE_AFTER);
    let stale = consent_pda(&dataset, 1);
    for meta in &mut request.accounts {
        if meta.pubkey == stale {
            meta.pubkey = consent_pda(&dataset, 2);
        }
    }
    let result = f.apply(&request);
    assert!(is_success(&result), "{:?}", result.program_result);

    assert_eq!(f.account(&old_run).data, old_run_data);
    let old_consent: Consent = read(&f.accounts, &stale);
    assert!(
        old_consent.revoked_at.is_some(),
        "перша версія лишається відкликаною"
    );
    let dataset_state: Dataset = read(&f.accounts, &dataset);
    assert_eq!(dataset_state.consent_version, 2);
}
