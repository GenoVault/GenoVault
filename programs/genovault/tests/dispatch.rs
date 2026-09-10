//! Публікація обчислення в Arcium — те, що перевіряється без Arcium (`T025`).
//!
//! Стенд виконує зібраний `.so`, але програми Arcium в ньому немає, тож
//! `dispatch_init`/`dispatch_fold`/`dispatch_close_dataset` тут не проганяються:
//! вони закінчуються CPI в чергу обчислень. Перевіряти їх на моку черги
//! означало б перевіряти мок.
//!
//! Тут — усе, що до черги: хто має право подавати байти, куди вони лягають, що
//! буфер належить своєму прогону і що rent повертається. Логіка callback'ів
//! живе юніт-тестами в `instructions/dispatch.rs`, бо це чисті функції над
//! станом; сам ланцюг «черга → вузли → callback» замикається на локальному
//! кластері, а не на стенді.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use genovault::state::{
    Run, RunAccumulator, RunDataset, RunStatus, BATCH_BUFFER_BYTES, BATCH_BUFFER_HEADER_BYTES,
    BATCH_BUFFER_INITIAL_BYTES, BATCH_PAYLOAD_BYTES, MAX_PERMITTED_DATA_INCREASE,
    RECIPE_PARAMS_LEN,
};
use genovault::GenoVaultError;
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use solana_account::Account;

mod harness;
use harness::*;

const NONCE: u64 = 42;

struct Fixture {
    mollusk: Mollusk,
    dispatcher: Pubkey,
    run: Pubkey,
    accumulator: Pubkey,
    buffer: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

fn run_state(buyer: Pubkey, dispatcher: Pubkey, datasets: usize, status: RunStatus) -> Run {
    Run {
        buyer,
        dispatcher,
        nonce: NONCE,
        recipe_id: 1,
        recipe_params: [0u8; RECIPE_PARAMS_LEN],
        use_type: 1,
        buyer_category: 1,
        buyer_x25519: [4u8; 32],
        datasets: (0..datasets)
            .map(|_| RunDataset {
                dataset: Pubkey::new_unique(),
                price_per_1k: 1_000,
                records_included: 0,
                below_floor: false,
                settled: false,
            })
            .collect(),
        fee_bps: 700,
        escrow_amount: 1_000,
        settled_count: 0,
        settled_amount: 0,
        refunded: false,
        status,
        result_hash: None,
        records_included: 0,
        suppressed: false,
        dataset_cursor: 0,
        folded_batches: 0,
        folded_hash: [0u8; 32],
        created_at: 0,
        bump: 0,
    }
}

impl Fixture {
    fn new(status: RunStatus) -> Self {
        Self::with_cursor(status, 0)
    }

    /// Прогін із курсором на заданому датасеті: так виглядає пул, у якому
    /// частину датасетів уже закрито.
    fn with_cursor(status: RunStatus, cursor: u32) -> Self {
        let buyer = Pubkey::new_unique();
        let dispatcher = Pubkey::new_unique();
        let run = run_pda(&buyer, NONCE);
        let (_, bump) = Pubkey::find_program_address(
            &[Run::SEED, buyer.as_ref(), &NONCE.to_le_bytes()],
            &genovault::ID,
        );

        let mut state = run_state(buyer, dispatcher, 2, status);
        state.bump = bump;
        state.dataset_cursor = cursor;

        let (accumulator, _) = accumulator_pda(&run);
        let (buffer, _) = batch_buffer_pda(&run);

        Self {
            mollusk: mollusk(),
            dispatcher,
            run,
            accumulator,
            buffer,
            accounts: vec![
                (dispatcher, funded_wallet()),
                (run, stored(&state, 5 * LAMPORTS_PER_SOL)),
                empty(accumulator),
                empty(buffer),
                system_program(),
            ],
        }
    }

