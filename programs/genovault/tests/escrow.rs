//! Невдача прогону повертає депозит повністю (`T028`, `FR-016`).
//!
//! `finalize_run` сюди не дістає: він вимагає `running`, результату й
//! нарахувань усім, а в `failed` прогін потрапляє саме тому, що обчислення до
//! них не дійшло. Тому повернення — окрема інструкція, і перевіряти її треба
//! не на одному стані, а на кожному, яким туди приходять.
//!
//! # Чому стани тут не написані руками
//!
//! Шляхів у `failed` п'ять, і всі вони — callback'и MPC, яких на стенді немає:
//! програми Arcium в ньому не існує. Але переходи, які ці callback'и роблять
//! над станом, — звичайні функції програми (`accept_accumulator`,
//! `accept_dataset_close`, `accept_reveal`), і тест кличе саме їх. Виписаний
//! руками `Run { status: Failed, .. }` перевіряв би здогадку про те, як
//! виглядає невдача; тут перевіряється те, що її справді робить.
//!
//! Далі отриманий стан кладеться в акаунт, і повернення йде через зібраний
//! `.so`: обмеження акаунтів (`token::authority`, `seeds`, `has_one`) живуть у
//! згенерованому `try_accounts`, і тест на хендлер пройшов би повз них.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::instructions::dispatch::{accept_accumulator, accept_dataset_close};
use genovault::instructions::settle_run::accept_reveal;
use genovault::state::{
    PlatformConfig, Run, RunAccumulator, RunDataset, RunResult, RunStatus, ACCUMULATOR_CIPHERTEXTS,
    RECIPE_PARAMS_LEN, REPORT_CIPHERTEXTS,
};
use genovault::GenoVaultError;
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::token2022;
use solana_account::Account;

mod harness;
use harness::*;

const NONCE: u64 = 42;
const DECIMALS: u8 = 6;
const FEE_BPS: u16 = 700;

/// Верхня оцінка, заблокована при замовленні (`FR-015a`).
const ESCROW: u64 = 100_000_000;

/// Пул із двох датасетів: ціна за 1000 записів і скільки записів дав кожен.
const POOL: [(u64, u32); 2] = [(25_000_000, 1_000), (10_000_000, 3_000)];

/// Байти згорнутого батча — важливі тільки тим, що вони є: ланцюжок відбитків
/// має рости, щоб «упало після половини роботи» відрізнялось від «упало одразу».
const BATCH: [u8; 96] = [7u8; 96];

const ACCUMULATOR: [[u8; 32]; ACCUMULATOR_CIPHERTEXTS] = [[3u8; 32]; ACCUMULATOR_CIPHERTEXTS];
const REPORT: [[u8; 32]; REPORT_CIPHERTEXTS] = [[6u8; 32]; REPORT_CIPHERTEXTS];
const BUYER_KEY: [u8; 32] = [8u8; 32];

/// Де саме прогін зламався. Усі п'ять ведуть в `failed`, і жоден із них не
/// встиг зрушити грошей: нарахування вимагають результату.
#[derive(Clone, Copy, Debug)]
enum FailurePath {
    /// Порожній накопичувач не повернувся — згортати нема в що.
    Init,
    /// Згортка батча повернулась невдачею посеред першого датасету.
    Fold,
    /// Закриття другого датасету пулу впало, коли внесок першого вже оголошено.
    CloseDataset,
    /// Розкриття звіту повернулось непідписаним.
    Reveal,
    /// Розкриття прийшло зі сторожем `unclosed = 1`: ончейн-облік розійшовся з
    /// тим, що рахував рецепт, і платити з таких чисел не можна.
    Unclosed,
}

fn accepted_run(buyer: Pubkey, bump: u8) -> Run {
    Run {
        buyer,
        dispatcher: Pubkey::new_unique(),
        nonce: NONCE,
        recipe_id: 1,
        recipe_params: [0u8; RECIPE_PARAMS_LEN],
        use_type: 1,
        buyer_category: 1,
        buyer_x25519: BUYER_KEY,
        datasets: POOL
            .iter()
            .map(|(price, _)| RunDataset {
                dataset: Pubkey::new_unique(),
                price_per_1k: *price,
                records_included: 0,
                below_floor: false,
                settled: false,
            })
            .collect(),
        fee_bps: FEE_BPS,
        escrow_amount: ESCROW,
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
    }
}

