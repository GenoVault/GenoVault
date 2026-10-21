//! The "logistic regression" recipe (`T044`).
//!
//! Like `frequencies.rs`, these tests run the **compiled circuit**
//! (`build/<instruction>.arcis.ir`) on the mock evaluator, not the Rust
//! function — run them through `scripts/wsl-test-circuits.sh`.
//!
//! Three kinds of claims live here. The accumulator and the reveal hold the
//! exact integer sums a plain computation gives, and the reveal says nothing
//! on a cohort too small for the model. And the model the buyer solves from
//! those sums (`solve_moments`, mirrored by `packages/shared/src/regression.ts`)
//! is about as good as the fully converged plain fit — `SC-002`, measured as
//! the gap in AUC on held-out records, with a control that shows the metric
//! can fail.

use arcis::{testing::*, *};
use encrypted_ixs::circuits::{
    Moments, Record, Regression, BATCH, EVENTS_PER_PARAMETER, FEATURES, FEATURE_AGE,
    FEATURE_MARKER_BASE, FEATURE_NONE, FEATURE_PAIRS, FEATURE_SEX, FILTER_ANY, MARKERS,
    MIN_COHORT, MIN_CONTRIBUTION,
};

/// The buyer's solve — the same two numbers as `packages/shared/src/regression.ts`.
///
/// Ridge on the standardised features, as a share of each variance: scaled
/// by the variance, so `age` (variance in the hundreds) and a marker
/// (variance under one) are penalised alike. Small on purpose — it keeps
/// duplicated features solvable, it is not there to regularise.
const RIDGE: f64 = 0.001;
/// Floor on every pivot. A feature constant in the cohort has zero variance
/// and zero covariance with everything, so the floor turns it into a zero
/// coefficient instead of a division by zero.
const PIVOT_FLOOR: f64 = 0.000001;

fn buyer_key() -> ArcisX25519Pubkey {
    ArcisX25519Pubkey::from_base58(b"genovault-buyer")
}

fn owner_key() -> ArcisX25519Pubkey {
    ArcisX25519Pubkey::from_base58(b"genovault-owner")
}

fn record(sex: u8, age: u8, affected: u8, genotypes: &[u8]) -> Record {
    assert!(genotypes.len() <= MARKERS, "more markers than the profile");
    let mut padded = [0u8; MARKERS];
    padded[..genotypes.len()].copy_from_slice(genotypes);
    Record {
        sex,
        age,
        affected,
        genotypes: padded,
    }
}

fn copy(r: &Record) -> Record {
    record(r.sex, r.age, r.affected, &r.genotypes)
}

fn seal(records: &[Record]) -> [Enc<Shared, Record>; BATCH] {
    assert!(records.len() <= BATCH, "the batch does not hold that many");
    std::array::from_fn(|slot| {
        let source = records
            .get(slot)
            .map(copy)
            .unwrap_or_else(|| record(0, 0, 0, &[]));
        Shared::new(owner_key()).from_arcis(source)
    })
}

/// Feature slots from a short list; the rest are `FEATURE_NONE`.
fn features(codes: &[u8]) -> [u8; FEATURES] {
    assert!(codes.len() <= FEATURES);
    let mut slots = [FEATURE_NONE; FEATURES];
    slots[..codes.len()].copy_from_slice(codes);
    slots
}

fn marker(index: u8) -> u8 {
    FEATURE_MARKER_BASE + index
}

struct Cohort {
    min_age: u8,
    max_age: u8,
    sex_filter: u8,
    features: [u8; FEATURES],
}

impl Cohort {
    fn everyone(features: [u8; FEATURES]) -> Self {
        Self {
            min_age: 0,
            max_age: u8::MAX,
            sex_filter: FILTER_ANY,
            features,
        }
    }
}

type Acc = Enc<Mxe, Pack<Regression>>;

fn empty_accumulator() -> Acc {
    get_instruction("regression_init").eval(())
}

