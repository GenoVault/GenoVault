//! `SC-006` over a set of runs (`T050`): the owners' shares plus the platform
//! fee plus the difference returned to the buyer equal the escrow, to the
//! smallest unit, on every run of the set.
//!
//! # Why a generated set and not more examples
//!
//! `settle_run.rs` checks the equation on one pool, and there it holds by
//! construction: the refund is `escrow − settled_amount`, so any shares at all
//! add up. What can break it lies elsewhere — the fee taken by a second
//! multiplication instead of a subtraction, a refund computed from a different
//! number than the one that was credited, a share credited to a balance twice.
//! Each of these shows up only on some pools: on rounding, on the surplus, on
//! the ceiling. So the set is a few hundred pools of 1 to 50 datasets with
//! prices from zero to a billion, and every branch of `gross_for` is required
//! to occur in it a minimum number of times.
//!
//! # What is measured, not computed
//!
//! The equation is read off the accounts after the instructions ran on the
//! built `.so`: the refund is what arrived on the buyer's token account, the
//! shares and the fee are the `OwnerBalance` accounts. None of the three comes
//! from `Run`. The vault also holds other runs' deposits, and what is left of
//! this run in it must equal what was credited — the second equation, which
//! catches money credited without being kept.
//!
//! `below_floor` is set here by hand; on the cluster it is computed by the
//! MPC. That half of `SC-006` is the live set, `run-dispatcher sc006`.
//!
//! Run with: `scripts/wsl-test-program.sh --test convergence -- --nocapture`.

use std::collections::{BTreeMap, BTreeSet};

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::state::{
    dataset_cost, Dataset, DatasetStatus, OwnerBalance, PlatformConfig, Run, RunDataset, RunStatus,
    MAX_FEE_BPS, MAX_RUN_DATASETS, RECIPE_PARAMS_LEN,
};
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::token2022;
use solana_account::Account;

mod harness;
use harness::*;

/// Runs in the set. Fixed seed: a red run must be reproducible.
const RUNS: usize = 240;
const SEED: u64 = 0x5C00_6050;

/// Every shape must occur at least this often, or the set says nothing about it.
const MIN_PER_SHAPE: usize = 12;

/// `MIN_CONTRIBUTION` of the recipes (`encrypted-ixs`): a dataset that gave
/// fewer records declares zero and is `below_floor`.
const MIN_CONTRIBUTION: u64 = 10;

/// Deposits of other runs lying in the same vault (`PLAN`: one vault for all).
const OTHER_DEPOSITS: u64 = 7_777_777;

const NONCE: u64 = 50;
const DECIMALS: u8 = 6;

/// A deterministic generator: no new dependency for a few hundred numbers.
struct Rng(u64);

impl Rng {
    /// splitmix64.
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `lo..=hi`.
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

/// Which branch of the settlement the run goes through. Derived from the
/// numbers of the run after it was generated, not from what the generator
/// aimed at — the coverage count must not trust the generator.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Shape {
    /// Every record of the cohort has a declared contribution.
    Exact,
    /// Records under the floor are in the cohort; their price goes to the
    /// datasets under the floor.
    Surplus,
    /// The pool average does not fit into the escrow; the surplus gets what is
    /// left.
    CeilingCut,
    /// The datasets' own prices do not fit; the escrow is split between them.
    EscrowSplit,
    /// Nobody cleared the floor, the cohort was revealed (`T027a`).
    SilentPool,
    /// The cohort was under `MIN_COHORT`: nothing to pay for.
    SuppressedCohort,
    /// The run failed; the deposit comes back through `refund_failed_run`.
    Failed,
}

const ALL_SHAPES: [Shape; 7] = [
    Shape::Exact,
    Shape::Surplus,
    Shape::CeilingCut,
    Shape::EscrowSplit,
    Shape::SilentPool,
    Shape::SuppressedCohort,
    Shape::Failed,
];

struct Entry {
    price: u64,
    claimed: u64,
    contribution: u32,
    below_floor: bool,
    /// Which owner of the case holds the dataset: owners may hold several.
    owner: usize,
}

struct Case {
    pool: Vec<Entry>,
    records_included: u32,
    escrow: u64,
    fee_bps: u16,
    failed: bool,
}

impl Case {
    fn contributed(&self) -> u64 {
        self.pool.iter().map(|e| e.contribution as u64).sum()
    }

