use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;

/// Скільки датасетів може бути в одному прогоні.
///
/// Число не з голови: `SC-007` міряє розподіл між 50 власниками, тож менша
/// межа зробила б критерій недосяжним без правки структури, а більша — платила
/// б rent за місце, якого ніхто не обіцяв.
pub const MAX_RUN_DATASETS: usize = 50;

/// Статуси прогону (`FR-013`) — рівно ті п'ять, що названі у SPEC.
///
/// Порційність виплат навмисно **не** стала шостим статусом: її тримає
/// лічильник `settled_count`. Інакше «завершено» означало б «обчислення
/// скінчилось», а не «всім заплачено», і слово розходилось би зі змістом.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RunStatus {
    /// Замовлення прийняте, депозит заблокований, згоду перевірено.
    Accepted,
    /// Обчислення опубліковане в Arcium.
    Running,
    /// Результат отримано **і** всім власникам нараховано.
    Completed,
    /// Відхилено правилами: згода, межі каталогу рецептів, перевірка на витік.
    Rejected,
    /// Технічна невдача обчислення.
    Failed,
}

impl RunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Rejected | Self::Failed)
    }
}

/// Замовлений прогін (`FR-013`, `FR-016`).
///
/// Seeds: `["run", buyer, nonce]`.
///
/// Склад прогону лежить тут списком, а не відновлюється скануванням
/// програмних акаунтів: `FR-025` вимагає, щоб третя сторона звіряла журнал з
/// мережею, і читання одного акаунта — це те, що вона зробить без нашого коду.
#[account]
#[derive(InitSpace)]
pub struct Run {
    pub buyer: Pubkey,
    /// Обраний покупцем; він же в seeds, тож два прогони не сплутати.
    pub nonce: u64,
    pub recipe_id: u16,
    /// Тип використання і категорія покупця, заявлені при замовленні: саме
    /// вони перевірялись проти згоди кожного датасету.
    pub use_type: u32,
    pub buyer_category: u32,
    #[max_len(MAX_RUN_DATASETS)]
    pub datasets: Vec<Pubkey>,
    /// Комісія на момент замовлення (`FR-019`). Копія, а не посилання на
    /// конфігурацію: інакше зміна комісії переписувала б умови вже
    /// замовленого прогону.
    pub fee_bps: u16,
    /// Верхня оцінка, заблокована в депозиті (`FR-015a`).
    pub escrow_amount: u64,
    /// Скільки датасетів уже отримали нарахування.
    pub settled_count: u32,
    /// Скільки з депозиту вже роздано власникам.
    pub settled_amount: u64,
    pub status: RunStatus,
    /// Відбиток результату; з'являється, коли повернувся callback MPC.
    pub result_hash: Option<[u8; 32]>,
    pub created_at: i64,
    pub bump: u8,
}

impl Run {
    pub const SEED: &'static [u8] = b"run";

    pub fn dataset_count(&self) -> u32 {
        self.datasets.len() as u32
    }

    /// Перевірка складу прогону перед створенням акаунта.
    ///
    /// Дублікат у списку — не дрібниця форматування: він заплатив би одному
    /// власнику двічі за один датасет і зламав би сходження сум (`SC-006`).
    pub fn validate_datasets(datasets: &[Pubkey]) -> Result<()> {
        require!(!datasets.is_empty(), GenoVaultError::RunWithoutDatasets);
        require!(
            datasets.len() <= MAX_RUN_DATASETS,
            GenoVaultError::RunTooManyDatasets
        );
        for (index, dataset) in datasets.iter().enumerate() {
            require!(
                !datasets[index + 1..].contains(dataset),
                GenoVaultError::RunDuplicateDataset
            );
        }
        Ok(())
    }

    /// `accepted → running`: обчислення пішло в Arcium.
    pub fn start(&mut self) -> Result<()> {
        require!(
            self.status == RunStatus::Accepted,
            GenoVaultError::RunNotAccepted
        );
        self.status = RunStatus::Running;
        Ok(())
    }