/// Folds any number of records, `BATCH` at a time — the way the dispatcher
/// walks a dataset, short last batch included.
fn fold_all(mut acc: Acc, records: &[Record], cohort: &Cohort) -> Acc {
    for chunk in records.chunks(BATCH) {
        let live = u8::try_from(chunk.len()).expect("batch fits a u8");
        acc = get_instruction("regression_fold").eval((
            seal(chunk),
            acc,
            live,
            cohort.min_age,
            cohort.max_age,
            cohort.sex_filter,
            cohort.features,
        ));
    }
    acc
}

fn close(acc: Acc) -> (Acc, u32, u32) {
    get_instruction("regression_close_dataset").eval(acc)
}

fn reveal(acc: Acc, cohort: &Cohort) -> (Moments, u32, u32) {
    let (encrypted, disclosed, unclosed): (Enc<Shared, Pack<Moments>>, u32, u32) =
        get_instruction("regression_reveal").eval((acc, buyer_key(), cohort.features));
    (encrypted.to_arcis().unpack(), disclosed, unclosed)
}

/// One dataset, end to end: folds → close → reveal.
fn fit(records: &[Record], cohort: &Cohort) -> (Moments, u32) {
    let (closed, _, _) = close(fold_all(empty_accumulator(), records, cohort));
    let (model, disclosed, unclosed) = reveal(closed, cohort);
    assert_eq!(unclosed, 0, "after close_dataset nothing is left unclosed");
    (model, disclosed)
}

// ---------------------------------------------------------------------------
// A plain reference: the same sums and the same formula in host `f64`.
// ---------------------------------------------------------------------------

fn plain_value(r: &Record, code: u8) -> f64 {
    match code {
        FEATURE_SEX => f64::from(r.sex),
        FEATURE_AGE => f64::from(r.age),
        c if c >= FEATURE_MARKER_BASE && usize::from(c - FEATURE_MARKER_BASE) < MARKERS => {
            f64::from(r.genotypes[usize::from(c - FEATURE_MARKER_BASE)])
        }
        _ => 0.0,
    }
}

fn in_cohort(r: &Record, cohort: &Cohort) -> bool {
    r.age >= cohort.min_age
        && r.age <= cohort.max_age
        && (cohort.sex_filter == FILTER_ANY || r.sex == cohort.sex_filter)
}

/// Solves `a · x = b` by the same elimination the circuit runs.
fn solve(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let d = b.len();
    for p in 0..d {
        for i in (p + 1)..d {
            let factor = a[i][p] / a[p][p];
            for j in p..d {
                a[i][j] -= factor * a[p][j];
            }
            b[i] -= factor * b[p];
        }
    }
    let mut x = vec![0.0; d];
    for i in (0..d).rev() {
        let rest: f64 = b[i] - ((i + 1)..d).map(|j| a[i][j] * x[j]).sum::<f64>();
        x[i] = rest / a[i][i];
    }
    x
}

/// The recipe's formula evaluated in host `f64`: `(intercept, coef)`.
fn plain_newton_step(records: &[Record], cohort: &Cohort) -> (f64, Vec<f64>) {
    let rows: Vec<(Vec<f64>, f64)> = records
        .iter()
        .filter(|r| in_cohort(r, cohort))
        .map(|r| {
            let x = cohort.features.iter().map(|c| plain_value(r, *c)).collect();
            (x, f64::from(r.affected))
        })
        .collect();
    let n = rows.len() as f64;
    let mean: Vec<f64> = (0..FEATURES)
        .map(|j| rows.iter().map(|(x, _)| x[j]).sum::<f64>() / n)
        .collect();
    let y_mean = rows.iter().map(|(_, y)| y).sum::<f64>() / n;

    let mut a = vec![vec![0.0; FEATURES]; FEATURES];
    let mut b = vec![0.0; FEATURES];
    for j in 0..FEATURES {
        b[j] = rows.iter().map(|(x, y)| x[j] * y).sum::<f64>() / n - mean[j] * y_mean;
        for k in 0..FEATURES {
            a[j][k] = rows.iter().map(|(x, _)| x[j] * x[k]).sum::<f64>() / n - mean[j] * mean[k];
        }
    }
    for j in 0..FEATURES {
        a[j][j] = a[j][j] * (1.0 + RIDGE) + PIVOT_FLOOR;
    }
    let slope = solve(a, b);
    let coef: Vec<f64> = slope.iter().map(|s| 4.0 * s).collect();
    let intercept = 4.0 * (y_mean - 0.5) - (0..FEATURES).map(|j| coef[j] * mean[j]).sum::<f64>();
    (intercept, coef)
}