    fn shape(&self) -> Shape {
        if self.failed {
            return Shape::Failed;
        }
        let records = self.records_included as u128;
        if records == 0 {
            return Shape::SuppressedCohort;
        }
        let contributed = self.contributed() as u128;
        if contributed == 0 {
            return Shape::SilentPool;
        }
        let escrow = self.escrow as u128;
        let earned: u128 = self
            .pool
            .iter()
            .map(|e| ceil_div(e.price as u128 * e.contribution as u128, 1_000))
            .sum();
        if earned > escrow {
            return Shape::EscrowSplit;
        }
        let bill: u128 = self
            .pool
            .iter()
            .map(|e| {
                ceil_div(
                    e.price as u128 * e.contribution as u128 * records,
                    contributed * 1_000,
                )
            })
            .sum();
        if bill > escrow {
            Shape::CeilingCut
        } else if records > contributed {
            Shape::Surplus
        } else {
            Shape::Exact
        }
    }
}

fn ceil_div(numerator: u128, denominator: u128) -> u128 {
    if numerator == 0 {
        0
    } else {
        (numerator - 1) / denominator + 1
    }
}

fn price(rng: &mut Rng) -> u64 {
    match rng.next() % 20 {
        0 => 0,
        1..=2 => rng.range(1, 9),
        3..=9 => rng.range(10, 10_000),
        10..=17 => rng.range(10_000, 10_000_000),
        _ => rng.range(10_000_000, 1_000_000_000),
    }
}

fn claimed(rng: &mut Rng) -> u64 {
    match rng.next() % 20 {
        // A dataset of one person (`FR-009`).
        0..=2 => 1,
        3..=8 => rng.range(2, 999),
        _ => rng.range(1_000, 100_000),
    }
}

/// What the generator aims at. The shape the run ends up with is decided by
/// `Case::shape`; the aim only makes sure every shape is reachable often.
#[derive(Clone, Copy)]
enum Aim {
    AllAbove,
    Mixed,
    AllBelow,
    Suppressed,
    Ceiling,
    Split,
    Failed,
}

fn generate(rng: &mut Rng, index: usize) -> Case {
    let aim = match index % 8 {
        0 => Aim::AllAbove,
        1 | 7 => Aim::Mixed,
        2 => Aim::AllBelow,
        3 => Aim::Suppressed,
        4 => Aim::Ceiling,
        5 => Aim::Split,
        _ => Aim::Failed,
    };
    let size = match rng.next() % 4 {
        0 => rng.range(1, 3),
        1 => rng.range(4, 10),
        2 => rng.range(11, 30),
        _ => rng.range(31, MAX_RUN_DATASETS as u64),
    } as usize;
    // Every tenth run is a full pool: the size `SC-007` is about.
    let size = if index % 10 == 9 {
        MAX_RUN_DATASETS
    } else {
        size
    };

    let mut pool = Vec::with_capacity(size);
    let mut under_floor_records = 0u64;
    let mut owners = 0usize;
    for position in 0..size {
        let owner = if owners > 0 && rng.chance(15) {
            rng.range(0, owners as u64 - 1) as usize
        } else {
            owners += 1;
            owners - 1
        };

        let below = match aim {
            Aim::AllAbove | Aim::Split => false,
            Aim::AllBelow | Aim::Suppressed => true,
            Aim::Mixed | Aim::Failed => rng.chance(40),
            // Expensive datasets give everything, cheap ones stay under the
            // floor with nine records: the pool average leaves the escrow.
            Aim::Ceiling => position % 2 == 1,
        };
        let (price, claimed) = match (aim, below) {
            (Aim::Ceiling, false) => (
                rng.range(100_000_000, 1_000_000_000),
                rng.range(1_000, 5_000),
            ),
            (Aim::Ceiling, true) => (rng.range(0, 3), 9),
            _ => (price(rng), claimed(rng)),
        };

        let (contribution, below_floor) = if below || claimed < MIN_CONTRIBUTION {
            let under = match aim {
                Aim::Suppressed => 0,
                Aim::Ceiling => 9,
                _ => rng.range(0, claimed.min(MIN_CONTRIBUTION - 1)),
            };
            under_floor_records += under;
            (0, true)
        } else {
            let all = matches!(aim, Aim::Ceiling) || rng.chance(30);
            let c = if all {
                claimed
            } else {
                rng.range(MIN_CONTRIBUTION, claimed)
            };
            (c as u32, false)
        };
        pool.push(Entry {
            price,
            claimed,
            contribution,
            below_floor,
            owner,
        });
    }

    let contributed: u64 = pool.iter().map(|e| e.contribution as u64).sum();
    let records_included = (contributed + under_floor_records) as u32;

    // The escrow `request_run` would lock: the upper bound over claimed
    // volumes (`FR-015a`).
    let upper: u64 = pool
        .iter()
        .map(|e| dataset_cost(e.price, e.claimed).unwrap())
        .sum();
    let escrow = match aim {
        // Unreachable while contributions do not exceed claimed volumes, and
        // guarded rather than assumed in `gross_for` — so it is in the set.
        Aim::Split => {
            let earned: u64 = pool
                .iter()
                .map(|e| dataset_cost(e.price, e.contribution as u64).unwrap())
                .sum();
            if earned == 0 {
                upper
            } else {
                rng.range(0, earned - 1)
            }
        }
        _ => upper,
    };

    let fee_bps = match rng.next() % 6 {
        0 => 0,
        1 => MAX_FEE_BPS,
        2 => 700,
        _ => rng.range(1, MAX_FEE_BPS as u64) as u16,
    };

    Case {
        pool,
        records_included: if matches!(aim, Aim::Suppressed) {
            0
        } else {
            records_included
        },
        escrow,
        fee_bps,
        failed: matches!(aim, Aim::Failed),
    }
}

