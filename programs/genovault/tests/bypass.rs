//! Going around the API opens nothing the API would refuse (`FR-006`).
//!
//! The API is a convenience, not a gate: `POST /runs` hands back an unsigned
//! instruction, and a buyer is free to build `request_run` themselves instead.
//! `FR-006` says the consent check must hold whichever interface the order
//! came through, so the question here is not whether the program checks
//! consent — `tests/request_run.rs`, `tests/revocation.rs` and
//! `tests/expiry.rs` show it does, reason by reason — but what a buyer holding
//! the raw instruction can do that a buyer holding the API cannot.
//!
//! Three levers, each unreachable through the API and each tried here:
//! - **the accounts.** The API derives the consent address from the chain; a
//!   direct caller puts whatever they like in that slot — bytes they wrote
//!   themselves, or another account the program did write;
//! - **the masks.** The API takes a use type and a buyer category by name, so
//!   it can only ever send one bit of each. The instruction carries a `u32`,
//!   and a mask with two bits, one of them allowed, passes a permission check
//!   that only asks `consent & mask != 0`;
//! - **the recipe parameters.** The API builds them from a validated schema;
//!   the instruction carries 32 raw bytes.
//!
//! Every refusal below is followed by a legitimate order on the same stand,
//! which goes through. A refusal on a stand that refuses everything proves
//! nothing, and the witness is what tells the two apart.
//!
//! What is not here: the buyer category is a declaration on both paths. The
//! API does not verify it and neither does the program — `Run` records it so
//! that a verifier can see what was claimed (`docs/PLAN.md`), but a commercial
//! buyer who declares `ACADEMIC` passes both. That is the product as specified,
//! not a difference between the two interfaces.
//!
//! Run with `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::consent::SetConsentArgs;
use genovault::instructions::dataset::RegisterDatasetArgs;
use genovault::instructions::request_run::{RequestRunArgs, RECIPE_FREQUENCIES};
use genovault::state::{
    buyer_category, use_type, Consent, FrequenciesParams, Run, RunStatus, FILTER_ANY,
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
const BUYER_KEY: [u8; 32] = [5u8; 32];
const DATASET_ID: &str = "exome-alpha";

/// Nonces the stand has room for. A refused order leaves its run address free,
/// and the witness after it reuses the same nonce to show that.
const NONCES: [u64; 3] = [1, 2, 3];

const FREQUENCIES_PARAMS: FrequenciesParams = FrequenciesParams {
    min_age: 18,
    max_age: 90,
    sex_filter: FILTER_ANY,
    affected_filter: FILTER_ANY,
};

/// A narrow consent: oncology only, academic buyers only, pharma forbidden
/// outright. Wide enough for a legitimate order, narrow enough that almost
/// anything else is a refusal.
fn narrow_consent() -> SetConsentArgs {
    SetConsentArgs {
        allowed_uses: use_type::ONCOLOGY,
        forbidden_uses: use_type::PHARMA_COMMERCIAL,
        buyer_categories: buyer_category::ACADEMIC,
        expires_at: None,
    }
}

fn args(nonce: u64, use_type: u32, buyer_category: u32, dispatcher: Pubkey) -> RequestRunArgs {
    RequestRunArgs {
        nonce,
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
        let owner = Pubkey::new_unique();
        let (config, _) = config_pda();
        let (vault, _) = vault_pda();
        let dataset = dataset_pda(&owner, DATASET_ID);

        let mut accounts = vec![
            (authority, funded_wallet()),
            (buyer, funded_wallet()),
            (dispatcher, funded_wallet()),
            (owner, funded_wallet()),
            empty(config),
            empty(vault),
            empty(dataset),
            empty(consent_pda(&dataset, 1)),
            (mint, mint_account(DECIMALS, BUYER_FUNDS)),
            (buyer_tokens, token_account(mint, buyer, BUYER_FUNDS)),
            system_program(),
            token2022::keyed_account(),
        ];
        for nonce in NONCES {
            accounts.push(empty(run_pda(&buyer, nonce)));
        }

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
                        dataset_id: DATASET_ID.to_string(),
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
            assert_eq!(result.program_result, ProgramResult::Success, "setup");
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

    /// `request_run` exactly as a buyer would assemble it by hand: every account
    /// in the pool slot and every byte of the arguments are the caller's choice.
    fn raw_request(&self, pool: [Pubkey; 2], args: RequestRunArgs) -> Instruction {
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
        accounts.extend(pool.map(|key| AccountMeta::new_readonly(key, false)));
        Instruction {
            program_id: genovault::ID,
            accounts,
            data: genovault::instruction::RequestRun { args }.data(),
        }
    }

    /// The pool the API would send: the dataset and its current consent.
    fn honest_pool(&self) -> [Pubkey; 2] {
        [self.dataset, consent_pda(&self.dataset, 1)]
    }

    fn order(&self, nonce: u64, use_type: u32, buyer_category: u32) -> Instruction {
        self.raw_request(
            self.honest_pool(),
            args(nonce, use_type, buyer_category, self.dispatcher),
        )
    }

    fn account(&self, key: &Pubkey) -> &Account {
        &self
            .accounts
            .iter()
            .find(|(candidate, _)| candidate == key)
            .expect("the account is on the stand")
            .1
    }

    fn replace(&mut self, key: &Pubkey, account: Account) {
        let slot = self
            .accounts
            .iter()
            .position(|(candidate, _)| candidate == key)
            .expect("the account is on the stand");
        self.accounts[slot].1 = account;
    }

    fn balances(&self) -> (u64, u64) {
        (
            token_amount(&self.accounts, &self.vault),
            token_amount(&self.accounts, &self.buyer_tokens),
        )
    }

    /// A refused order changes nothing: no run account at its address, and not
    /// a single token moved. The rollback is the runtime's promise; the test
    /// looks for itself.
    fn assert_refused_cleanly(&self, result: &InstructionResult, nonce: u64, before: (u64, u64)) {
        assert!(!is_success(result), "the order must be refused");
        let run = self.account(&run_pda(&self.buyer, nonce));
        assert!(run.data.is_empty(), "no run account is left behind");
        assert_eq!(run.lamports, 0);
        assert_eq!(self.balances(), before, "neither vault nor buyer moved");
    }

    /// The witness: the same stand, the same nonce, an order the consent
    /// allows — and it goes through. Without this every refusal above it could
    /// be a broken fixture.
    fn assert_a_legitimate_order_still_goes_through(&mut self, nonce: u64) {
        let (vault_before, buyer_before) = self.balances();
        let result = self.apply(&self.order(nonce, use_type::ONCOLOGY, buyer_category::ACADEMIC));
        assert!(is_success(&result), "the legitimate order must be accepted");
        let run: Run = read(&self.accounts, &run_pda(&self.buyer, nonce));
        assert_eq!(run.status, RunStatus::Accepted);
        assert_eq!(self.balances(), (vault_before + COST, buyer_before - COST));
    }
}

/// A consent that allows everything to everyone, bound to the right dataset
/// and carrying the right version — every field the program compares is what
/// the program wants to see.
fn permissive_consent_for(dataset: Pubkey) -> Consent {
    let (_, bump) = Pubkey::find_program_address(
        &[Consent::SEED, dataset.as_ref(), &1u32.to_le_bytes()],
        &genovault::ID,
    );
    Consent {
        dataset,
        version: 1,
        allowed_uses: use_type::ALL,
        forbidden_uses: 0,
        buyer_categories: buyer_category::ALL,
        expires_at: None,
        revoked_at: None,
        prev_version: None,
        bump,
    }
}

#[test]
fn a_consent_the_program_did_not_write_opens_nothing() {
    // The buyer wants cardiology for a commercial client. The owner allowed
    // neither, so the buyer writes their own consent — at the canonical
    // address, bound to this dataset, version 1 — and owns it with a program of
    // their own. `request_run` does not re-derive consent seeds; ownership is
    // what it relies on, and ownership is what refuses this.
    let mut f = Fixture::new();
    let wanted = (use_type::CARDIOLOGY, buyer_category::COMMERCIAL);
    let consent = consent_pda(&f.dataset, 1);
    let genuine = f.account(&consent).clone();

    // What the owner's consent says to this order — through the API or not.
    let before = f.balances();
    let result = f.apply(&f.order(NONCES[0], wanted.0, wanted.1));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::UseTypeNotAllowed))
    );
    f.assert_refused_cleanly(&result, NONCES[0], before);

    let mut forged = stored(&permissive_consent_for(f.dataset), genuine.lamports);
    forged.owner = Pubkey::new_unique();
    f.replace(&consent, forged.clone());

    let result = f.apply(&f.order(NONCES[0], wanted.0, wanted.1));
    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(
            anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram
        )),
        "a consent the program did not write is not a consent"
    );
    f.assert_refused_cleanly(&result, NONCES[0], before);

    // Control: the very same bytes, owned by the program, do open the order.
    // So the forgery lacked nothing but its owner — the refusal above is the
    // ownership check and nothing else. Only the stand can put program-owned
    // bytes there; on a real cluster, only `set_consent` signed by the owner.
    let mut control = forged;
    control.owner = genovault::ID;
    let mut accounts = f.accounts.clone();
    let slot = accounts
        .iter()
        .position(|(key, _)| *key == consent)
        .expect("the consent is on the stand");
    accounts[slot].1 = control;
    let result = f
        .mollusk
        .process_instruction(&f.order(NONCES[0], wanted.0, wanted.1), &accounts);
    assert!(
        is_success(&result),
        "the forged content alone would have opened the order"
    );

    f.replace(&consent, genuine);
    f.assert_a_legitimate_order_still_goes_through(NONCES[0]);
}

