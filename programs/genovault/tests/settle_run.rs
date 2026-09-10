//! Розкриття й розподіл плати за прогін (`T026`, `FR-016`, `FR-018b`, `SC-006`).
//!
//! Арифметика часток живе юніт-тестами в `state/settlement.rs`, логіка
//! callback'а — в `instructions/settle_run.rs`. Тут те, чого юніт не бачить:
//! `init_if_needed` на балансах, звірка датасету з рядком прогону, переказ
//! різниці з сейфа під підписом PDA і статус, який з'являється тільки після
//! того, як усім нараховано.
//!
//! Прогін збирається зі стану, а не проходить весь шлях від `request_run`:
//! пройти його чесно означало б ще й дочекатися callback'а MPC, якого на
//! стенді немає в принципі — програми Arcium в ньому не існує. Стан після
//! розкриття виглядає рівно так, як його лишає `accept_reveal`, і саме він
//! тут перевіряється.
//!
//! Запуск: `scripts/wsl-test-program.sh`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::state::{
    Dataset, DatasetStatus, OwnerBalance, PlatformConfig, Run, RunDataset, RunStatus,
    RECIPE_PARAMS_LEN,
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

/// Верхня оцінка, заблокована при замовленні. Фактична ціна виходить нижчою —
/// заявлених записів завжди більше, ніж проходить фільтри рецепта.
const ESCROW: u64 = 100_000_000;

/// Ціни й внески пулу: дорожчий датасет дав менше записів, дешевший — більше.
const PRICE_A: u64 = 25_000_000;
const PRICE_B: u64 = 10_000_000;
const RECORDS_A: u32 = 1_000;
const RECORDS_B: u32 = 3_000;

/// `ціна × записи / 1000` для кожного, коли придушених записів немає.
const GROSS_A: u64 = 25_000_000;
const GROSS_B: u64 = 30_000_000;
const FEE_A: u64 = 1_750_000;
const FEE_B: u64 = 2_100_000;

struct Fixture {
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
    accounts: Vec<(Pubkey, Account)>,
}

fn dataset_state(owner: Pubkey, dataset_id: &str, price_per_1k: u64, bump: u8) -> Dataset {
    Dataset {
        owner,
        dataset_id: dataset_id.to_string(),
        version: 1,
        content_hash: [7u8; 32],
        record_count_claimed: 10_000,
        price_per_1k,
        consent_version: 1,
        status: DatasetStatus::Active,
        verified_badge: None,
        bump,
    }
}

