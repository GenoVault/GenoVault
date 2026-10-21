//! Withdrawing accrued funds (`T049`, `FR-020`).
//!
//! The M3 milestone condition: a withdrawal reduces the balance by exactly its
//! amount, and a repeated request for the same amount does not go through.
//! The second part is not about the balance: the fixture deliberately leaves
//! enough for several more such requests, and it is `withdrawn_before` that
//! refuses.
//!
//! The balance is placed as a ready account rather than accrued by a run: the
//! `settle_dataset` path is already covered by `settle_run.rs`, and only two
//! fields matter here — `accrued` and `withdrawn`.
//!
//! Run with: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::state::{OwnerBalance, PlatformConfig};
use genovault::GenoVaultError;
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::token2022;
use solana_account::Account;

mod harness;
use harness::*;

const DECIMALS: u8 = 6;

/// Accrued to the owner over all time.
const ACCRUED: u64 = 10_000_000;

/// The vault holds other money too: other owners, deposits of runs in progress.
const VAULT: u64 = ACCRUED * 5;

/// One request. A third of the accrued total — the balance would cover a repeat.
const AMOUNT: u64 = 3_000_000;

struct Fixture {
    mollusk: Mollusk,
    owner: Pubkey,
    owner_tokens: Pubkey,
    mint: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    fn new() -> Self {
        Self::with(Pubkey::new_unique(), Pubkey::new_unique(), false)
    }

    /// `authority` apart from `owner`, so the platform can be the owner.
    fn with(owner: Pubkey, authority: Pubkey, paused: bool) -> Self {
        let mut mollusk = mollusk();
        token2022::add_program(&mut mollusk);

        let owner_tokens = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (config, config_bump) = config_pda();
        let (vault, _) = vault_pda();
        let (balance, balance_bump) = owner_balance_pda(&owner);

        let accounts = vec![
            (owner, funded_wallet()),
            (mint, mint_account(DECIMALS, VAULT)),
            (owner_tokens, token_account(mint, owner, 0)),
            (vault, token_account(mint, config, VAULT)),
            (
                config,
                stored(
                    &PlatformConfig {
                        authority,
                        mint,
                        fee_bps: 700,
                        paused,
                        bump: config_bump,
                    },
                    LAMPORTS_PER_SOL,
                ),
            ),
            (
                balance,
                stored(
                    &OwnerBalance {
                        owner,
                        accrued: ACCRUED,
                        withdrawn: 0,
                        bump: balance_bump,
                    },
                    LAMPORTS_PER_SOL,
                ),
            ),
            token2022::keyed_account(),
        ];

        Self {
            mollusk,
            owner,
            owner_tokens,
            mint,
            config,
            vault,
            accounts,
        }
    }

    fn ix(&self, amount: u64, withdrawn_before: u64) -> Instruction {
        self.ix_with(
            self.owner,
            owner_balance_pda(&self.owner).0,
            self.owner_tokens,
            self.vault,
            amount,
            withdrawn_before,
        )
    }