/// What the accounts say after the run was settled and closed.
struct Measured {
    refund: u64,
    owners: u64,
    fee: u64,
    left_in_vault: u64,
    closed: bool,
    max_settle_cu: u64,
}

struct Stand {
    mollusk: Mollusk,
    payer: Pubkey,
    authority: Pubkey,
    buyer_tokens: Pubkey,
    mint: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    run: Pubkey,
    datasets: Vec<Pubkey>,
    owners: Vec<Pubkey>,
    dataset_owner: Vec<usize>,
    accounts: Vec<(Pubkey, Account)>,
}

impl Stand {
    fn new(case: &Case) -> Self {
        let mut mollusk = mollusk();
        token2022::add_program(&mut mollusk);

        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let buyer = Pubkey::new_unique();
        let buyer_tokens = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (config, config_bump) = config_pda();
        let (vault, _) = vault_pda();
        let run = run_pda(&buyer, NONCE);
        let (_, run_bump) = Pubkey::find_program_address(
            &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
            &genovault::ID,
        );

        let in_vault = case.escrow + OTHER_DEPOSITS;
        let mut accounts = vec![
            (payer, funded_wallet()),
            (mint, mint_account(DECIMALS, in_vault)),
            (buyer_tokens, token_account(mint, buyer, 0)),
            (vault, token_account(mint, config, in_vault)),
            system_program(),
            token2022::keyed_account(),
            (
                config,
                stored(
                    &PlatformConfig {
                        authority,
                        mint,
                        fee_bps: case.fee_bps,
                        paused: false,
                        bump: config_bump,
                    },
                    LAMPORTS_PER_SOL,
                ),
            ),
            empty(owner_balance_pda(&authority).0),
        ];

        let owner_count = case.pool.iter().map(|e| e.owner).max().map_or(0, |m| m + 1);
        let owners: Vec<Pubkey> = (0..owner_count).map(|_| Pubkey::new_unique()).collect();
        for owner in &owners {
            accounts.push(empty(owner_balance_pda(owner).0));
        }

        let mut datasets = Vec::new();
        let mut entries = Vec::new();
        for (index, e) in case.pool.iter().enumerate() {
            let owner = owners[e.owner];
            let dataset_id = format!("cohort-{index}");
            let (dataset, bump) = Pubkey::find_program_address(
                &[Dataset::SEED, owner.as_ref(), dataset_id.as_bytes()],
                &genovault::ID,
            );
            accounts.push((
                dataset,
                stored(
                    &Dataset {
                        owner,
                        dataset_id,
                        version: 1,
                        content_hash: [7u8; 32],
                        record_count_claimed: e.claimed,
                        price_per_1k: e.price,
                        consent_version: 1,
                        status: DatasetStatus::Active,
                        verified_badge: None,
                        bump,
                    },
                    LAMPORTS_PER_SOL,
                ),
            ));
            entries.push(RunDataset {
                dataset,
                price_per_1k: e.price,
                records_included: e.contribution,
                below_floor: e.below_floor,
                settled: false,
            });
            datasets.push(dataset);
        }

        let state = Run {
            buyer,
            dispatcher: Pubkey::new_unique(),
            nonce: NONCE,
            recipe_id: 1,
            recipe_params: [0u8; RECIPE_PARAMS_LEN],
            use_type: 1,
            buyer_category: 1,
            buyer_x25519: [5u8; 32],
            datasets: entries,
            fee_bps: case.fee_bps,
            escrow_amount: case.escrow,
            settled_count: 0,
            settled_amount: 0,
            refunded: false,
            status: if case.failed {
                RunStatus::Failed
            } else {
                RunStatus::Running
            },
            // A failed run has no result: whatever was declared, nobody is paid.
            result_hash: if case.failed { None } else { Some([3u8; 32]) },
            records_included: if case.failed {
                0
            } else {
                case.records_included
            },
            suppressed: !case.failed && case.records_included == 0,
            dataset_cursor: case.pool.len() as u32,
            folded_batches: 40,
            folded_hash: [9u8; 32],
            created_at: 0,
            bump: run_bump,
        };
        accounts.push((run, stored(&state, 5 * LAMPORTS_PER_SOL)));

        Self {
            mollusk,
            payer,
            authority,
            buyer_tokens,
            mint,
            config,
            vault,
            run,
            datasets,
            dataset_owner: case.pool.iter().map(|e| e.owner).collect(),
            owners,
            accounts,
        }
    }

