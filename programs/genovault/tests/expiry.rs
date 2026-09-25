//! A consent deadline refuses the next run, and leaves the earlier one alone
//! (`FR-005`).
//!
//! `src/state/consent.rs` proves the comparison itself: `now < expires_at`, the
//! boundary exclusive. That is the pure function. Here the same deadline is
//! reached the way a buyer reaches it — through `request_run`, over a stand
//! running the built `.so`, with two orders on one pool differing in nothing
//! but the clock.
//!
//! The clock is the whole difficulty of this file. `mollusk` clears
//! `unix_timestamp` whenever the slot is warped, and a test that forgets it
//! measures `now = 0`, where no deadline ever passes and every assertion is
//! green for the wrong reason. So the timestamp is set directly and never
//! warped — and the run itself witnesses what the program read: `request_run`
//! stores `Run.created_at = now`, the same variable `Consent::check` compares
//! against the deadline. A wrong clock cannot survive that field.
//!
//! What is not here: `dispatch_*` after the deadline. Those end in a CPI into
//! the Arcium queue, which the stand does not have; `tests/revocation.rs` draws
//! the same line for revocation, and the live measurement is `T042`.
//!
//! Run with `scripts/wsl-test-program.sh`.

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

/// The stand opens here: 2026-01-01T00:00:00Z. A named instant rather than
/// whatever the default sysvar carries, because every assertion below is about
/// which side of the deadline the chain thinks it is on.
const T0: i64 = 1_767_225_600;
const TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
const EXPIRES_AT: i64 = T0 + TTL_SECONDS;

/// Two datasets in the pool: one whose owner set a deadline, one whose owner
/// did not. The second is the control — moving the clock must not make a
/// consent without a deadline expire.
const DATED: &str = "exome-dated";
const OPEN_ENDED: &str = "exome-open-ended";

const NONCE_BEFORE: u64 = 42;
const NONCE_AFTER: u64 = 43;
const NONCE_CONTROL: u64 = 44;

const BUYER_KEY: [u8; 32] = [5u8; 32];

const FREQUENCIES_PARAMS: FrequenciesParams = FrequenciesParams {
    min_age: 18,
    max_age: 90,
    sex_filter: FILTER_ANY,
    affected_filter: FILTER_ANY,
};

fn consent_args(expires_at: Option<i64>) -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY | use_type::RARE_DISEASE,
        forbidden_uses: 0,
        buyer_categories: buyer_category::ACADEMIC | buyer_category::NON_PROFIT,
        expires_at,
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
    /// Index 0 carries the deadline, index 1 does not.
    datasets: Vec<Pubkey>,
    owners: Vec<Pubkey>,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    fn new() -> Self {
        let mut mollusk = mollusk();
        token2022::add_program(&mut mollusk);
        // Assigned, not warped: `warp_to_slot` resets this field to zero, and a
        // zero clock is exactly the state in which this file proves nothing.
        mollusk.sysvars.clock.unix_timestamp = T0;

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
        assert_eq!(result.program_result, ProgramResult::Success, "vault");
        accounts = result.resulting_accounts;

        let mut datasets = Vec::new();
        let mut owners = Vec::new();
        for (dataset_id, expires_at) in [(DATED, Some(EXPIRES_AT)), (OPEN_ENDED, None)] {
            let owner = Pubkey::new_unique();
            let dataset = dataset_pda(&owner, dataset_id);
            accounts.push((owner, funded_wallet()));
            accounts.push(empty(dataset));
            accounts.push(empty(consent_pda(&dataset, 1)));
            accounts.push(empty(consent_pda(&dataset, 2)));

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
            assert_eq!(result.program_result, ProgramResult::Success, "register");
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
                    args: consent_args(expires_at),
                }
                .data(),
            };
            let result = mollusk.process_instruction(&set_consent, &accounts);
            assert_eq!(
                result.program_result,
                ProgramResult::Success,
                "consent for {dataset_id}"
            );
            accounts = result.resulting_accounts;

            datasets.push(dataset);
            owners.push(owner);
        }

        for nonce in [NONCE_BEFORE, NONCE_AFTER, NONCE_CONTROL] {
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

    fn set_clock(&mut self, now: i64) {
        self.mollusk.sysvars.clock.unix_timestamp = now;
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

    /// `pool` holds indices into `self.datasets`, so a test can order the whole
    /// pool or only the dataset whose consent carries no deadline.
    fn request_ix(&self, nonce: u64, pool: &[usize]) -> Instruction {
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
        for index in pool {
            let dataset = self.datasets[*index];
            let version = self.consent_version(&dataset);
            accounts.push(AccountMeta::new_readonly(dataset, false));
            accounts.push(AccountMeta::new_readonly(
                consent_pda(&dataset, version),
                false,
            ));
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

    fn consent_version(&self, dataset: &Pubkey) -> u32 {
        read::<Dataset>(&self.accounts, dataset).consent_version
    }

    fn account(&self, key: &Pubkey) -> &Account {
        &self
            .accounts
            .iter()
            .find(|(candidate, _)| candidate == key)
            .expect("account is in the fixture")
            .1
    }
}

const WHOLE_POOL: [usize; 2] = [0, 1];
const OPEN_ENDED_ONLY: [usize; 1] = [1];

#[test]
fn an_accepted_run_records_the_clock_the_deadline_was_checked_against() {
    // The guard for every other test in this file. `request_run` reads the
    // chain clock once and uses that one value twice: for `Consent::check` and
    // for `Run.created_at`. Reading the field back therefore says which
    // instant the deadline was compared with — and a stand left on a zero
    // clock, where no deadline can pass, fails right here instead of passing
    // everywhere.
    let mut f = Fixture::new();

    let result = f.apply(&f.request_ix(NONCE_BEFORE, &WHOLE_POOL));
    assert!(is_success(&result), "{:?}", result.program_result);

    let state: Run = read(&f.accounts, &run_pda(&f.buyer, NONCE_BEFORE));
    assert_eq!(
        state.created_at, T0,
        "the program read the clock the stand was set to"
    );
    assert!(
        state.created_at < EXPIRES_AT,
        "and that instant is before the deadline"
    );
}

#[test]
fn the_deadline_is_exclusive_on_the_way_through_request_run() {
    // One second before the deadline the order goes through; at the deadline
    // itself it does not. Nothing else differs — same buyer, same pool, same
    // arguments, same recipe — so the second of the two is the only cause, and
    // `expires_at` means "valid until", not "valid through".
    let mut f = Fixture::new();

    f.set_clock(EXPIRES_AT - 1);
    let result = f.apply(&f.request_ix(NONCE_BEFORE, &WHOLE_POOL));
    assert!(is_success(&result), "{:?}", result.program_result);
    let state: Run = read(&f.accounts, &run_pda(&f.buyer, NONCE_BEFORE));
    assert_eq!(state.created_at, EXPIRES_AT - 1);

    f.set_clock(EXPIRES_AT);
    let result = f.apply(&f.request_ix(NONCE_AFTER, &WHOLE_POOL));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentExpired)),
        "the deadline second is already outside the consent: {:?}",
        result.program_result
    );
}

