use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;

/// Дзеркала констант рецепта з `encrypted-ixs/src/lib.rs`.
///
/// Контур має сталий розмір, зафіксований при компіляції, і програма мусить
/// знати цей розмір, щоб порахувати буфер і перевірити `live`. Дублювання тут
/// свідоме — як `packages/shared/src/consent.ts` дублює `state/consent.rs`, — і
/// його стереже тест `mirrors_the_recipe_shape`: розійтись цим числам означало
/// б поставити в чергу обчислення, яке не складеться, і дізнатись про це від
/// вузлів, а не від збірки.
pub const RECIPE_MARKERS: usize = 64;
pub const RECIPE_BATCH: usize = 32;

/// Значення фільтра «будь-яке» (`FILTER_ANY` у рецепті).
pub const FILTER_ANY: u8 = 2;

/// Скільки 32-байтових слів займає один запис у черзі обчислень.
///
/// Не здогад, а вимір: `build/frequencies_fold.idarc` розкладає параметр
/// `[Enc<Shared, Record>; BATCH]` на послідовність
/// `arcis_x25519_pubkey · u128 · ciphertext × 67` на кожен запис, тобто
/// `1 + 1 + (3 + MARKERS)` слів. Черга читає акаунт словами по 32 байти
/// (`AccountLenNotMultipleOf32` — окрема помилка Arcium), тому нонс `u128`
/// займає повне слово, а не свої 16 байтів.
pub const RECORD_WORDS: usize = 2 + 3 + RECIPE_MARKERS;
pub const WORD_BYTES: usize = 32;

/// Скільки байтів займає батч у буферному акаунті: 32 × 69 × 32 = 70 656.
pub const BATCH_PAYLOAD_BYTES: usize = RECIPE_BATCH * RECORD_WORDS * WORD_BYTES;

/// Скільки шифротекстів везе накопичувач.
///
/// `Pack<Frequencies>` пакує 140 польових елементів (`included`,
/// `dataset_included`, `male`, `affected`, 8 вікових порогів і по 64 суми
/// на маркер) по шість у шифротекст — звідси 24. Число теж із `.idarc`, а не
/// з арифметики на полях: пакування — властивість компілятора, і рахувати його
/// вручну означало б повторювати чужу реалізацію.
pub const ACCUMULATOR_CIPHERTEXTS: usize = 24;

/// Накопичувач частот між згортками (`T025`).
///
/// Seeds: `["acc", run]`.
///
/// # Чому окремий акаунт, а не поле в `Run`
///
/// `Run` читає незалежний звіряч журналу (`FR-025`), і 784 байти непрозорого
/// шифротексту в ньому не доводять йому нічого — зате коштують rent кожному
/// прогону, включно з тими, що впали одразу після замовлення. Окремий акаунт
/// живе рівно від публікації обчислення до розкриття, а на закритті rent
/// повертається тому, хто його вніс.
///
/// # Чому не аргументом від клієнта
///
/// Підмінити накопичувач неможливо — він під ключем MXE, — але **повторити**
/// старий можна: згорнути той самий батч двічі або підсунути накопичувач
/// іншого прогону. Черга обчислень цього не забороняє, а результат виглядав би
/// цілком валідним. Ланцюг мусить пам'ятати, який накопичувач чинний, інакше
/// «скільки записів увійшло» перестає бути фактом.
#[account]
#[derive(InitSpace)]
pub struct RunAccumulator {
    pub run: Pubkey,
    /// Нонс шифру, що лежить у `ciphertexts`. Свіжий на кожну згортку: Rescue
    /// працює в режимі CTR, і повторений нонс за того самого ключа MXE дав би
    /// повторену гаму.
    pub nonce: u128,
    pub ciphertexts: [[u8; 32]; ACCUMULATOR_CIPHERTEXTS],
    /// Чи вже повернувся `frequencies_init`. До того згортати нема в що.
    pub ready: bool,
    /// Акаунт обчислення, яке зараз у польоті.
    ///
    /// Адреса, а не зсув: callback приходить окремою транзакцією і зсуву в
    /// аргументах не має — зате має сам акаунт обчислення, тож звірити є з чим.
    ///
    /// Без цього поля дві згортки могли б піти в чергу одночасно, прочитати той
    /// самий накопичувач і повернутись по черзі — друга мовчки затерла б першу,
    /// і батч зник би з когорти, не зникнувши з рахунку покупця.
    pub pending: Option<Pubkey>,
    pub bump: u8,
}

impl RunAccumulator {
    pub const SEED: &'static [u8] = b"acc";