fn empty_accumulator(run: Pubkey) -> RunAccumulator {
    RunAccumulator {
        run,
        nonce: 0,
        ciphertexts: [[0u8; 32]; ACCUMULATOR_CIPHERTEXTS],
        ready: false,
        pending: None,
        bump: 255,
    }
}

fn empty_result(run: Pubkey) -> RunResult {
    RunResult {
        run,
        encryption_key: [0u8; 32],
        nonce: 0,
        ciphertexts: [[0u8; 32]; REPORT_CIPHERTEXTS],
        records_included: 0,
        suppressed: false,
        bump: 255,
    }
}

/// Проводить прогін тими самими переходами, що й callback'и MPC, до вказаної
/// невдачі — і повертає стан, який після неї лишається в акаунті.
fn failed_run(path: FailurePath, buyer: Pubkey, bump: u8) -> Run {
    let run_key = run_pda(&buyer, NONCE);
    let mut run = accepted_run(buyer, bump);
    let mut acc = empty_accumulator(run_key);
    let mut result = empty_result(run_key);
    let computation = || Pubkey::new_unique();

    run.start().expect("публікація переводить прогін у running");

    // `frequencies_init`: порожній накопичувач під ключем MXE.
    let init = computation();
    acc.arm(init).unwrap();
    if matches!(path, FailurePath::Init) {
        accept_accumulator(run_key, &mut run, &mut acc, init, None).unwrap();
        return run;
    }
    accept_accumulator(run_key, &mut run, &mut acc, init, Some((1, ACCUMULATOR))).unwrap();

    // Дві згортки першого датасету — щоб невдача мала що по собі лишити.
    let first = run.datasets[0].dataset;
    for _ in 0..2 {
        let fold = computation();
        acc.arm(fold).unwrap();
        run.record_fold(&first, 32, &BATCH).unwrap();
        accept_accumulator(run_key, &mut run, &mut acc, fold, Some((2, ACCUMULATOR))).unwrap();
    }

    if matches!(path, FailurePath::Fold) {
        let fold = computation();
        acc.arm(fold).unwrap();
        run.record_fold(&first, 32, &BATCH).unwrap();
        accept_accumulator(run_key, &mut run, &mut acc, fold, None).unwrap();
        return run;
    }

    // Перший датасет закрито: його внесок оголошено, курсор пулу зрушив.
    let close = computation();
    acc.arm(close).unwrap();
    accept_dataset_close(
        run_key,
        &mut run,
        &mut acc,
        close,
        Some((3, ACCUMULATOR, POOL[0].1, 0)),
    )
    .unwrap();

    if matches!(path, FailurePath::CloseDataset) {
        let close = computation();
        acc.arm(close).unwrap();
        accept_dataset_close(run_key, &mut run, &mut acc, close, None).unwrap();
        return run;
    }

    let close = computation();
    acc.arm(close).unwrap();
    accept_dataset_close(
        run_key,
        &mut run,
        &mut acc,
        close,
        Some((4, ACCUMULATOR, POOL[1].1, 0)),
    )
    .unwrap();

    let reveal = computation();
    acc.arm(reveal).unwrap();
    let outcome = match path {
        FailurePath::Reveal => None,
        // Сторож: когорта є, а внеску на частину її записів ніхто не оголосив.
        FailurePath::Unclosed => Some((BUYER_KEY, 5, REPORT, POOL[0].1 + POOL[1].1, 1)),
        other => panic!("шлях {other:?} мав завершитись раніше"),
    };
    accept_reveal(run_key, &mut run, &mut acc, &mut result, reveal, outcome).unwrap();
    run
}

struct Fixture {
    mollusk: Mollusk,
    buyer: Pubkey,
    buyer_tokens: Pubkey,
    mint: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    run: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

impl Fixture {
    /// Стенд навколо готового стану прогону. `vault_amount` окремим числом,
    /// бо сейф платформи тримає депозити всіх прогонів разом.
    fn around(state: Run, vault_amount: u64) -> Self {
        let mut mollusk = mollusk();
        token2022::add_program(&mut mollusk);

        let buyer = state.buyer;
        let buyer_tokens = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (config, config_bump) = config_pda();
        let (vault, _) = vault_pda();
        let run = run_pda(&buyer, NONCE);

        let accounts = vec![
            (mint, mint_account(DECIMALS, vault_amount)),
            (buyer_tokens, token_account(mint, buyer, 0)),
            (vault, token_account(mint, config, vault_amount)),
            (
                config,
                stored(
                    &PlatformConfig {
                        authority: Pubkey::new_unique(),
                        mint,
                        fee_bps: FEE_BPS,
                        paused: false,
                        bump: config_bump,
                    },
                    LAMPORTS_PER_SOL,
                ),
            ),
            (run, stored(&state, 5 * LAMPORTS_PER_SOL)),
            system_program(),
            token2022::keyed_account(),
        ];

        Self {
            mollusk,
            buyer,
            buyer_tokens,
            mint,
            config,
            vault,
            run,
            accounts,
        }
    }