    fn process(&mut self, ix: &Instruction) -> InstructionResult {
        let result = self.mollusk.process_instruction(ix, &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    fn settle_ix(&self, index: usize) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::SettleDataset {
                payer: self.payer,
                config: self.config,
                run: self.run,
                dataset: self.datasets[index],
                owner_balance: owner_balance_pda(&self.owners[self.dataset_owner[index]]).0,
                platform_balance: owner_balance_pda(&self.authority).0,
                system_program: system_program_id(),
            }
            .to_account_metas(None),
            data: genovault::instruction::SettleDataset {
                index: index as u32,
            }
            .data(),
        }
    }

    fn finalize_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::FinalizeRun {
                config: self.config,
                run: self.run,
                mint: self.mint,
                buyer_tokens: self.buyer_tokens,
                vault: self.vault,
                token_program: token2022::ID,
            }
            .to_account_metas(None),
            data: genovault::instruction::FinalizeRun {}.data(),
        }
    }

    fn refund_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::RefundFailedRun {
                config: self.config,
                run: self.run,
                mint: self.mint,
                buyer_tokens: self.buyer_tokens,
                vault: self.vault,
                token_program: token2022::ID,
            }
            .to_account_metas(None),
            data: genovault::instruction::RefundFailedRun {}.data(),
        }
    }

    /// Zero for a balance nobody created: a failed run credits nobody.
    fn accrued(&self, owner: &Pubkey) -> u64 {
        let key = owner_balance_pda(owner).0;
        let (_, account) = self
            .accounts
            .iter()
            .find(|(candidate, _)| *candidate == key)
            .expect("the balance slot is in the stand");
        if account.data.is_empty() {
            return 0;
        }
        OwnerBalance::try_deserialize(&mut account.data.as_slice())
            .expect("a balance account reads")
            .accrued
    }

    /// Settles every dataset in `order`, closes the run and reads the result.
    /// `Err` names the instruction that did not go through.
    fn execute(&mut self, case: &Case, order: &[usize]) -> std::result::Result<Measured, String> {
        let mut max_settle_cu = 0;
        if case.failed {
            let result = self.process(&self.refund_ix());
            if !is_success(&result) {
                return Err(format!("refund_failed_run: {:?}", result.program_result));
            }
        } else {
            for &index in order {
                let result = self.process(&self.settle_ix(index));
                if !is_success(&result) {
                    return Err(format!(
                        "settle_dataset({index}): {:?}",
                        result.program_result
                    ));
                }
                max_settle_cu = max_settle_cu.max(result.compute_units_consumed);
            }
            let result = self.process(&self.finalize_ix());
            if !is_success(&result) {
                return Err(format!("finalize_run: {:?}", result.program_result));
            }
        }

        let run: Run = read(&self.accounts, &self.run);
        let owners = self.owners.iter().map(|owner| self.accrued(owner)).sum();
        Ok(Measured {
            refund: token_amount(&self.accounts, &self.buyer_tokens),
            owners,
            fee: self.accrued(&self.authority),
            left_in_vault: token_amount(&self.accounts, &self.vault) - OTHER_DEPOSITS,
            closed: run.refunded && run.status.is_terminal(),
            max_settle_cu,
        })
    }
}