    /// Ставить обчислення в політ. Другого одночасно бути не може.
    pub fn arm(&mut self, computation: Pubkey) -> Result<()> {
        require!(self.pending.is_none(), GenoVaultError::AccumulatorBusy);
        self.pending = Some(computation);
        Ok(())
    }

    /// Приймає накопичувач із callback'а.
    ///
    /// Акаунт обчислення звіряється навмисно: callback приходить окремою
    /// транзакцією, і без звірки результат скасованого обчислення міг би сісти
    /// поверх свіжого.
    pub fn store(
        &mut self,
        computation: Pubkey,
        nonce: u128,
        ciphertexts: [[u8; 32]; ACCUMULATOR_CIPHERTEXTS],
    ) -> Result<()> {
        self.release(computation)?;
        self.nonce = nonce;
        self.ciphertexts = ciphertexts;
        self.ready = true;
        Ok(())
    }

    /// Знімає політ, не чіпаючи вмісту: обчислення повернулось невдачею.
    pub fn release(&mut self, computation: Pubkey) -> Result<()> {
        require!(
            self.pending == Some(computation),
            GenoVaultError::AccumulatorOffsetMismatch
        );
        self.pending = None;
        Ok(())
    }

    pub fn require_ready(&self) -> Result<()> {
        require!(self.ready, GenoVaultError::AccumulatorNotReady);
        Ok(())
    }

    pub fn require_empty(&self) -> Result<()> {
        require!(!self.ready, GenoVaultError::AccumulatorAlreadyReady);
        Ok(())
    }
}

// ── Буферний акаунт під батч ────────────────────────────────────────────────

/// Мітка буферного акаунта. Своя, а не дискримінатор Anchor: акаунт не
/// серіалізується як структура — у ньому лежить заголовок і сирий зріз, який
/// вузли Arcium читають напряму.
pub const BATCH_BUFFER_MAGIC: [u8; 8] = *b"GVBATCH1";

/// Заголовок буфера: мітка, прогін, bump і вирівнювання до 64.
///
/// Payload починається на круглому зсуві не заради вирівнювання (черга його не
/// вимагає), а щоб `offset` в аргументі обчислення читався оком у транзакції.
pub const BATCH_BUFFER_HEADER_BYTES: usize = 64;
pub const BATCH_BUFFER_BYTES: usize = BATCH_BUFFER_HEADER_BYTES + BATCH_PAYLOAD_BYTES;

/// Скільки байтів акаунта створюється одразу.
///
/// Рівно межа, на яку програма може збільшити акаунт за одну інструкцію
/// (`MAX_PERMITTED_DATA_INCREASE`). Акаунт на 70 720 байтів через CPI не
/// створюється взагалі — ні `init` Anchor, ні прямим `create_account`, — тому
/// буфер створюється на 10 КіБ і доростає окремими інструкціями.
pub const BATCH_BUFFER_INITIAL_BYTES: usize = 10 * 1024;
pub const MAX_PERMITTED_DATA_INCREASE: usize = 10 * 1024;

pub const BATCH_BUFFER_SEED: &[u8] = b"batch";

const OFFSET_RUN: usize = 8;
const OFFSET_BUMP: usize = OFFSET_RUN + 32;

/// Записує заголовок у щойно створений буфер.
pub fn write_batch_buffer_header(data: &mut [u8], run: &Pubkey, bump: u8) {
    data[..8].copy_from_slice(&BATCH_BUFFER_MAGIC);
    data[OFFSET_RUN..OFFSET_RUN + 32].copy_from_slice(run.as_ref());
    data[OFFSET_BUMP] = bump;
}