#[test]
fn another_account_of_ours_is_not_a_consent() {
    // Ownership alone is not enough either: the program writes more than
    // consents, and a buyer holds some of those accounts. Their own accepted
    // run is the obvious candidate — the buyer chose most of its bytes. The
    // discriminator is what keeps it from being read as a consent.
    let mut f = Fixture::new();
    f.assert_a_legitimate_order_still_goes_through(NONCES[0]);
    let own_run = run_pda(&f.buyer, NONCES[0]);
    let before = f.balances();

    let impostors = [own_run, f.dataset];
    for impostor in impostors {
        let result = f.apply(&f.raw_request(
            [f.dataset, impostor],
            args(
                NONCES[1],
                use_type::CARDIOLOGY,
                buyer_category::COMMERCIAL,
                f.dispatcher,
            ),
        ));
        assert_eq!(
            custom_error_code(&result),
            Some(anchor_code(
                anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
            )),
            "{impostor} is ours, but it is not a consent"
        );
        f.assert_refused_cleanly(&result, NONCES[1], before);
    }

    f.assert_a_legitimate_order_still_goes_through(NONCES[1]);
}

#[test]
fn masks_the_api_cannot_express_are_refused() {
    // Through the API a use type and a category are names, one each. In the
    // instruction they are `u32` masks, and the permission itself is a bitwise
    // AND. A mask with one allowed bit and one that is not would pass
    // `allowed_uses & use_type != 0` — the assertion right below shows that
    // arithmetic — so the refusal has to come from somewhere else: the
    // requirement that a run has exactly one known use and one known category.
    let consent = narrow_consent();
    let two_uses = use_type::ONCOLOGY | use_type::CARDIOLOGY;
    let two_categories = buyer_category::ACADEMIC | buyer_category::COMMERCIAL;
    assert_ne!(consent.allowed_uses & two_uses, 0);
    assert_eq!(consent.forbidden_uses & two_uses, 0);
    assert_ne!(consent.buyer_categories & two_categories, 0);

    let unknown_bit = 1u32 << 31;
    let cases: [(u32, u32, GenoVaultError); 7] = [
        (
            two_uses,
            buyer_category::ACADEMIC,
            GenoVaultError::UnknownUseType,
        ),
        (
            use_type::ALL,
            buyer_category::ACADEMIC,
            GenoVaultError::UnknownUseType,
        ),
        (0, buyer_category::ACADEMIC, GenoVaultError::UnknownUseType),
        (
            unknown_bit,
            buyer_category::ACADEMIC,
            GenoVaultError::UnknownUseType,
        ),
        (
            use_type::ONCOLOGY,
            two_categories,
            GenoVaultError::UnknownBuyerCategory,
        ),
        (use_type::ONCOLOGY, 0, GenoVaultError::UnknownBuyerCategory),
        (
            use_type::ONCOLOGY,
            unknown_bit,
            GenoVaultError::UnknownBuyerCategory,
        ),
    ];

    let mut f = Fixture::new();
    let before = f.balances();
    for (use_type, buyer_category, error) in cases {
        let result = f.apply(&f.order(NONCES[0], use_type, buyer_category));
        assert_eq!(
            custom_error_code(&result),
            Some(expected(error)),
            "use {use_type:#x}, category {buyer_category:#x}"
        );
        f.assert_refused_cleanly(&result, NONCES[0], before);
    }

    // The single bit the API would send for the second half of each mask is
    // refused on its own merits, with the owner's reason — not the dictionary's.
    let result = f.apply(&f.order(NONCES[0], use_type::CARDIOLOGY, buyer_category::ACADEMIC));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::UseTypeNotAllowed))
    );
    let result = f.apply(&f.order(NONCES[0], use_type::ONCOLOGY, buyer_category::COMMERCIAL));
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BuyerCategoryNotAllowed))
    );

    f.assert_a_legitimate_order_still_goes_through(NONCES[0]);
}