/// The buyer's solve on the revealed sums: `(intercept, coef)`.
///
/// Same formula as `plain_newton_step`, but from the integer moments the
/// circuit hands over rather than from the records.
fn solve_moments(m: &Moments) -> (f64, Vec<f64>) {
    let n = f64::from(m.included);
    let mean: Vec<f64> = m.sum_x.iter().map(|s| f64::from(*s) / n).collect();
    let y_mean = f64::from(m.cases) / n;
    let mut a = vec![vec![0.0; FEATURES]; FEATURES];
    let mut b = vec![0.0; FEATURES];
    let mut pair = 0;
    for j in 0..FEATURES {
        b[j] = f64::from(m.sum_xy[j]) / n - mean[j] * y_mean;
        for k in j..FEATURES {
            let cov = f64::from(m.sum_xx[pair]) / n - mean[j] * mean[k];
            a[j][k] = cov;
            a[k][j] = cov;
            pair += 1;
        }
    }
    for j in 0..FEATURES {
        a[j][j] = a[j][j] * (1.0 + RIDGE) + PIVOT_FLOOR;
    }
    let slope = solve(a, b);
    let coef: Vec<f64> = slope.iter().map(|s| 4.0 * s).collect();
    let intercept = 4.0 * (y_mean - 0.5) - (0..FEATURES).map(|j| coef[j] * mean[j]).sum::<f64>();
    (intercept, coef)
}

// ---------------------------------------------------------------------------
// Synthetic cohort with a known logistic structure (`SC-002`).
// ---------------------------------------------------------------------------

/// SplitMix64 — deterministic, so the measured gap is the same on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, bound: u8) -> u8 {
        (self.next() % u64::from(bound)) as u8
    }
}

/// True effects of the synthetic cohort: `sex`, `age` and four of eight
/// markers carry signal, four markers are noise. Chosen so the converged fit
/// lands well below the AUC ceiling — a metric at 1.0 cannot show a gap.
const TRUE_INTERCEPT: f64 = -2.4;
const TRUE_SEX: f64 = 0.35;
const TRUE_AGE: f64 = 0.02;
const TRUE_MARKERS: [f64; 8] = [0.55, -0.45, 0.35, 0.25, 0.0, 0.0, 0.0, 0.0];
const MINOR_ALLELE: f64 = 0.3;

fn model_features() -> [u8; FEATURES] {
    let mut codes = vec![FEATURE_SEX, FEATURE_AGE];
    codes.extend((0..8).map(marker));
    features(&codes)
}

fn synthetic(rng: &mut Rng, count: usize) -> Vec<Record> {
    (0..count)
        .map(|_| {
            let sex = rng.below(2);
            let age = 20 + rng.below(61);
            let mut genotypes = [0u8; 8];
            for g in genotypes.iter_mut() {
                *g = u8::from(rng.unit() < MINOR_ALLELE) + u8::from(rng.unit() < MINOR_ALLELE);
            }
            let logit = TRUE_INTERCEPT
                + TRUE_SEX * f64::from(sex)
                + TRUE_AGE * f64::from(age)
                + (0..8).map(|m| TRUE_MARKERS[m] * f64::from(genotypes[m])).sum::<f64>();
            let affected = u8::from(rng.unit() < 1.0 / (1.0 + (-logit).exp()));
            record(sex, age, affected, &genotypes)
        })
        .collect()
}