    /// Відхилення правилами. Дозволене до публікації в MPC: після неї
    /// обчислення вже почалось, і його невдача — це `fail`, а не `reject`.
    pub fn reject(&mut self) -> Result<()> {
        require!(
            self.status == RunStatus::Accepted,
            GenoVaultError::RunNotAccepted
        );
        self.status = RunStatus::Rejected;
        Ok(())
    }

    /// Технічна невдача. Можлива і до, і після публікації — депозит
    /// повертається повністю в обох випадках (`FR-016`).
    pub fn fail(&mut self) -> Result<()> {
        require!(!self.status.is_terminal(), GenoVaultError::RunIsFinal);
        self.status = RunStatus::Failed;
        Ok(())
    }

    /// Відбиток результату з callback MPC. Записується рівно один раз:
    /// другий запис підмінив би те, що покупець уже бачить як свій результат.
    pub fn record_result(&mut self, result_hash: [u8; 32]) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            self.result_hash.is_none(),
            GenoVaultError::RunResultAlreadyRecorded
        );
        self.result_hash = Some(result_hash);
        Ok(())
    }

    /// Нарахування одному власнику. Виплати йдуть порціями, бо 50 власників в
    /// одну транзакцію не вміщаються.
    pub fn record_settlement(&mut self, amount: u64) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            self.result_hash.is_some(),
            GenoVaultError::RunResultMissing
        );
        require!(
            self.settled_count < self.dataset_count(),
            GenoVaultError::RunAlreadySettled
        );

        let settled_amount = self
            .settled_amount
            .checked_add(amount)
            .ok_or(GenoVaultError::RunSettlementOverflow)?;
        // Роздати більше, ніж заблоковано, не можна навіть на одну одиницю:
        // це рівно те, що доводить `SC-006`.
        require!(
            settled_amount <= self.escrow_amount,
            GenoVaultError::RunSettlementExceedsEscrow
        );

        self.settled_amount = settled_amount;
        self.settled_count += 1;
        Ok(())
    }

    /// `running → completed`. Проходить лише коли є результат і нараховано
    /// всім: «завершено» має означати «всім заплачено», а не «MPC відповів».
    pub fn complete(&mut self) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            self.result_hash.is_some(),
            GenoVaultError::RunResultMissing
        );
        require!(
            self.settled_count == self.dataset_count(),
            GenoVaultError::RunSettlementIncomplete
        );
        self.status = RunStatus::Completed;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: [u8; 32] = [3u8; 32];

    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    fn code(result: Result<()>) -> u32 {
        match result.expect_err("очікувалась відмова") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        }
    }

    fn run(datasets: usize) -> Run {
        Run {
            buyer: Pubkey::default(),
            nonce: 1,
            recipe_id: 1,
            use_type: 1,
            buyer_category: 1,
            datasets: (0..datasets).map(|_| Pubkey::new_unique()).collect(),
            fee_bps: 250,
            escrow_amount: 1_000,
            settled_count: 0,
            settled_amount: 0,
            status: RunStatus::Accepted,
            result_hash: None,
            created_at: 0,
            bump: 255,
        }
    }

    #[test]
    fn the_happy_path_ends_in_completed() {
        let mut r = run(2);
        r.start().unwrap();
        r.record_result(HASH).unwrap();
        r.record_settlement(400).unwrap();
        r.record_settlement(500).unwrap();
        r.complete().unwrap();

        assert_eq!(r.status, RunStatus::Completed);
        assert_eq!(r.settled_amount, 900);
        assert_eq!(r.result_hash, Some(HASH));
    }

    #[test]
    fn completed_means_everyone_was_paid() {
        let mut r = run(3);
        r.start().unwrap();
        r.record_result(HASH).unwrap();
        r.record_settlement(100).unwrap();

        assert_eq!(
            code(r.complete()),
            expected(GenoVaultError::RunSettlementIncomplete),
            "інакше «завершено» означало б лише «MPC відповів»"
        );
    }

    #[test]
    fn settlement_needs_a_result_first() {
        let mut r = run(1);
        r.start().unwrap();
        assert_eq!(
            code(r.record_settlement(10)),
            expected(GenoVaultError::RunResultMissing)
        );
    }

    #[test]
    fn payouts_never_exceed_the_escrow() {
        let mut r = run(2);
        r.start().unwrap();
        r.record_result(HASH).unwrap();
        r.record_settlement(1_000).unwrap();

        assert_eq!(
            code(r.record_settlement(1)),
            expected(GenoVaultError::RunSettlementExceedsEscrow),
            "жодна порція не має права вийти за заблоковане"
        );
    }

    #[test]
    fn no_extra_settlement_beyond_the_dataset_count() {
        let mut r = run(1);
        r.start().unwrap();
        r.record_result(HASH).unwrap();
        r.record_settlement(10).unwrap();

        assert_eq!(
            code(r.record_settlement(10)),
            expected(GenoVaultError::RunAlreadySettled)
        );
    }

    #[test]
    fn the_result_is_written_once() {
        let mut r = run(1);
        r.start().unwrap();
        r.record_result(HASH).unwrap();
        assert_eq!(
            code(r.record_result([9u8; 32])),
            expected(GenoVaultError::RunResultAlreadyRecorded),
            "покупець уже бачить перший відбиток як свій результат"
        );
    }

    #[test]
    fn rejection_belongs_before_the_computation_starts() {
        let mut accepted = run(1);
        accepted.reject().unwrap();
        assert_eq!(accepted.status, RunStatus::Rejected);

        let mut running = run(1);
        running.start().unwrap();
        assert_eq!(
            code(running.reject()),
            expected(GenoVaultError::RunNotAccepted),
            "після публікації в MPC невдача — це fail, а не reject"
        );
    }

    #[test]
    fn failure_is_allowed_on_both_sides_of_the_dispatch() {
        let mut before = run(1);
        before.fail().unwrap();
        assert_eq!(before.status, RunStatus::Failed);

        let mut after = run(1);
        after.start().unwrap();
        after.fail().unwrap();
        assert_eq!(after.status, RunStatus::Failed);
    }

    #[test]
    fn terminal_states_do_not_move() {
        for terminal in [RunStatus::Completed, RunStatus::Rejected, RunStatus::Failed] {
            let mut r = run(1);
            r.status = terminal;
            assert_eq!(code(r.fail()), expected(GenoVaultError::RunIsFinal));
            assert_eq!(code(r.start()), expected(GenoVaultError::RunNotAccepted));
            assert_eq!(
                code(r.record_result(HASH)),
                expected(GenoVaultError::RunNotRunning)
            );
        }
    }

    #[test]
    fn a_duplicate_dataset_is_refused() {
        let dataset = Pubkey::new_unique();
        let other = Pubkey::new_unique();

        assert!(Run::validate_datasets(&[dataset, other]).is_ok());
        assert_eq!(
            code(Run::validate_datasets(&[dataset, other, dataset])),
            expected(GenoVaultError::RunDuplicateDataset),
            "той самий датасет двічі заплатив би власнику двічі за один вміст"
        );
    }

    #[test]
    fn the_pool_has_both_bounds() {
        assert_eq!(
            code(Run::validate_datasets(&[])),
            expected(GenoVaultError::RunWithoutDatasets)
        );

        let too_many: Vec<Pubkey> = (0..=MAX_RUN_DATASETS).map(|_| Pubkey::new_unique()).collect();
        assert_eq!(
            code(Run::validate_datasets(&too_many)),
            expected(GenoVaultError::RunTooManyDatasets)
        );
        assert!(Run::validate_datasets(&too_many[..MAX_RUN_DATASETS]).is_ok());
    }
}