#[test]
fn the_same_pool_ordered_after_the_deadline_is_refused_and_costs_nothing() {
    let mut f = Fixture::new();

    assert!(is_success(
        &f.apply(&f.request_ix(NONCE_BEFORE, &WHOLE_POOL))
    ));
    let vault_before = token_amount(&f.accounts, &f.vault);
    assert_eq!(vault_before, COST * 2, "deposit for both datasets");
    let buyer_before = token_amount(&f.accounts, &f.buyer_tokens);

    f.set_clock(EXPIRES_AT + TTL_SECONDS);
    let result = f.apply(&f.request_ix(NONCE_AFTER, &WHOLE_POOL));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::ConsentExpired)),
        "{:?}",
        result.program_result
    );

    // A refused order is not a cheaper order: the transfer sits behind every
    // check in `request_run`, so nothing moved in either direction.
    assert_eq!(token_amount(&f.accounts, &f.vault), vault_before);
    assert_eq!(token_amount(&f.accounts, &f.buyer_tokens), buyer_before);
    assert_eq!(
        f.account(&run_pda(&f.buyer, NONCE_AFTER)).data.len(),
        0,
        "no run account behind a refused order"
    );

    let earlier: Run = read(&f.accounts, &run_pda(&f.buyer, NONCE_BEFORE));
    assert_eq!(earlier.status, RunStatus::Accepted);
}

#[test]
fn only_the_consent_that_carries_a_deadline_expires() {
    // The control for moving the clock. `None` is not "expires at zero": past
    // the deadline of the other dataset, a consent without one still orders,
    // and the refusal above therefore belongs to the deadline rather than to
    // the clock having moved at all.
    let mut f = Fixture::new();
    let now = EXPIRES_AT + TTL_SECONDS;
    f.set_clock(now);

    let result = f.apply(&f.request_ix(NONCE_CONTROL, &OPEN_ENDED_ONLY));
    assert!(is_success(&result), "{:?}", result.program_result);

    let state: Run = read(&f.accounts, &run_pda(&f.buyer, NONCE_CONTROL));
    // Without this the test would pass on a clock that never moved, and then
    // it would be saying nothing: a deadline-free consent orders at any hour.
    assert_eq!(
        state.created_at, now,
        "ordered well past the other deadline"
    );
    assert_eq!(state.datasets.len(), 1);
    assert_eq!(state.datasets[0].dataset, f.datasets[1]);
    assert_eq!(state.escrow_amount, COST);
}