/// The fully converged plain fit: Newton–Raphson (IRLS) to convergence, no
/// ridge — the model `SC-002` compares against.
fn plain_logistic_fit(records: &[Record], codes: &[u8; FEATURES]) -> (f64, Vec<f64>) {
    let rows: Vec<(Vec<f64>, f64)> = records
        .iter()
        .map(|r| {
            let mut x = vec![1.0];
            x.extend(codes.iter().filter(|c| **c != FEATURE_NONE).map(|c| plain_value(r, *c)));
            (x, f64::from(r.affected))
        })
        .collect();
    let d = rows[0].0.len();
    let mut beta = vec![0.0; d];
    for _ in 0..50 {
        let mut h = vec![vec![0.0; d]; d];
        let mut g = vec![0.0; d];
        for (x, y) in &rows {
            let eta: f64 = x.iter().zip(&beta).map(|(a, b)| a * b).sum();
            let p = 1.0 / (1.0 + (-eta).exp());
            for j in 0..d {
                g[j] += x[j] * (y - p);
                for k in 0..d {
                    h[j][k] += x[j] * x[k] * p * (1.0 - p);
                }
            }
        }
        let step = solve(h, g);
        let size: f64 = step.iter().map(|s| s.abs()).fold(0.0, f64::max);
        for (b, s) in beta.iter_mut().zip(&step) {
            *b += s;
        }
        if size < 1e-10 {
            break;
        }
    }
    (beta[0], beta[1..].to_vec())
}

fn score(r: &Record, codes: &[u8; FEATURES], intercept: f64, coef: &[f64]) -> f64 {
    intercept
        + codes
            .iter()
            .zip(coef)
            .map(|(c, b)| b * plain_value(r, *c))
            .sum::<f64>()
}

/// AUC as the Mann–Whitney statistic, ties counted as half.
fn auc(records: &[Record], scores: &[f64]) -> f64 {
    let cases: Vec<f64> = records
        .iter()
        .zip(scores)
        .filter(|(r, _)| r.affected == 1)
        .map(|(_, s)| *s)
        .collect();
    let controls: Vec<f64> = records
        .iter()
        .zip(scores)
        .filter(|(r, _)| r.affected == 0)
        .map(|(_, s)| *s)
        .collect();
    let mut wins = 0.0;
    for c in &cases {
        for k in &controls {
            wins += if c > k {
                1.0
            } else if c == k {
                0.5
            } else {
                0.0
            };
        }
    }
    wins / (cases.len() as f64 * controls.len() as f64)
}

// ---------------------------------------------------------------------------
// The accumulator.
// ---------------------------------------------------------------------------

#[test]
fn folds_accumulate_the_exact_sums() {
    // Thirteen records, so the last batch is short and the padding has to
    // stay out — zeros are a perfectly valid record otherwise.
    let codes = features(&[FEATURE_SEX, FEATURE_AGE, marker(0), marker(3)]);
    let cohort = Cohort::everyone(codes);
    let mut rng = Rng(7);
    let records: Vec<Record> = (0..13)
        .map(|_| {
            record(
                rng.below(2),
                20 + rng.below(70),
                rng.below(2),
                &[rng.below(3), rng.below(3), rng.below(3), rng.below(3)],
            )
        })
        .collect();

    let acc = fold_all(empty_accumulator(), &records, &cohort)
        .to_arcis()
        .unpack();

    assert_eq!(acc.included, 13);
    assert_eq!(acc.dataset_included, 13);
    assert_eq!(acc.cases, records.iter().map(|r| u32::from(r.affected)).sum::<u32>());
    let mut pair = 0;
    for j in 0..FEATURES {
        let xj = |r: &Record| plain_value(r, codes[j]) as u64;
        assert_eq!(u64::from(acc.sum_x[j]), records.iter().map(xj).sum::<u64>(), "Σx[{j}]");
        assert_eq!(
            u64::from(acc.sum_xy[j]),
            records.iter().map(|r| xj(r) * u64::from(r.affected)).sum::<u64>(),
            "Σxy[{j}]"
        );
        for k in j..FEATURES {
            let xk = |r: &Record| plain_value(r, codes[k]) as u64;
            assert_eq!(
                acc.sum_xx[pair],
                records.iter().map(|r| xj(r) * xk(r)).sum::<u64>(),
                "Σxx[{j},{k}]"
            );
            pair += 1;
        }
    }
    assert_eq!(pair, FEATURE_PAIRS);
}