    fn failed(path: FailurePath) -> Self {
        let buyer = Pubkey::new_unique();
        let (_, bump) = Pubkey::find_program_address(
            &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
            &genovault::ID,
        );
        Self::around(failed_run(path, buyer, bump), ESCROW)
    }

    fn refund_ix(&self) -> Instruction {
        self.refund_ix_with(self.mint, self.buyer_tokens, self.vault)
    }

    fn refund_ix_with(&self, mint: Pubkey, buyer_tokens: Pubkey, vault: Pubkey) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::RefundFailedRun {
                config: self.config,
                run: self.run,
                mint,
                buyer_tokens,
                vault,
                token_program: token2022::ID,
            }
            .to_account_metas(None),
            data: genovault::instruction::RefundFailedRun {}.data(),
        }
    }

    fn refund(&mut self) -> InstructionResult {
        let result = self
            .mollusk
            .process_instruction(&self.refund_ix(), &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    fn run_state(&self) -> Run {
        read(&self.accounts, &self.run)
    }
}

/// Спільне твердження всіх п'яти шляхів: депозит повернувся цілим, і в сейфі
/// від цього прогону не лишилось нічого.
fn assert_whole_deposit_came_back(f: &mut Fixture) {
    let result = f.refund();
    assert!(is_success(&result), "{:?}", result.program_result);

    assert_eq!(
        token_amount(&f.accounts, &f.buyer_tokens),
        ESCROW,
        "`FR-016`: невдача повертає депозит повністю, а не залишок"
    );
    assert_eq!(token_amount(&f.accounts, &f.vault), 0);

    let run = f.run_state();
    assert!(run.refunded);
    assert_eq!(run.settled_amount, 0, "жоден власник не встиг отримати");
    assert_eq!(
        run.status,
        RunStatus::Failed,
        "гроші повернулись, але прогін не відбувся — причина лишається в журналі"
    );
}

// ── П'ять шляхів у `failed` ─────────────────────────────────────────────────

#[test]
fn an_aborted_init_returns_the_whole_deposit() {
    let mut f = Fixture::failed(FailurePath::Init);
    assert_eq!(
        f.run_state().folded_batches,
        0,
        "нічого не згорнулось: накопичувача не було"
    );

    assert_whole_deposit_came_back(&mut f);
}

#[test]
fn an_aborted_fold_returns_the_whole_deposit() {
    // Дві згортки вже в ланцюжку відбитків: покупець заплатив за роботу, яка
    // почалась. Депозит однаково повертається цілим — платить він за результат.
    let mut f = Fixture::failed(FailurePath::Fold);
    assert_eq!(f.run_state().folded_batches, 3);

    assert_whole_deposit_came_back(&mut f);
}

#[test]
fn an_aborted_dataset_close_returns_the_whole_deposit() {
    // Найнеприємніший шлях: внесок першого датасету вже оголошено в MPC і вже
    // лежить у рядку пулу. Порахувати з нього частку було б технічно можливо —
    // і саме тому важливо, що ніхто цього не робить: рецепт не дорахував.
    let mut f = Fixture::failed(FailurePath::CloseDataset);
    let run = f.run_state();
    assert_eq!(run.dataset_cursor, 1, "половина пулу закрита");
    assert_eq!(run.datasets[0].records_included, POOL[0].1);
    assert!(run.result_hash.is_none());

    assert_whole_deposit_came_back(&mut f);
}

#[test]
fn an_aborted_reveal_returns_the_whole_deposit() {
    // Весь пул згорнуто й закрито, впав тільки останній контур. Звіту немає —
    // покупець не отримав нічого, і депозит його.
    let mut f = Fixture::failed(FailurePath::Reveal);
    let run = f.run_state();
    assert_eq!(run.dataset_cursor, POOL.len() as u32);
    assert!(run.result_hash.is_none());

    assert_whole_deposit_came_back(&mut f);
}

#[test]
fn an_unclosed_dataset_returns_the_whole_deposit() {
    // Звіт прийшов, але сторож рецепта каже, що ончейн-облік із ним
    // розійшовся. Числа є — платити з них не можна.
    let mut f = Fixture::failed(FailurePath::Unclosed);
    assert!(
        f.run_state().result_hash.is_none(),
        "звіт зі сторожем не став результатом"
    );

    assert_whole_deposit_came_back(&mut f);
}

// ── Гарди ───────────────────────────────────────────────────────────────────

#[test]
fn the_deposit_comes_back_only_once() {
    // Статус лишається `failed` і після виплати — стерегти другий виклик може
    // тільки прапорець. Без нього це був би виніс сейфа чужими депозитами.
    let mut f = Fixture::failed(FailurePath::Reveal);
    assert!(is_success(&f.refund()));

    let result = f.refund();
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunAlreadyRefunded))
    );
}