impl Fixture {
    /// Прогін після розкриття: пул закритий, внески оголошені, звіт записано.
    fn revealed(pool: &[(u64, u32)], records_included: u32) -> Self {
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

        let mut accounts = vec![
            (payer, funded_wallet()),
            (mint, mint_account(DECIMALS, ESCROW)),
            (buyer_tokens, token_account(mint, buyer, 0)),
            // У сейфі лежить депозит цього прогону — рівно те, що покупець
            // заблокував при замовленні.
            (vault, token_account(mint, config, ESCROW)),
            system_program(),
            token2022::keyed_account(),
        ];

        accounts.push((
            config,
            stored(
                &PlatformConfig {
                    authority,
                    mint,
                    fee_bps: FEE_BPS,
                    paused: false,
                    bump: config_bump,
                },
                LAMPORTS_PER_SOL,
            ),
        ));

        let mut datasets = Vec::new();
        let mut owners = Vec::new();
        let mut entries = Vec::new();
        for (index, (price, records)) in pool.iter().enumerate() {
            let owner = Pubkey::new_unique();
            let dataset_id = format!("exome-{index}");
            let (dataset, bump) = Pubkey::find_program_address(
                &[Dataset::SEED, owner.as_ref(), dataset_id.as_bytes()],
                &genovault::ID,
            );
            accounts.push((
                dataset,
                stored(
                    &dataset_state(owner, &dataset_id, *price, bump),
                    LAMPORTS_PER_SOL,
                ),
            ));
            accounts.push(empty(owner_balance_pda(&owner).0));
            entries.push(RunDataset {
                dataset,
                price_per_1k: *price,
                records_included: *records,
                below_floor: *records == 0,
                settled: false,
            });
            datasets.push(dataset);
            owners.push(owner);
        }
        accounts.push(empty(owner_balance_pda(&authority).0));

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
            fee_bps: FEE_BPS,
            escrow_amount: ESCROW,
            settled_count: 0,
            settled_amount: 0,
            refunded: false,
            status: RunStatus::Running,
            result_hash: Some([3u8; 32]),
            records_included,
            suppressed: records_included == 0,
            dataset_cursor: pool.len() as u32,
            folded_batches: 125,
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
            owners,
            accounts,
        }
    }

    fn standard() -> Self {
        Self::revealed(
            &[(PRICE_A, RECORDS_A), (PRICE_B, RECORDS_B)],
            RECORDS_A + RECORDS_B,
        )
    }

    fn settle_ix(&self, index: u32, dataset: Pubkey, owner: Pubkey) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::SettleDataset {
                payer: self.payer,
                config: self.config,
                run: self.run,
                dataset,
                owner_balance: owner_balance_pda(&owner).0,
                platform_balance: owner_balance_pda(&self.authority).0,
                system_program: system_program_id(),
            }
            .to_account_metas(None),
            data: genovault::instruction::SettleDataset { index }.data(),
        }
    }

    fn settle(&mut self, index: usize) -> InstructionResult {
        let ix = self.settle_ix(index as u32, self.datasets[index], self.owners[index]);
        let result = self.mollusk.process_instruction(&ix, &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
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

    fn finalize(&mut self) -> InstructionResult {
        let result = self
            .mollusk
            .process_instruction(&self.finalize_ix(), &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    fn balance(&self, owner: &Pubkey) -> OwnerBalance {
        read(&self.accounts, &owner_balance_pda(owner).0)
    }

    fn run_state(&self) -> Run {
        read(&self.accounts, &self.run)
    }
}

// ── Успішний шлях ────────────────────────────────────────────────────────────

#[test]
fn each_owner_is_credited_for_the_records_that_entered() {
    let mut f = Fixture::standard();

    let result = f.settle(0);
    assert!(is_success(&result), "{:?}", result.program_result);
    let result = f.settle(1);
    assert!(is_success(&result), "{:?}", result.program_result);

    // `FR-018b`: ціна власного датасету × власні записи мінус комісія.
    assert_eq!(f.balance(&f.owners[0]).accrued, GROSS_A - FEE_A);
    assert_eq!(f.balance(&f.owners[1]).accrued, GROSS_B - FEE_B);
    assert_eq!(
        f.balance(&f.authority).accrued,
        FEE_A + FEE_B,
        "комісія береться з нарахування, а не додається до рахунку покупця"
    );

    let run = f.run_state();
    assert_eq!(run.settled_count, 2);
    assert_eq!(run.settled_amount, GROSS_A + GROSS_B);
    assert!(run.datasets.iter().all(|entry| entry.settled));
}

#[test]
fn the_sums_add_up_to_the_escrow() {
    // `SC-006` до найменшої одиниці, і на справжніх токенах: скільки пішло з
    // сейфа покупцю, стільки й лишилось під нарахування.
    let mut f = Fixture::standard();
    f.settle(0);
    f.settle(1);

    let result = f.finalize();
    assert!(is_success(&result), "{:?}", result.program_result);

    let refund = ESCROW - (GROSS_A + GROSS_B);
    assert_eq!(
        token_amount(&f.accounts, &f.buyer_tokens),
        refund,
        "різниця між верхньою оцінкою і фактичною ціною належить покупцю"
    );
    assert_eq!(
        token_amount(&f.accounts, &f.vault),
        GROSS_A + GROSS_B,
        "у сейфі лишається рівно те, що роздано балансами"
    );

    let owners = f.balance(&f.owners[0]).accrued + f.balance(&f.owners[1]).accrued;
    let fees = f.balance(&f.authority).accrued;
    assert_eq!(owners + fees + refund, ESCROW);

    assert_eq!(f.run_state().status, RunStatus::Completed);
}

#[test]
fn a_suppressed_dataset_is_paid_for_by_the_buyer_but_not_to_its_owner() {
    // Другий датасет дав 9 записів — під порогом, внесок оголошено нулем. Його
    // записи в когорті, і покупець за них платить середньою ціною пулу; гроші
    // дістаються власнику, який поріг пройшов (`T019`).
    let mut f = Fixture::revealed(&[(PRICE_A, RECORDS_A), (PRICE_B, 0)], RECORDS_A + 9);

    f.settle(0);
    f.settle(1);

    let gross_a = 25_225_000u64;
    assert_eq!(
        f.run_state().settled_amount,
        gross_a,
        "покупець платить за всі 1 009 записів, а не за 1 000"
    );
    assert_eq!(
        f.balance(&f.owners[1]).accrued,
        0,
        "власник, який не дотягнув до порога, не отримує нічого"
    );
    assert!(f.balance(&f.owners[0]).accrued > GROSS_A - FEE_A);
}

#[test]
fn a_suppressed_cohort_returns_the_whole_deposit() {
    // Когорта менша за `MIN_COHORT`: рецепт віддав нулі, платити нема за що
    // (`FR-012`, `FR-016`). Прогін усе одно доходить до `completed` — він
    // відбувся, і покупець отримав ту відповідь, яку заслужив його фільтр.
    let mut f = Fixture::revealed(&[(PRICE_A, 0), (PRICE_B, 0)], 0);

    f.settle(0);
    f.settle(1);
    let result = f.finalize();
    assert!(is_success(&result), "{:?}", result.program_result);

    assert_eq!(token_amount(&f.accounts, &f.buyer_tokens), ESCROW);
    assert_eq!(token_amount(&f.accounts, &f.vault), 0);
    assert_eq!(f.balance(&f.owners[0]).accrued, 0);
    assert_eq!(f.balance(&f.authority).accrued, 0);
    assert_eq!(f.run_state().status, RunStatus::Completed);
}

// ── Відмови ──────────────────────────────────────────────────────────────────

#[test]
fn the_same_dataset_is_not_settled_twice() {
    let mut f = Fixture::standard();
    f.settle(0);

    let result = f.settle(0);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunAlreadySettled)),
        "лічильник дійшов би до кінця, поки один власник отримав двічі"
    );
}