#[test]
fn filters_keep_records_out_of_every_sum() {
    let cohort = Cohort {
        min_age: 40,
        max_age: 60,
        sex_filter: 1,
        features: features(&[FEATURE_AGE, marker(0)]),
    };
    let mut records = Vec::new();
    records.extend((0..5).map(|_| record(1, 50, 1, &[2])));
    records.extend((0..4).map(|_| record(0, 50, 1, &[2]))); // wrong sex
    records.extend((0..3).map(|_| record(1, 70, 1, &[2]))); // too old

    let acc = fold_all(empty_accumulator(), &records, &cohort)
        .to_arcis()
        .unpack();

    assert_eq!(acc.included, 5);
    assert_eq!(acc.cases, 5);
    assert_eq!(acc.sum_x[0], 5 * 50);
    assert_eq!(acc.sum_x[1], 5 * 2);
    assert_eq!(acc.sum_xx[0], 5 * 50 * 50);
}

// ---------------------------------------------------------------------------
// The reveal.
// ---------------------------------------------------------------------------

#[test]
fn reveal_hands_over_the_exact_sums() {
    let mut rng = Rng(11);
    let records = synthetic(&mut rng, 160);
    let cohort = Cohort::everyone(model_features());

    let (moments, disclosed) = fit(&records, &cohort);
    let acc = fold_all(empty_accumulator(), &records, &cohort)
        .to_arcis()
        .unpack();

    assert_eq!(moments.suppressed, 0);
    assert_eq!(moments.oversized, 0);
    assert_eq!(disclosed, 160);
    assert_eq!(moments.included, 160);
    assert_eq!(moments.cases, acc.cases);
    assert_eq!(moments.sum_x, acc.sum_x);
    assert_eq!(moments.sum_xy, acc.sum_xy);
    for pair in 0..FEATURE_PAIRS {
        assert_eq!(u64::from(moments.sum_xx[pair]), acc.sum_xx[pair], "Σxx pair {pair}");
    }

    // And the buyer's solve on them is the formula on the records.
    let (intercept, coef) = solve_moments(&moments);
    let (expected_intercept, expected_coef) = plain_newton_step(&records, &cohort);
    assert!((intercept - expected_intercept).abs() < 1e-9);
    for j in 0..FEATURES {
        assert!((coef[j] - expected_coef[j]).abs() < 1e-9, "coef[{j}]");
    }
}

#[test]
fn constant_and_unused_features_get_a_zero_coefficient() {
    // `sex` under a sex filter is constant, marker 5 is beyond the dataset's
    // three markers, and the remaining slots are unused. None of them may
    // make the buyer's system singular, and none may get a coefficient.
    let mut rng = Rng(3);
    let records: Vec<Record> = synthetic(&mut rng, 200)
        .into_iter()
        .map(|r| record(1, r.age, r.affected, &r.genotypes[..3]))
        .collect();
    let cohort = Cohort {
        min_age: 0,
        max_age: u8::MAX,
        sex_filter: 1,
        features: features(&[FEATURE_SEX, FEATURE_AGE, marker(0), marker(5)]),
    };

    let (moments, _) = fit(&records, &cohort);
    assert_eq!(moments.suppressed, 0);
    let (_, coef) = solve_moments(&moments);

    assert!(coef[0].abs() < 1e-6, "sex is constant: {}", coef[0]);
    assert!(coef[3].abs() < 1e-6, "marker 5 is absent: {}", coef[3]);
    for (slot, b) in coef.iter().enumerate().skip(4) {
        assert!(b.abs() < 1e-9, "unused slot {slot}: {b}");
    }
    assert!(coef[1] != 0.0 && coef[2] != 0.0, "the real features still count");
    assert!(coef.iter().all(|b| b.is_finite()));
}