#[test]
fn recipe_parameters_the_api_would_not_build_are_refused_before_payment() {
    // `frequenciesParamsSchema` in `packages/shared` refuses these before any
    // bytes exist. A direct caller writes the bytes. The program decodes them
    // before the transfer, so a malformed request costs nothing — and the
    // circuit never sees a filter it would silently match against no one.
    let valid = FREQUENCIES_PARAMS.encode();
    let with = |index: usize, value: u8| {
        let mut raw = valid;
        raw[index] = value;
        raw
    };
    let malformed: [(&str, [u8; RECIPE_PARAMS_LEN]); 4] = [
        ("min_age above max_age", with(0, 91)),
        ("sex filter outside the dictionary", with(2, FILTER_ANY + 1)),
        (
            "affected filter outside the dictionary",
            with(3, FILTER_ANY + 1),
        ),
        ("a byte past the layout", with(RECIPE_PARAMS_LEN - 1, 1)),
    ];

    let mut f = Fixture::new();
    let before = f.balances();
    for (label, recipe_params) in malformed {
        let result = f.apply(&f.raw_request(
            f.honest_pool(),
            RequestRunArgs {
                recipe_params,
                ..args(
                    NONCES[0],
                    use_type::ONCOLOGY,
                    buyer_category::ACADEMIC,
                    f.dispatcher,
                )
            },
        ));
        assert_eq!(
            custom_error_code(&result),
            Some(expected(GenoVaultError::RecipeParamsInvalid)),
            "{label}"
        );
        f.assert_refused_cleanly(&result, NONCES[0], before);
    }

    f.assert_a_legitimate_order_still_goes_through(NONCES[0]);
}