    fn ix_with(
        &self,
        signer: Pubkey,
        owner_balance: Pubkey,
        owner_tokens: Pubkey,
        vault: Pubkey,
        amount: u64,
        withdrawn_before: u64,
    ) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::Withdraw {
                owner: signer,
                config: self.config,
                owner_balance,
                mint: self.mint,
                owner_tokens,
                vault,
                token_program: token2022::ID,
            }
            .to_account_metas(None),
            data: genovault::instruction::Withdraw {
                amount,
                withdrawn_before,
            }
            .data(),
        }
    }

    fn send(&mut self, ix: &Instruction) -> InstructionResult {
        let result = self.mollusk.process_instruction(ix, &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    fn withdraw(&mut self, amount: u64, withdrawn_before: u64) -> InstructionResult {
        let ix = self.ix(amount, withdrawn_before);
        self.send(&ix)
    }

    fn balance(&self) -> OwnerBalance {
        read(&self.accounts, &owner_balance_pda(&self.owner).0)
    }

    fn set_balance(&mut self, accrued: u64, withdrawn: u64) {
        let key = owner_balance_pda(&self.owner).0;
        let mut state = self.balance();
        state.accrued = accrued;
        state.withdrawn = withdrawn;
        let slot = self
            .accounts
            .iter_mut()
            .find(|(candidate, _)| *candidate == key)
            .expect("the balance is on the fixture");
        slot.1 = stored(&state, LAMPORTS_PER_SOL);
    }

    fn owner_tokens(&self) -> u64 {
        token_amount(&self.accounts, &self.owner_tokens)
    }

    fn vault_tokens(&self) -> u64 {
        token_amount(&self.accounts, &self.vault)
    }
}

fn assert_refused(result: &InstructionResult, error: GenoVaultError) {
    assert_eq!(
        custom_error_code(result),
        Some(expected(error)),
        "{:?}",
        result.program_result
    );
}

fn assert_refused_by_anchor(result: &InstructionResult, error: anchor_lang::error::ErrorCode) {
    assert_eq!(
        custom_error_code(result),
        Some(anchor_code(error)),
        "{:?}",
        result.program_result
    );
}

// ── The M3 condition ────────────────────────────────────────────────────────

#[test]
fn a_withdrawal_reduces_the_balance_by_exactly_the_amount() {
    let mut f = Fixture::new();

    let result = f.withdraw(AMOUNT, 0);
    assert!(is_success(&result), "{:?}", result.program_result);

    let balance = f.balance();
    assert_eq!(balance.withdrawn, AMOUNT);
    assert_eq!(
        balance.accrued, ACCRUED,
        "a withdrawal does not touch the accrued total"
    );
    assert_eq!(balance.available(), ACCRUED - AMOUNT);
    assert_eq!(f.owner_tokens(), AMOUNT);
    assert_eq!(
        f.vault_tokens(),
        VAULT - AMOUNT,
        "exactly what was debited from the balance left the vault"
    );
}

#[test]
fn the_same_request_does_not_go_through_twice() {
    // A re-signed transaction with a fresh blockhash is a different one to
    // the chain, so this is the repeat a wallet makes after "confirmation
    // timed out". The balance covers it with room to spare.
    let mut f = Fixture::new();
    assert!(is_success(&f.withdraw(AMOUNT, 0)));
    assert!(f.balance().available() >= 2 * AMOUNT);

    let result = f.withdraw(AMOUNT, 0);
    assert_refused(&result, GenoVaultError::WithdrawalIsStale);
    assert_eq!(f.balance().withdrawn, AMOUNT);
    assert_eq!(f.owner_tokens(), AMOUNT, "there was no second transfer");
    assert_eq!(f.vault_tokens(), VAULT - AMOUNT);
}

#[test]
fn a_request_built_from_the_new_state_goes_through() {
    // Refusing the repeat is not a lock on the balance: the next withdrawal
    // is built from the new `withdrawn` and goes through.
    let mut f = Fixture::new();
    assert!(is_success(&f.withdraw(AMOUNT, 0)));

    let result = f.withdraw(AMOUNT, AMOUNT);
    assert!(is_success(&result), "{:?}", result.program_result);
    assert_eq!(f.balance().withdrawn, 2 * AMOUNT);
    assert_eq!(f.owner_tokens(), 2 * AMOUNT);
}

// ── Amount bounds ───────────────────────────────────────────────────────────

#[test]
fn more_than_is_left_is_refused() {
    let mut f = Fixture::new();

    let result = f.withdraw(ACCRUED + 1, 0);
    assert_refused(&result, GenoVaultError::WithdrawalExceedsBalance);
    assert_eq!(f.vault_tokens(), VAULT);
}

#[test]
fn the_whole_balance_comes_out_and_then_nothing() {
    let mut f = Fixture::new();
    assert!(is_success(&f.withdraw(ACCRUED, 0)));
    assert_eq!(f.owner_tokens(), ACCRUED);
    assert_eq!(f.balance().available(), 0);

    let result = f.withdraw(1, ACCRUED);
    assert_refused(&result, GenoVaultError::WithdrawalExceedsBalance);
}

#[test]
fn a_zero_withdrawal_is_refused() {
    let mut f = Fixture::new();
    assert_refused(&f.withdraw(0, 0), GenoVaultError::WithdrawalIsZero);
}

#[test]
fn an_accrual_between_build_and_send_keeps_the_request_valid() {
    // A run closed while the owner was signing: `settle_dataset` added to
    // `accrued` and left `withdrawn` alone — the request stays valid.
    let mut f = Fixture::new();
    f.set_balance(ACCRUED + AMOUNT, 0);

    let result = f.withdraw(ACCRUED + AMOUNT, 0);
    assert!(is_success(&result), "{:?}", result.program_result);
    assert_eq!(f.owner_tokens(), ACCRUED + AMOUNT);
}

// ── Who, from where, to where ───────────────────────────────────────────────

#[test]
fn the_owner_must_sign() {
    let mut f = Fixture::new();
    let mut ix = f.ix(AMOUNT, 0);
    ix.accounts[0].is_signer = false;

    let result = f.send(&ix);
    assert_refused_by_anchor(&result, anchor_lang::error::ErrorCode::AccountNotSigner);
    assert_eq!(f.vault_tokens(), VAULT);
}

#[test]
fn a_stranger_cannot_withdraw_someone_elses_balance() {
    // A stranger's signature over someone else's balance: the balance address
    // is derived from the signer, so the foreign account fails the seeds.
    let mut f = Fixture::new();
    let stranger = Pubkey::new_unique();
    let stranger_tokens = Pubkey::new_unique();
    f.accounts.push((stranger, funded_wallet()));
    f.accounts
        .push((stranger_tokens, token_account(f.mint, stranger, 0)));

    let ix = f.ix_with(
        stranger,
        owner_balance_pda(&f.owner).0,
        stranger_tokens,
        f.vault,
        AMOUNT,
        0,
    );
    let result = f.send(&ix);
    assert_refused_by_anchor(&result, anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(f.vault_tokens(), VAULT);
}

#[test]
fn the_money_goes_to_the_owner_and_nobody_else() {
    // The API builds the transaction and the owner signs it. A swapped
    // recipient is a withdrawal into someone else's pocket with an honest
    // signature.
    let mut f = Fixture::new();
    let stranger_tokens = Pubkey::new_unique();
    f.accounts.push((
        stranger_tokens,
        token_account(f.mint, Pubkey::new_unique(), 0),
    ));

    let ix = f.ix_with(
        f.owner,
        owner_balance_pda(&f.owner).0,
        stranger_tokens,
        f.vault,
        AMOUNT,
        0,
    );
    let result = f.send(&ix);
    assert_refused_by_anchor(&result, anchor_lang::error::ErrorCode::ConstraintTokenOwner);
    assert_eq!(f.balance().withdrawn, 0);
}

#[test]
fn the_money_comes_from_the_platform_vault_and_not_a_lookalike() {
    let mut f = Fixture::new();
    let lookalike = Pubkey::new_unique();
    f.accounts
        .push((lookalike, token_account(f.mint, f.config, VAULT)));

    let ix = f.ix_with(
        f.owner,
        owner_balance_pda(&f.owner).0,
        f.owner_tokens,
        lookalike,
        AMOUNT,
        0,
    );
    let result = f.send(&ix);
    assert_refused_by_anchor(&result, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

// ── Platform and pause ──────────────────────────────────────────────────────

#[test]
fn the_platform_withdraws_its_fee_the_same_way() {
    // The fee sits on an `OwnerBalance` under `authority`, and there is no
    // separate path for it — the same instruction, the same checks.
    let authority = Pubkey::new_unique();
    let mut f = Fixture::with(authority, authority, false);

    assert!(is_success(&f.withdraw(AMOUNT, 0)));
    assert_eq!(f.owner_tokens(), AMOUNT);
    assert_refused(&f.withdraw(AMOUNT, 0), GenoVaultError::WithdrawalIsStale);
}

#[test]
fn a_pause_does_not_hold_back_earned_money() {
    // A pause stops new runs. It cannot hold back payment for work already
    // done — otherwise it would become a way not to pay owners.
    let mut f = Fixture::with(Pubkey::new_unique(), Pubkey::new_unique(), true);

    let result = f.withdraw(AMOUNT, 0);
    assert!(is_success(&result), "{:?}", result.program_result);
    assert_eq!(f.owner_tokens(), AMOUNT);
}