#[test]
fn a_feature_chosen_twice_splits_its_coefficient() {
    // Duplicate columns make `Cov(x)` singular; the ridge keeps it solvable
    // and splits the weight evenly instead of returning garbage.
    let mut rng = Rng(5);
    let records = synthetic(&mut rng, 200);
    let once = Cohort::everyone(features(&[FEATURE_AGE, marker(0)]));
    let twice = Cohort::everyone(features(&[FEATURE_AGE, marker(0), marker(0)]));

    let (_, single) = solve_moments(&fit(&records, &once).0);
    let (_, double) = solve_moments(&fit(&records, &twice).0);

    assert!((double[1] - double[2]).abs() < 1e-9);
    let split = double[1] + double[2];
    assert!(
        (split - single[1]).abs() < 0.01 * single[1].abs(),
        "{split} vs {}",
        single[1]
    );
}

fn assert_silent(moments: &Moments) {
    assert_eq!(moments.included, 0, "the size of the cohort is not said either");
    assert_eq!(moments.cases, 0);
    assert!(moments.sum_x.iter().all(|s| *s == 0));
    assert!(moments.sum_xy.iter().all(|s| *s == 0));
    assert!(moments.sum_xx.iter().all(|s| *s == 0));
}

#[test]
fn the_cohort_has_to_grow_with_the_model() {
    // k used features need `EVENTS_PER_PARAMETER · (k + 1)` records. One
    // record short is suppressed; exactly that many is not.
    let codes = features(&[FEATURE_AGE, marker(0), marker(1)]);
    let required = (EVENTS_PER_PARAMETER * 4) as usize;
    let mut rng = Rng(13);
    let balanced = |count: usize, rng: &mut Rng| -> Vec<Record> {
        (0..count)
            .map(|i| record(0, 30 + rng.below(40), (i % 2) as u8, &[rng.below(3), rng.below(3)]))
            .collect()
    };

    let short = balanced(required - 1, &mut rng);
    let exact = balanced(required, &mut rng);

    let (below, disclosed_below) = fit(&short, &Cohort::everyone(codes));
    let (at, disclosed_at) = fit(&exact, &Cohort::everyone(codes));

    assert_eq!(below.suppressed, 1);
    assert_eq!(below.oversized, 0);
    assert_eq!(disclosed_below, 0, "nothing to pay for");
    assert_silent(&below);

    assert_eq!(at.suppressed, 0);
    assert_eq!(disclosed_at, required as u32);
}

#[test]
fn either_class_below_min_cohort_suppresses_the_model() {
    // A model on one affected person points at that person's genotype, no
    // matter how many controls surround them.
    let codes = features(&[marker(0)]);
    let cases_short: Vec<Record> = (0..60)
        .map(|i| record(0, 40, u8::from(i < MIN_COHORT as usize - 1), &[(i % 3) as u8]))
        .collect();
    let controls_short: Vec<Record> = (0..60)
        .map(|i| record(0, 40, u8::from(i >= MIN_COHORT as usize - 1), &[(i % 3) as u8]))
        .collect();
    let both_at_floor: Vec<Record> = (0..60)
        .map(|i| record(0, 40, u8::from(i < MIN_COHORT as usize), &[(i % 3) as u8]))
        .collect();

    let (few_cases, _) = fit(&cases_short, &Cohort::everyone(codes));
    let (few_controls, _) = fit(&controls_short, &Cohort::everyone(codes));
    assert_eq!(few_cases.suppressed, 1, "9 cases");
    assert_silent(&few_cases);
    assert_eq!(few_controls.suppressed, 1, "9 controls");
    assert_silent(&few_controls);

    let (at_floor, _) = fit(&both_at_floor, &Cohort::everyone(codes));
    assert_eq!(at_floor.suppressed, 0, "10 cases, 50 controls");
    assert_eq!(at_floor.cases, MIN_COHORT);
}