/// Перевіряє, що байти — буфер саме цього прогону.
///
/// Seeds перевіряє Anchor, а мітка ловить інше: акаунт, створений на 10 КіБ і
/// ще не заповнений заголовком, має правильну адресу й нульовий вміст.
pub fn check_batch_buffer_header(data: &[u8], run: &Pubkey) -> Result<()> {
    require!(
        data.len() >= BATCH_BUFFER_HEADER_BYTES,
        GenoVaultError::BatchBufferMalformed
    );
    require!(
        data[..8] == BATCH_BUFFER_MAGIC,
        GenoVaultError::BatchBufferMalformed
    );
    require!(
        data[OFFSET_RUN..OFFSET_RUN + 32] == run.to_bytes(),
        GenoVaultError::BatchBufferForeignRun
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    fn code(result: Result<()>) -> u32 {
        match result.expect_err("очікувалась відмова") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        }
    }

    /// Числа взяті з `build/frequencies_fold.idarc`, і саме вони мають зійтися:
    /// контур із 2238 параметрів приймає 2208 із них одним зрізом акаунта.
    #[test]
    fn mirrors_the_recipe_shape() {
        assert_eq!(RECORD_WORDS, 69);
        assert_eq!(BATCH_PAYLOAD_BYTES, 70_656);
        assert_eq!(RECIPE_BATCH * RECORD_WORDS, 2_208);
        // Черга обчислень відхиляє зріз, не кратний 32 байтам, окремою
        // помилкою — і зробила б це вже на вузлах, а не при збірці.
        assert_eq!(BATCH_PAYLOAD_BYTES % WORD_BYTES, 0);
    }

    #[test]
    fn the_buffer_grows_within_the_runtime_limit() {
        // Кожен крок дорощування мусить укладатись у межу однієї інструкції,
        // інакше вона впаде вже в мережі — і виглядатиме як помилка Anchor.
        let mut len = BATCH_BUFFER_INITIAL_BYTES;
        let mut steps = 0;
        while len < BATCH_BUFFER_BYTES {
            let next = (len + MAX_PERMITTED_DATA_INCREASE).min(BATCH_BUFFER_BYTES);
            assert!(next - len <= MAX_PERMITTED_DATA_INCREASE);
            len = next;
            steps += 1;
        }
        assert_eq!(len, BATCH_BUFFER_BYTES);
        assert_eq!(steps, 6, "шість дорощувань на буфер — це в скрипті прогону");
        assert!(BATCH_BUFFER_INITIAL_BYTES <= MAX_PERMITTED_DATA_INCREASE);
    }

    #[test]
    fn the_header_names_its_run() {
        let run = Pubkey::new_unique();
        let mut data = vec![0u8; BATCH_BUFFER_BYTES];
        write_batch_buffer_header(&mut data, &run, 254);

        check_batch_buffer_header(&data, &run).unwrap();
        assert_eq!(
            code(check_batch_buffer_header(&data, &Pubkey::new_unique())),
            expected(GenoVaultError::BatchBufferForeignRun),
            "буфер сусіднього прогону — це чужий батч під нашою адресою"
        );
    }

    #[test]
    fn an_unfilled_buffer_is_not_a_buffer() {
        // Акаунт створено, заголовок ще не написано: адреса правильна, вміст
        // нульовий. Без мітки це виглядало б як порожній батч.
        let run = Pubkey::new_unique();
        let data = vec![0u8; BATCH_BUFFER_BYTES];
        assert_eq!(
            code(check_batch_buffer_header(&data, &run)),
            expected(GenoVaultError::BatchBufferMalformed)
        );

        let short = vec![0u8; 8];
        assert_eq!(
            code(check_batch_buffer_header(&short, &run)),
            expected(GenoVaultError::BatchBufferMalformed)
        );
    }

    #[test]
    fn only_one_computation_is_in_flight() {
        let mut acc = RunAccumulator {
            run: Pubkey::new_unique(),
            nonce: 0,
            ciphertexts: [[0u8; 32]; ACCUMULATOR_CIPHERTEXTS],
            ready: false,
            pending: None,
            bump: 255,
        };

        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();

        acc.arm(first).unwrap();
        assert_eq!(
            code(acc.arm(second)),
            expected(GenoVaultError::AccumulatorBusy),
            "дві згортки одного накопичувача — це втрачений батч"
        );

        // Callback скасованого обчислення не має права сісти поверх свіжого.
        assert_eq!(
            code(acc.store(second, 1, [[1u8; 32]; ACCUMULATOR_CIPHERTEXTS])),
            expected(GenoVaultError::AccumulatorOffsetMismatch)
        );

        acc.store(first, 42, [[1u8; 32]; ACCUMULATOR_CIPHERTEXTS])
            .unwrap();
        assert!(acc.ready);
        assert_eq!(acc.nonce, 42);
        assert!(acc.pending.is_none());
    }

    #[test]
    fn a_failed_computation_frees_the_accumulator_without_touching_it() {
        let mut acc = RunAccumulator {
            run: Pubkey::new_unique(),
            nonce: 9,
            ciphertexts: [[3u8; 32]; ACCUMULATOR_CIPHERTEXTS],
            ready: true,
            pending: None,
            bump: 255,
        };

        let computation = Pubkey::new_unique();
        acc.arm(computation).unwrap();
        acc.release(computation).unwrap();

        assert_eq!(acc.nonce, 9, "невдала згортка не міняє накопичувача");
        assert!(acc.ready);
        assert!(acc.pending.is_none());
    }
}