    fn open_ix(&self, dispatcher: Pubkey) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::OpenRun {
                dispatcher,
                run: self.run,
                accumulator: self.accumulator,
                buffer: self.buffer,
                system_program: system_program_id(),
            }
            .to_account_metas(None),
            data: genovault::instruction::OpenRun {}.data(),
        }
    }

    fn grow_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::GrowBatchBuffer {
                dispatcher: self.dispatcher,
                run: self.run,
                buffer: self.buffer,
                system_program: system_program_id(),
            }
            .to_account_metas(None),
            data: genovault::instruction::GrowBatchBuffer {}.data(),
        }
    }

    fn write_ix(&self, offset: u32, bytes: Vec<u8>) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::WriteBatch {
                dispatcher: self.dispatcher,
                run: self.run,
                accumulator: self.accumulator,
                buffer: self.buffer,
            }
            .to_account_metas(None),
            data: genovault::instruction::WriteBatch { offset, bytes }.data(),
        }
    }

    fn close_ix(&self) -> Instruction {
        Instruction {
            program_id: genovault::ID,
            accounts: genovault::accounts::CloseBatchBuffer {
                dispatcher: self.dispatcher,
                run: self.run,
                buffer: self.buffer,
            }
            .to_account_metas(None),
            data: genovault::instruction::CloseBatchBuffer {}.data(),
        }
    }

    fn run_ix(&mut self, instruction: &Instruction) -> InstructionResult {
        let result = self
            .mollusk
            .process_instruction(instruction, &self.accounts);
        if is_success(&result) {
            self.accounts = result.resulting_accounts.clone();
        }
        result
    }

    /// Відкриває прогін і доводить буфер до повного розміру — стан, у якому
    /// живе будь-яка згортка.
    ///
    /// Відкриття завжди йде зі статусу `accepted` (інакше `open_run` відмовить
    /// — і правильно зробить), а вже потім прогін переводиться в той стан, який
    /// потрібен тесту: у житті це зробив би `dispatch_init`, а він тут не
    /// проганяється, бо закінчується CPI в чергу обчислень.
    fn ready(status: RunStatus) -> Self {
        let mut fixture = Self::new(RunStatus::Accepted);
        let open = fixture.open_ix(fixture.dispatcher);
        assert!(is_success(&fixture.run_ix(&open)));
        while fixture.buffer_len() < BATCH_BUFFER_BYTES {
            let grow = fixture.grow_ix();
            assert!(is_success(&fixture.run_ix(&grow)));
        }
        fixture.edit_run(|run| run.status = status);
        fixture
    }

    fn replace(&mut self, key: Pubkey, account: Account) {
        for entry in self.accounts.iter_mut() {
            if entry.0 == key {
                entry.1 = account;
                return;
            }
        }
        panic!("акаунт має бути у стенді");
    }

    /// Правка стану, який у житті змінила б інша інструкція.
    fn edit_run(&mut self, edit: impl FnOnce(&mut Run)) {
        let key = self.run;
        let mut state: Run = read(&self.accounts, &key);
        edit(&mut state);
        let lamports = self.account(&key).lamports;
        self.replace(key, stored(&state, lamports));
    }

    fn account(&self, key: &Pubkey) -> &Account {
        &self
            .accounts
            .iter()
            .find(|(candidate, _)| candidate == key)
            .expect("акаунт має бути серед результатів")
            .1
    }

    fn buffer_len(&self) -> usize {
        self.account(&self.buffer).data.len()
    }
}

#[test]
fn opening_a_run_creates_the_accumulator_and_the_buffer() {
    let mut fixture = Fixture::new(RunStatus::Accepted);
    let open = fixture.open_ix(fixture.dispatcher);
    assert!(is_success(&fixture.run_ix(&open)));

    let accumulator: RunAccumulator = read(&fixture.accounts, &fixture.accumulator);
    assert_eq!(accumulator.run, fixture.run);
    assert!(!accumulator.ready, "накопичувач створює MPC, а не ми");
    assert!(accumulator.pending.is_none());

    // Буфер створюється рівно на межу приросту за одну інструкцію: більший
    // акаунт через CPI не створюється взагалі.
    let buffer = fixture.account(&fixture.buffer);
    assert_eq!(buffer.data.len(), BATCH_BUFFER_INITIAL_BYTES);
    assert_eq!(&buffer.data[..8], b"GVBATCH1");
    assert_eq!(&buffer.data[8..40], fixture.run.as_ref());
}