#[test]
fn an_empty_cohort_is_suppressed() {
    let cohort = Cohort::everyone(features(&[FEATURE_AGE]));
    let (moments, disclosed) = fit(&[], &cohort);
    assert_eq!(moments.suppressed, 1);
    assert_eq!(disclosed, 0);
    assert_silent(&moments);
}

/// An accumulator that the folds would take ~107 000 records to reach.
fn accumulator_with(sum_age_squared: u64) -> Acc {
    let mut sum_xx = [0u64; FEATURE_PAIRS];
    sum_xx[0] = sum_age_squared;
    let mut sum_x = [0u32; FEATURES];
    sum_x[0] = 1_000_000;
    let state = Regression {
        included: 200_000,
        dataset_included: 0,
        cases: 50_000,
        sum_x,
        sum_xy: [0u32; FEATURES],
        sum_xx,
    };
    Mxe::get().from_arcis(Pack::new(state))
}

#[test]
fn a_sum_past_u32_suppresses_instead_of_wrapping() {
    // The report narrows `Σxxᵀ` to `u32` to fit one callback; a wrapped
    // `Σ age²` would hand the buyer a wrong model that looks like a right one.
    let cohort = Cohort::everyone(features(&[FEATURE_AGE]));

    let (at_edge, disclosed_edge, _) = reveal(accumulator_with(u64::from(u32::MAX)), &cohort);
    let (past, disclosed_past, _) = reveal(accumulator_with(u64::from(u32::MAX) + 1), &cohort);

    assert_eq!(at_edge.oversized, 0);
    assert_eq!(at_edge.sum_xx[0], u32::MAX);
    assert_eq!(disclosed_edge, 200_000);

    assert_eq!(past.oversized, 1);
    assert_eq!(past.suppressed, 0, "oversized says only that");
    assert_eq!(disclosed_past, 0, "the deposit goes back in full");
    assert_silent(&past);
}

// ---------------------------------------------------------------------------
// The pool: contributions and the order guard, as for frequencies.
// ---------------------------------------------------------------------------

#[test]
fn contributions_are_per_dataset_and_floored() {
    let cohort = Cohort::everyone(features(&[FEATURE_AGE]));
    let small: Vec<Record> = (0..MIN_CONTRIBUTION - 1).map(|_| record(0, 40, 1, &[])).collect();
    let large: Vec<Record> = (0..12).map(|_| record(1, 50, 0, &[])).collect();

    let (acc, small_paid, small_below) = close(fold_all(empty_accumulator(), &small, &cohort));
    let (acc, large_paid, large_below) = close(fold_all(acc, &large, &cohort));
    let pool = acc.to_arcis().unpack();

    assert_eq!((small_paid, small_below), (0, 1));
    assert_eq!((large_paid, large_below), (12, 0));
    assert_eq!(pool.included, MIN_CONTRIBUTION - 1 + 12, "the floored records stay in the pool");
    assert_eq!(pool.dataset_included, 0);
}

#[test]
fn reveal_flags_a_dataset_left_unclosed() {
    let cohort = Cohort::everyone(features(&[FEATURE_AGE]));
    let records: Vec<Record> = (0..12).map(|i| record(0, 40, (i % 2) as u8, &[])).collect();
    let (_, disclosed, unclosed) = reveal(fold_all(empty_accumulator(), &records, &cohort), &cohort);
    assert_eq!(unclosed, 1);
    assert_eq!(disclosed, 0, "12 records are below 10 · (1 + 1)");
}

// ---------------------------------------------------------------------------
// `SC-002`: quality against the fully converged plain fit.
// ---------------------------------------------------------------------------

/// Training cohort size. Small enough for the mock evaluator, large enough
/// for 10 events per parameter with room to spare.
const TRAIN: usize = 400;
const HELD_OUT: usize = 4_000;
const SC002_BUDGET: f64 = 0.02;