#[test]
fn only_this_runs_deposit_leaves_the_vault() {
    // Сейф платформи один на всі прогони. Повернення бере рівно `escrow_amount`
    // свого прогону, і депозит сусіда лишається на місці.
    let buyer = Pubkey::new_unique();
    let (_, bump) = Pubkey::find_program_address(
        &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    let mut f = Fixture::around(failed_run(FailurePath::Reveal, buyer, bump), ESCROW * 3);

    let result = f.refund();
    assert!(is_success(&result), "{:?}", result.program_result);
    assert_eq!(token_amount(&f.accounts, &f.buyer_tokens), ESCROW);
    assert_eq!(token_amount(&f.accounts, &f.vault), ESCROW * 2);
}

#[test]
fn a_running_run_is_not_refunded_from_here() {
    // Прогін ще може дійти до розподілу. Повернути депозит зараз означало б
    // забрати гроші з-під нарахувань, які ось-ось стануть чиїмись.
    let buyer = Pubkey::new_unique();
    let (_, bump) = Pubkey::find_program_address(
        &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    let mut state = accepted_run(buyer, bump);
    state.start().unwrap();
    let mut f = Fixture::around(state, ESCROW);

    let result = f.refund();
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunNotFailed))
    );
    assert_eq!(token_amount(&f.accounts, &f.vault), ESCROW);
}

#[test]
fn a_completed_run_is_not_paid_a_second_time() {
    // `finalize_run` уже віддав різницю. Другий переказ звідси був би виплатою
    // тих самих грошей двічі — і статусом, і прапорцем це зупиняється окремо.
    let buyer = Pubkey::new_unique();
    let (_, bump) = Pubkey::find_program_address(
        &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
        &genovault::ID,
    );
    let mut state = accepted_run(buyer, bump);
    state.status = RunStatus::Completed;
    state.refunded = true;
    let mut f = Fixture::around(state, ESCROW);

    let result = f.refund();
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunNotFailed))
    );
}

#[test]
fn the_refund_goes_to_the_buyer_and_nobody_else() {
    // Кличе інструкцію будь-хто, і саме тому одержувач не може бути аргументом:
    // без цього обмеження чужа невдача стала б заробітком.
    let mut f = Fixture::failed(FailurePath::Reveal);
    let stranger = Pubkey::new_unique();
    let stranger_tokens = Pubkey::new_unique();
    f.accounts
        .push((stranger_tokens, token_account(f.mint, stranger, 0)));

    let ix = f.refund_ix_with(f.mint, stranger_tokens, f.vault);
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(
            anchor_lang::error::ErrorCode::ConstraintTokenOwner
        ))
    );
}

#[test]
fn the_money_comes_from_the_platform_vault_and_not_a_lookalike() {
    // Підставний сейф із тим самим мінтом і тим самим власником-PDA: без
    // перевірки seeds підпис конфігурації спорожнив би будь-який із них.
    let mut f = Fixture::failed(FailurePath::Reveal);
    let lookalike = Pubkey::new_unique();
    f.accounts
        .push((lookalike, token_account(f.mint, f.config, ESCROW)));

    let ix = f.refund_ix_with(f.mint, f.buyer_tokens, lookalike);
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintSeeds))
    );
}

#[test]
fn the_mint_is_the_one_the_platform_settles_in() {
    // `has_one = mint` на конфігурації: інакше переказ пішов би в токені, який
    // покупець не вносив, а депозит лишився б у сейфі.
    let mut f = Fixture::failed(FailurePath::Reveal);
    let other_mint = Pubkey::new_unique();
    f.accounts
        .push((other_mint, mint_account(DECIMALS, ESCROW)));

    let ix = f.refund_ix_with(other_mint, f.buyer_tokens, f.vault);
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(anchor_lang::error::ErrorCode::ConstraintHasOne))
    );
}