#[test]
fn a_run_ordered_before_the_deadline_is_left_alone_after_it() {
    // `FR-006` checks consent when the run is ordered. Past that point the run
    // carries its own terms, and a deadline that falls mid-computation does
    // not reach back into it: otherwise "a run already paid for completes"
    // would hold only while nobody's consent lapsed. Same statement as for
    // revocation in `tests/revocation.rs`, reached by the clock instead of by
    // an instruction — and the clock nobody has to send.
    let mut f = Fixture::new();
    let run = run_pda(&f.buyer, NONCE_BEFORE);

    assert!(is_success(
        &f.apply(&f.request_ix(NONCE_BEFORE, &WHOLE_POOL))
    ));
    let run_before = f.account(&run).clone();
    let vault_before = token_amount(&f.accounts, &f.vault);

    f.set_clock(EXPIRES_AT + TTL_SECONDS);

    // The deadline leaves no mark on the chain — nobody sends an instruction
    // when a date passes — so the test has to establish that it passed at all,
    // and the only witness is a fresh order being turned away. Without it
    // everything below would hold just as well on a clock that never moved.
    let refused = f.apply(&f.request_ix(NONCE_AFTER, &WHOLE_POOL));
    assert_eq!(
        custom_error_code(&refused),
        Some(expected(GenoVaultError::ConsentExpired)),
        "the deadline has passed by now"
    );

    assert_eq!(
        f.account(&run).data,
        run_before.data,
        "the deadline passing is not a write"
    );
    assert_eq!(f.account(&run).lamports, run_before.lamports);
    assert_eq!(token_amount(&f.accounts, &f.vault), vault_before);

    let result = f.apply(&f.open_ix(NONCE_BEFORE));
    assert!(
        is_success(&result),
        "the dispatcher still opens it: {:?}",
        result.program_result
    );
    let accumulator: RunAccumulator = read(&f.accounts, &accumulator_pda(&run).0);
    assert_eq!(accumulator.run, run);

    let state: Run = read(&f.accounts, &run);
    assert_eq!(
        state.datasets.len(),
        2,
        "the expired dataset stays in the pool it was paid for"
    );
}

#[test]
fn a_later_deadline_reopens_ordering_without_rewriting_the_expired_version() {
    // A deadline is a property of one version, not the end of the consent: the
    // owner signs a new version with a new date and ordering resumes. Version 1
    // keeps the date that lapsed, because `FR-005` wants the history readable —
    // the run above points at that version, and what it allowed has to stay
    // legible after it stopped allowing it.
    let mut f = Fixture::new();
    let old_run = run_pda(&f.buyer, NONCE_BEFORE);
    let dated = f.datasets[0];

    assert!(is_success(
        &f.apply(&f.request_ix(NONCE_BEFORE, &WHOLE_POOL))
    ));
    let old_run_data = f.account(&old_run).data.clone();

    f.set_clock(EXPIRES_AT);
    // "Reopens" only means something once it is closed, and a lapsed deadline
    // closes nothing visibly. So the refusal is taken first, on the same pool
    // the renewal will reopen; it leaves no account behind, and the nonce below
    // is still free.
    assert_eq!(
        custom_error_code(&f.apply(&f.request_ix(NONCE_AFTER, &WHOLE_POOL))),
        Some(expected(GenoVaultError::ConsentExpired)),
        "closed before the renewal"
    );

    let renew = Instruction {
        program_id: genovault::ID,
        accounts: genovault::accounts::SetConsent {
            owner: f.owners[0],
            dataset: dated,
            previous_consent: Some(consent_pda(&dated, 1)),
            consent: consent_pda(&dated, 2),
            system_program: system_program_id(),
        }
        .to_account_metas(None),
        data: genovault::instruction::SetConsent {
            args: consent_args(Some(EXPIRES_AT + TTL_SECONDS)),
        }
        .data(),
    };
    let result = f.apply(&renew);
    assert!(is_success(&result), "{:?}", result.program_result);

    // `request_ix` derives the consent address from `Dataset.consent_version`,
    // so this order picks up version 2 the way a client would.
    let result = f.apply(&f.request_ix(NONCE_AFTER, &WHOLE_POOL));
    assert!(is_success(&result), "{:?}", result.program_result);

    assert_eq!(f.account(&old_run).data, old_run_data);
    let lapsed: Consent = read(&f.accounts, &consent_pda(&dated, 1));
    assert_eq!(
        lapsed.expires_at,
        Some(EXPIRES_AT),
        "version 1 keeps the deadline it lapsed on"
    );
    assert!(lapsed.revoked_at.is_none(), "a lapse is not a revocation");
    assert_eq!(f.consent_version(&dated), 2);
}