#[test]
fn only_the_dispatcher_the_buyer_named_may_open_a_run() {
    // Диспетчера називає покупець при замовленні. Якби відкрити прогін міг
    // будь-хто, повноваження брала б собі платформа — а це інше повноваження.
    let mut fixture = Fixture::new(RunStatus::Accepted);
    let stranger = Pubkey::new_unique();
    fixture.accounts.push((stranger, funded_wallet()));

    let open = fixture.open_ix(stranger);
    let result = fixture.run_ix(&open);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunNotDispatcher))
    );
}

#[test]
fn a_run_that_already_started_is_not_opened_twice() {
    // Другий накопичувач затер би стан першого — разом із усім, що вже згорнуто.
    let mut fixture = Fixture::new(RunStatus::Running);
    let open = fixture.open_ix(fixture.dispatcher);
    let result = fixture.run_ix(&open);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunNotAccepted))
    );
}

#[test]
fn the_buffer_grows_to_exactly_one_batch() {
    let mut fixture = Fixture::new(RunStatus::Accepted);
    let open = fixture.open_ix(fixture.dispatcher);
    assert!(is_success(&fixture.run_ix(&open)));

    let mut steps = 0;
    while fixture.buffer_len() < BATCH_BUFFER_BYTES {
        let before = fixture.buffer_len();
        let grow = fixture.grow_ix();
        assert!(is_success(&fixture.run_ix(&grow)));
        assert!(
            fixture.buffer_len() - before <= MAX_PERMITTED_DATA_INCREASE,
            "приріст за одну інструкцію обмежений рантаймом"
        );
        steps += 1;
        assert!(steps <= 10, "дорощування не сходиться");
    }

    assert_eq!(fixture.buffer_len(), BATCH_BUFFER_BYTES);
    assert_eq!(steps, 6);

    // Сьоме дорощування — це або помилка в клієнті, або спроба зробити акаунт
    // більшим за контур.
    let grow = fixture.grow_ix();
    let result = fixture.run_ix(&grow);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BatchBufferNotGrowing))
    );
}

#[test]
fn a_batch_lands_where_the_computation_queue_will_read_it() {
    let mut fixture = Fixture::ready(RunStatus::Running);

    let head = vec![0xAB; 64];
    let tail = vec![0xCD; 32];
    let tail_offset = (BATCH_PAYLOAD_BYTES - tail.len()) as u32;

    let write = fixture.write_ix(0, head.clone());
    assert!(is_success(&fixture.run_ix(&write)));
    let write = fixture.write_ix(tail_offset, tail.clone());
    assert!(is_success(&fixture.run_ix(&write)));

    // Зсув в аргументі обчислення відлічується від початку payload, а не від
    // початку акаунта: заголовок черга не бачить.
    let data = &fixture.account(&fixture.buffer).data;
    assert_eq!(&data[BATCH_BUFFER_HEADER_BYTES..BATCH_BUFFER_HEADER_BYTES + 64], &head[..]);
    let at = BATCH_BUFFER_HEADER_BYTES + tail_offset as usize;
    assert_eq!(&data[at..at + tail.len()], &tail[..]);
    assert_eq!(&data[..8], b"GVBATCH1", "заголовок не затирається записом");
}

#[test]
fn a_write_past_the_batch_is_refused_not_truncated() {
    // Обрізаний запис поїхав би в MPC наполовину нульовим, і рецепт порахував
    // би добиті нулі як людей.
    let mut fixture = Fixture::ready(RunStatus::Running);

    let write = fixture.write_ix((BATCH_PAYLOAD_BYTES - 4) as u32, vec![1u8; 8]);
    let result = fixture.run_ix(&write);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BatchWriteOutOfBounds))
    );

    let write = fixture.write_ix(u32::MAX, vec![1u8; 8]);
    let result = fixture.run_ix(&write);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BatchWriteOutOfBounds))
    );
}