#[test]
fn sc002_auc_gap_with_the_converged_plain_fit_is_within_two_points() {
    let codes = model_features();
    let mut rng = Rng(2026_10_21);
    let train = synthetic(&mut rng, TRAIN);
    let held_out = synthetic(&mut rng, HELD_OUT);

    let (moments, _) = fit(&train, &Cohort::everyone(codes));
    assert_eq!(moments.suppressed, 0);
    let (intercept, coef) = solve_moments(&moments);
    let (plain_intercept, plain_coef) = plain_logistic_fit(&train, &codes);

    let auc_of = |b0: f64, b: &[f64]| -> f64 {
        let scores: Vec<f64> = held_out.iter().map(|r| score(r, &codes, b0, b)).collect();
        auc(&held_out, &scores)
    };
    let mpc_auc = auc_of(intercept, &coef);
    let plain_auc = auc_of(plain_intercept, &plain_coef);
    let gap = (plain_auc - mpc_auc).abs();

    println!(
        "SC-002 regression: plain AUC {plain_auc:.4}, MPC AUC {mpc_auc:.4}, gap {:.2} p.p.",
        gap * 100.0
    );
    println!("  plain b0 {plain_intercept:.4}, b {plain_coef:.4?}");
    println!("  MPC   b0 {intercept:.4}, b {coef:.4?}");

    // The metric must be off the ceiling, or it cannot show a gap at all.
    assert!(plain_auc > 0.6 && plain_auc < 0.9, "plain AUC {plain_auc} is at a ceiling or floor");
    assert!(gap <= SC002_BUDGET, "gap {gap} exceeds {SC002_BUDGET}");

    // Negative control: the same model with its marker coefficients assigned
    // to the wrong markers — the kind of defect a layout slip between the
    // circuit and the SDK would make. The metric has to see it, or the green
    // verdict above means nothing.
    let mut swapped = coef.clone();
    swapped[2..6].reverse();
    let wrong_gap = (plain_auc - auc_of(intercept, &swapped)).abs();
    println!("  control (markers swapped): gap {:.2} p.p.", wrong_gap * 100.0);
    assert!(wrong_gap > SC002_BUDGET, "the metric does not see a swapped model: {wrong_gap}");
}

// ---------------------------------------------------------------------------
// The fixture `packages/shared/tests/regression.test.ts` holds the SDK to.
// ---------------------------------------------------------------------------

/// Moments of 300 synthetic records over `model_features()`. Host-only — no
/// circuit runs here; the point is that the TS solve and this one agree on
/// the same input, so the `SC-002` number above speaks for the SDK too.
fn fixture_moments() -> Moments {
    Moments {
        included: 300,
        cases: 88,
        suppressed: 0,
        oversized: 0,
        sum_x: [145, 15338, 191, 195, 196, 168, 185, 171, 183, 187],
        sum_xy: [48, 4992, 72, 39, 69, 55, 50, 50, 64, 58],
        sum_xx: [
            145, 7364, 85, 87, 103, 77, 92, 75, 97, 83, 880344, 10061, 10320, 10012, 8833, 9679,
            8686, 9693, 9779, 249, 134, 128, 118, 120, 106, 117, 119, 261, 126, 138, 110, 111, 127,
            116, 268, 114, 115, 117, 119, 113, 214, 91, 92, 111, 111, 239, 94, 94, 118, 229, 99,
            111, 235, 108, 243,
        ],
    }
}

/// `solve_moments(fixture_moments())`, as printed by this test.
const FIXTURE_INTERCEPT: f64 = -2.2898729545907717;
const FIXTURE_COEF: [f64; FEATURES] = [
    0.2519753086552152,
    0.020319498981722233,
    0.4968673813503957,
    -0.688992477270575,
    0.28814591569473413,
    0.22774299961009872,
    -0.16579675084950238,
    0.01745507768515699,
    0.2690434585960987,
    0.07450298801952789,
];

#[test]
fn the_sdk_fixture_solves_to_the_recorded_model() {
    let (intercept, coef) = solve_moments(&fixture_moments());
    assert!((intercept - FIXTURE_INTERCEPT).abs() < 1e-12);
    for j in 0..FEATURES {
        assert!((coef[j] - FIXTURE_COEF[j]).abs() < 1e-12, "coef[{j}]");
    }
}