/// Fisher–Yates: shares are pure functions of `Run`, so the order in which
/// payouts go through must not change any of them.
fn shuffled(rng: &mut Rng, len: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..len).collect();
    for i in (1..len).rev() {
        let j = rng.range(0, i as u64) as usize;
        order.swap(i, j);
    }
    order
}

#[test]
fn the_sums_add_up_to_the_escrow_on_every_run_of_the_set() {
    let mut rng = Rng(SEED);
    let mut shapes: BTreeMap<Shape, usize> = BTreeMap::new();
    let mut diverged: Vec<String> = Vec::new();
    let mut closed = 0usize;
    let mut settled_datasets = 0usize;
    let mut full_pools = 0usize;
    let mut individuals = 0usize;
    let mut shared_owners = 0usize;
    let mut max_settle_cu = 0u64;

    for index in 0..RUNS {
        let case = generate(&mut rng, index);
        let shape = case.shape();
        *shapes.entry(shape).or_default() += 1;
        full_pools += usize::from(case.pool.len() == MAX_RUN_DATASETS);
        individuals += case.pool.iter().filter(|e| e.claimed == 1).count();
        let distinct: BTreeSet<usize> = case.pool.iter().map(|e| e.owner).collect();
        shared_owners += usize::from(distinct.len() < case.pool.len());

        let order = shuffled(&mut rng, case.pool.len());
        let mut stand = Stand::new(&case);
        let measured = match stand.execute(&case, &order) {
            Ok(measured) => measured,
            Err(error) => {
                diverged.push(format!("run {index} ({shape:?}): {error}"));
                continue;
            }
        };
        closed += usize::from(measured.closed);
        if !case.failed {
            settled_datasets += case.pool.len();
        }
        max_settle_cu = max_settle_cu.max(measured.max_settle_cu);

        let Measured {
            refund,
            owners,
            fee,
            left_in_vault,
            ..
        } = measured;
        // u128: a broken program must show up as a mismatch, not as an
        // overflow panic of the check itself.
        let total = owners as u128 + fee as u128 + refund as u128;
        if total != case.escrow as u128 {
            diverged.push(format!(
                "run {index} ({shape:?}, {} datasets, fee {} bps): owners {owners} + fee {fee} + refund {refund} = {total}, escrow {}",
                case.pool.len(),
                case.fee_bps,
                case.escrow
            ));
        } else if left_in_vault as u128 != owners as u128 + fee as u128 {
            diverged.push(format!(
                "run {index} ({shape:?}): {left_in_vault} left in the vault, {} credited",
                owners as u128 + fee as u128
            ));
        }
    }

    // The check states how much it looked at, from the accounts and not from
    // the generator: zero mismatches over zero runs reads the same as over all.
    eprintln!(
        "SC-006: {} of {RUNS} runs converge to the unit; closed on chain: {closed}; datasets settled: {settled_datasets}; full pools of {MAX_RUN_DATASETS}: {full_pools}; datasets of one record: {individuals}; runs with an owner of several datasets: {shared_owners}; max settle_dataset CU: {max_settle_cu}",
        RUNS - diverged.len()
    );
    eprintln!("SC-006 shapes: {shapes:?}");
    for line in diverged.iter().take(20) {
        eprintln!("  diverged: {line}");
    }

    assert!(
        diverged.is_empty(),
        "{} of {RUNS} runs did not converge",
        diverged.len()
    );
    assert_eq!(
        closed, RUNS,
        "every run of the set must reach its terminal state"
    );
    for shape in ALL_SHAPES {
        let count = shapes.get(&shape).copied().unwrap_or(0);
        assert!(
            count >= MIN_PER_SHAPE,
            "{shape:?} occurred {count} times, fewer than {MIN_PER_SHAPE}: the set says nothing about it"
        );
    }
    assert!(full_pools >= MIN_PER_SHAPE, "only {full_pools} full pools");
    assert!(individuals > 0 && shared_owners > 0);
}