#[test]
fn nothing_is_written_into_a_buffer_that_has_not_grown() {
    // Акаунт створено на 10 КіБ; запис у хвіст мовчки нікуди б не потрапив.
    let mut fixture = Fixture::new(RunStatus::Accepted);
    let open = fixture.open_ix(fixture.dispatcher);
    assert!(is_success(&fixture.run_ix(&open)));

    let write = fixture.write_ix(0, vec![1u8; 32]);
    let result = fixture.run_ix(&write);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BatchBufferTooSmall))
    );
}

#[test]
fn the_batch_is_not_rewritten_while_a_computation_is_in_flight() {
    // Вузли читають буфер тоді, коли виконують згортку, тобто після нашої
    // транзакції: запис під час польоту підмінив би саме ті байти, за які вже
    // поручився ланцюжок відбитків у `Run`.
    let mut fixture = Fixture::ready(RunStatus::Running);

    let mut accumulator: RunAccumulator = read(&fixture.accounts, &fixture.accumulator);
    accumulator.ready = true;
    accumulator.pending = Some(Pubkey::new_unique());
    let lamports = fixture.account(&fixture.accumulator).lamports;
    let key = fixture.accumulator;
    fixture.replace(key, stored(&accumulator, lamports));

    let write = fixture.write_ix(0, vec![1u8; 32]);
    let result = fixture.run_ix(&write);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::AccumulatorBusy))
    );
}

#[test]
fn the_buffer_is_not_closed_while_the_pool_still_has_datasets() {
    // Закритий буфер посеред прогону — це згортка, яка поїде в MPC із нулями.
    let mut fixture = Fixture::ready(RunStatus::Running);

    let close = fixture.close_ix();
    let result = fixture.run_ix(&close);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::RunPoolNotExhausted))
    );
}

#[test]
fn closing_the_buffer_returns_the_rent_to_the_dispatcher() {
    // ~0,49 SOL лежать мертвим вантажем увесь прогін; повертаються тому, хто їх
    // вніс, а не покупцю — вносив їх диспетчер.
    let mut fixture = Fixture::ready(RunStatus::Running);

    fixture.edit_run(|run| run.dataset_cursor = run.datasets.len() as u32);

    let rent = fixture.account(&fixture.buffer).lamports;
    let before = fixture.account(&fixture.dispatcher).lamports;
    assert!(rent > 0);

    let close = fixture.close_ix();
    assert!(is_success(&fixture.run_ix(&close)));

    assert_eq!(fixture.account(&fixture.buffer).lamports, 0);
    assert_eq!(fixture.account(&fixture.buffer).data.len(), 0);
    assert_eq!(fixture.account(&fixture.dispatcher).lamports, before + rent);
}

#[test]
fn a_buffer_of_a_neighbouring_run_is_refused() {
    // Seeds ловлять чужу адресу, мітка — свою адресу з чужим вмістом: акаунт,
    // створений під один прогін і підсунутий іншому, має правильні seeds лише
    // для свого.
    let mut fixture = Fixture::ready(RunStatus::Running);

    let foreign = Pubkey::new_unique();
    let mut data = fixture.account(&fixture.buffer).data.clone();
    data[8..40].copy_from_slice(foreign.as_ref());
    let lamports = fixture.account(&fixture.buffer).lamports;
    let key = fixture.buffer;
    fixture.replace(
        key,
        Account {
            lamports,
            data,
            owner: genovault::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let write = fixture.write_ix(0, vec![1u8; 32]);
    let result = fixture.run_ix(&write);
    assert_eq!(
        custom_error_code(&result),
        Some(expected(GenoVaultError::BatchBufferForeignRun))
    );
}