#[test]
fn a_dataset_from_another_row_of_the_pool_is_refused() {
    // Датасет із прогону, але не з цього індексу: без звірки власник другого
    // отримав би за внесок першого.
    let f = Fixture::standard();
    let ix = f.settle_ix(0, f.datasets[1], f.owners[1]);
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunDatasetMismatch))
    );
}

#[test]
fn an_index_outside_the_pool_is_refused() {
    let f = Fixture::standard();
    let ix = f.settle_ix(2, f.datasets[0], f.owners[0]);
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunDatasetMismatch)),
        "рядка з таким номером у прогоні немає, тож і збігтися нема з чим"
    );
}

#[test]
fn the_run_does_not_close_before_everyone_is_paid() {
    // Повернути різницю раніше означало б віддати покупцю гроші, які ще
    // належать власникам, чиї нарахування не пройшли.
    let mut f = Fixture::standard();
    f.settle(0);

    let result = f.finalize();
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunSettlementIncomplete))
    );
    assert_eq!(
        token_amount(&f.accounts, &f.buyer_tokens),
        0,
        "невдале закриття не рухає грошей"
    );
}

#[test]
fn the_refund_goes_to_the_buyer_and_nobody_else() {
    // Інструкцію кличе будь-хто, і саме тому токен-акаунт отримувача мусить
    // належати покупцю: інакше той, хто кличе, назвав би своїм будь-який.
    let mut f = Fixture::standard();
    f.settle(0);
    f.settle(1);

    let stranger = Pubkey::new_unique();
    let stranger_tokens = Pubkey::new_unique();
    f.accounts
        .push((stranger_tokens, token_account(f.mint, stranger, 0)));

    let mut ix = f.finalize_ix();
    ix.accounts[3].pubkey = stranger_tokens;
    let result = f.mollusk.process_instruction(&ix, &f.accounts);

    assert_eq!(
        custom_error_code(&result),
        Some(anchor_code(
            anchor_lang::error::ErrorCode::ConstraintTokenOwner
        ))
    );
    assert_eq!(token_amount(&f.accounts, &f.vault), ESCROW);
}

#[test]
fn a_completed_run_is_not_settled_again() {
    let mut f = Fixture::standard();
    f.settle(0);
    f.settle(1);
    f.finalize();

    let result = f.finalize();
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunNotRunning)),
        "різницю повертають один раз"
    );
}
