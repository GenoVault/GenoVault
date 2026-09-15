use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::errors::GenoVaultError;
use crate::state::{FILTER_ANY, RECIPE_BATCH};

/// Скільки датасетів може бути в одному прогоні.
///
/// Число не з голови: `SC-007` міряє розподіл між 50 власниками, тож менша
/// межа зробила б критерій недосяжним без правки структури, а більша — платила
/// б rent за місце, якого ніхто не обіцяв.
pub const MAX_RUN_DATASETS: usize = 50;

/// Скільки байтів відведено під параметри рецепта в `Run`.
///
/// Рецепт «частоти» використовує чотири: `min_age`, `max_age`, `sex_filter`,
/// `affected_filter`. Решта зарезервована під рецепти `T044`-`T045`, і саме
/// тому вона перевіряється на нулі: байт, який сьогодні нічого не означає, а
/// завтра означатиме, не має права приїхати заповненим від клієнта вже
/// сьогодні.
pub const RECIPE_PARAMS_LEN: usize = 32;

/// Параметри рецепта «частоти й розподіли» у розкладці `Run::recipe_params`.
///
/// Порядок дублює сигнатуру `frequencies_fold` у `encrypted-ixs`: публікація
/// віддає ці чотири числа в чергу обчислень плоскими `u8`, і зсув на одиницю
/// поміняв би фільтр статі на фільтр ураженості, нічого не зламавши.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FrequenciesParams {
    pub min_age: u8,
    pub max_age: u8,
    /// 0 — жіноча, 1 — чоловіча, `FILTER_ANY` — будь-яка.
    pub sex_filter: u8,
    /// 0 — неуражені, 1 — уражені, `FILTER_ANY` — будь-хто.
    pub affected_filter: u8,
}

impl FrequenciesParams {
    /// Читає параметри й відхиляє те, чого рецепт не зрозуміє.
    ///
    /// Перевіряється тут, при замовленні, а не при публікації: `min_age > max_age`
    /// дає когорту з нуля записів, і покупець дізнався б про свою помилку вже
    /// після того, як заплатив за прогін. Значення фільтра поза словником
    /// гірше — рецепт порівнює на рівність, тож `sex_filter = 7` тихо
    /// відкинув би всіх, і це виглядало б як порожній датасет.
    pub fn decode(raw: &[u8; RECIPE_PARAMS_LEN]) -> Result<Self> {
        let params = Self {
            min_age: raw[0],
            max_age: raw[1],
            sex_filter: raw[2],
            affected_filter: raw[3],
        };
        require!(
            params.min_age <= params.max_age,
            GenoVaultError::RecipeParamsInvalid
        );
        require!(
            params.sex_filter <= FILTER_ANY,
            GenoVaultError::RecipeParamsInvalid
        );
        require!(
            params.affected_filter <= FILTER_ANY,
            GenoVaultError::RecipeParamsInvalid
        );
        require!(
            raw[4..].iter().all(|byte| *byte == 0),
            GenoVaultError::RecipeParamsInvalid
        );
        Ok(params)
    }

    pub fn encode(self) -> [u8; RECIPE_PARAMS_LEN] {
        let mut raw = [0u8; RECIPE_PARAMS_LEN];
        raw[0] = self.min_age;
        raw[1] = self.max_age;
        raw[2] = self.sex_filter;
        raw[3] = self.affected_filter;
        raw
    }
}

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

/// Один датасет у складі прогону (`T026`).
///
/// # Чому не просто адреса
///
/// Нарахування рахується з трьох чисел, і жодне з них не можна брати «зараз»:
///
/// - **ціна** мусить бути тією, що діяла при замовленні. Власник вільний
///   підняти `price_per_1k` наступного дня, і депозит, порахований учора, не
///   зобов'язаний його витримати. Копія тут — те саме рішення, що й копія
///   `fee_bps` у `Run`.
/// - **внесок** оголошується всередині MPC (`FR-018a`) і приходить callback'ом
///   закриття датасету. Подією його не втримати: подія — свідчення, а платити
///   треба з того, що лежить в акаунті.
/// - **прапорець нарахування** окремо від `settled_count`: лічильник не
///   заважає нарахувати одному й тому самому датасету двічі, а порційність
///   виплат саме й означає, що порядок викликів обирає не програма.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct RunDataset {
    pub dataset: Pubkey,
    /// Ціна за 1000 записів на момент замовлення (`FR-015`).
    pub price_per_1k: u64,
    /// Скільки записів дав цей датасет — оголошено всередині MPC.
    /// Нуль, поки датасет не закрито, і нуль назавжди, якщо внесок не дотягнув
    /// до порога.
    pub records_included: u32,
    /// Внесок був меншим за `MIN_CONTRIBUTION` і тому оголошений нулем.
    ///
    /// Окремо від нульового внеску, бо для власника, який дивиться на екран
    /// нарахувань (`FR-018b`), «не дав жодного запису під фільтр» і «дав, але
    /// замало, щоб про це говорити» — різні речі. Для гаманця однакові.
    pub below_floor: bool,
    /// Нарахування вже зроблено.
    pub settled: bool,
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
    /// Хто має право подавати шифротекст і ставити обчислення в чергу
    /// (`T025`). Називає його **покупець** при замовленні: 2500 підписів на
    /// прогін у вкладці браузера — не продукт, а повноваження, взяте
    /// платформою собі, — не те, що покупець комусь давав. Диспетчер не
    /// рухає грошей, не міняє згоди й не змінює складу прогону: усе, що він
    /// може, — довести цей прогін до кінця або не довести.
    pub dispatcher: Pubkey,
    /// Обраний покупцем; він же в seeds, тож два прогони не сплутати.
    pub nonce: u64,
    pub recipe_id: u16,
    /// Параметри рецепта, заявлені при замовленні: для «частот» це вікові межі
    /// й фільтри статі та ураженості.
    ///
    /// Лежать тут, а не в аргументах публікації, бо запит покупця — частина
    /// умов прогону. Власник звіряє їх зі своєю згодою (`FR-006`), незалежний
    /// звіряч журналу — з тим, що пішло в MPC (`FR-025`), і ні перше, ні друге
    /// неможливе, якщо диспетчер може підставити інший фільтр після
    /// замовлення.
    pub recipe_params: [u8; RECIPE_PARAMS_LEN],
    /// Тип використання і категорія покупця, заявлені при замовленні: саме
    /// вони перевірялись проти згоди кожного датасету.
    pub use_type: u32,
    pub buyer_category: u32,
    /// Ключ шифрування покупця, на який MPC зашифрує звіт (`T026`).
    ///
    /// Приходить із замовленням, від самого покупця, і саме тому виняток про
    /// диспетчера лишається безпечним: якби ключ називала публікація, диспетчер
    /// підставив би свій і прочитав звіт, за який заплатив хтось інший.
    /// Перевірити його програма не може ніяк — тому він і мусить приїхати від
    /// того єдиного, хто не має причин себе обманути.
    pub buyer_x25519: [u8; 32],
    #[max_len(MAX_RUN_DATASETS)]
    pub datasets: Vec<RunDataset>,
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
    /// Різницю депозиту вже повернуто покупцю.
    ///
    /// Окреме поле, а не статус: `failed` лишається `failed` і після виплати —
    /// статус тут нічого не стереже, і другий виклик повернення виніс би із
    /// сейфа депозит чужого прогону. Прапорець ставлять обидва шляхи, якими
    /// гроші йдуть назад покупцю, — `finalize_run` і `refund_failed_run`, —
    /// щоб «покупцю віддано» читалось однаково для `completed` і `failed`.
    pub refunded: bool,
    pub status: RunStatus,
    /// Відбиток результату; з'являється, коли повернувся callback MPC.
    pub result_hash: Option<[u8; 32]>,
    /// Скільки записів увійшло в когорту — оголошено відкрито при розкритті
    /// (`T026`). За цим числом рахується оплата, і приховати його від програми
    /// означало б не мати чим платити.
    pub records_included: u32,
    /// Когорта виявилась меншою за `MIN_COHORT`, і рецепт віддав нулі
    /// (`FR-012`). Прогін відбувся, платити нема за що, депозит повертається
    /// повністю.
    pub suppressed: bool,
    /// Який датасет пулу згортається зараз. Рухає його тільки закриття
    /// датасету в MPC — саме тому ончейн-порядок не може розійтись із тим, у
    /// якому рахував рецепт.
    pub dataset_cursor: u32,
    /// Скільки батчів згорнуто за весь прогін.
    pub folded_batches: u32,
    /// Ланцюжок відбитків усього, що пішло в MPC (`T025`).
    ///
    /// Програма не бачить сховища й не може звірити байти з
    /// `Dataset.content_hash`: потокового sha256 через транзакції не існує, а
    /// цілий конверт на 21 МБ у одну не влазить. Тому ланцюг не перевіряє —
    /// він **свідчить**: кожна згортка вплітає сюди датасет, кількість живих
    /// записів і самі байти батча. Третя сторона бере шифротекст зі сховища
    /// (він публічний), ріже його тим самим батчем і рахує той самий ланцюжок.
    /// Розбіжність означає, що згорнули не той датасет, — і це видно без
    /// доступу до нашого коду (`FR-025`).
    pub folded_hash: [u8; 32],
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
    pub fn validate_datasets(datasets: &[RunDataset]) -> Result<()> {
        require!(!datasets.is_empty(), GenoVaultError::RunWithoutDatasets);
        require!(
            datasets.len() <= MAX_RUN_DATASETS,
            GenoVaultError::RunTooManyDatasets
        );
        for (index, entry) in datasets.iter().enumerate() {
            require!(
                !datasets[index + 1..]
                    .iter()
                    .any(|other| other.dataset == entry.dataset),
                GenoVaultError::RunDuplicateDataset
            );
        }
        Ok(())
    }

    /// Датасет, який згортається зараз.
    pub fn current_dataset(&self) -> Result<Pubkey> {
        self.datasets
            .get(self.dataset_cursor as usize)
            .map(|entry| entry.dataset)
            .ok_or_else(|| GenoVaultError::RunPoolExhausted.into())
    }

    /// Скільки записів оголошено внесками — сума по всьому пулу.
    ///
    /// Це **не** `records_included`: записи датасету, чий внесок придушено
    /// порогом, входять у когорту покупця, але сюди не потрапляють. Різниця
    /// між двома числами і є той надлишок, за який покупець платить середньою
    /// ціною пулу.
    pub fn contributed_records(&self) -> u64 {
        self.datasets
            .iter()
            .map(|entry| entry.records_included as u64)
            .sum()
    }

    pub fn pool_exhausted(&self) -> bool {
        self.dataset_cursor >= self.dataset_count()
    }

    /// Вплітає згорнутий батч у ланцюжок відбитків.
    ///
    /// У відбиток іде не тільки шифротекст: датасет і `live` теж. Без датасету
    /// той самий батч зарахувався б будь-якому учаснику пулу; без `live` —
    /// диспетчер оголосив би тридцять два живі записи там, де їх один, і
    /// когорта виросла б на добиті нулі, які рецепт мав відкинути. Обидва
    /// числа третя сторона відновлює з конверта датасету сама, тож ланцюжок
    /// лишається перевірним без нашої допомоги (`FR-025`).
    pub fn record_fold(&mut self, dataset: &Pubkey, live: u8, batch: &[u8]) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            live >= 1 && (live as usize) <= RECIPE_BATCH,
            GenoVaultError::BatchLiveOutOfRange
        );

        self.folded_hash = hashv(&[&self.folded_hash, dataset.as_ref(), &[live], batch]).to_bytes();
        self.folded_batches = self
            .folded_batches
            .checked_add(1)
            .ok_or(GenoVaultError::RunFoldOverflow)?;
        Ok(())
    }

    /// Датасет закрито в MPC — далі згортається наступний.
    ///
    /// Курсор рухає рівно це, і рівно з callback'а: якби його рухала
    /// публікація, ончейн-порядок розійшовся б із порядком, у якому рахував
    /// рецепт, — і внесок оголосився б не тому датасету.
    /// Внесок, оголошений у MPC, лягає в той рядок пулу, який зараз під
    /// курсором, — і курсор рушає далі. Обидві дії одна й та сама, бо
    /// розділити їх означало б дати внеску шанс сісти не на свій датасет.
    pub fn close_current_dataset(
        &mut self,
        records_included: u32,
        below_floor: bool,
    ) -> Result<Pubkey> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        let index = self.dataset_cursor as usize;
        let entry = self
            .datasets
            .get_mut(index)
            .ok_or(GenoVaultError::RunPoolExhausted)?;
        entry.records_included = records_included;
        entry.below_floor = below_floor;
        self.dataset_cursor += 1;
        Ok(self.datasets[index].dataset)
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

    /// Розкриття повернулось: відбиток звіту, розмір когорти й придушення.
    ///
    /// Записується рівно один раз — другий запис підмінив би те, що покупець
    /// уже бачить як свій результат, і переписав би число, за яким уже
    /// нараховано.
    ///
    /// `records_included` не менше за суму оголошених внесків: воно рахує весь
    /// пул, а внески — тільки ті датасети, що дотягнули до порога. Менше
    /// означало б, що ончейн-облік і рецепт рахували різні речі, і платити з
    /// такого числа не можна.
    pub fn record_reveal(
        &mut self,
        result_hash: [u8; 32],
        records_included: u32,
        suppressed: bool,
    ) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            self.result_hash.is_none(),
            GenoVaultError::RunResultAlreadyRecorded
        );
        require!(self.pool_exhausted(), GenoVaultError::RunPoolNotExhausted);
        require!(
            records_included as u64 >= self.contributed_records(),
            GenoVaultError::RunRecordsBelowContributions
        );

        self.result_hash = Some(result_hash);
        self.records_included = records_included;
        self.suppressed = suppressed;
        Ok(())
    }

    /// Нарахування одному власнику. Виплати йдуть порціями, бо 50 власників в
    /// одну транзакцію не вміщаються.
    ///
    /// Індекс, а не просто сума: без нього лічильник дозволив би нарахувати
    /// одному датасету двічі, поки сусідній лишається без нічого — і
    /// `settled_count` дійшов би до кінця, нічого не помітивши.
    pub fn settle(&mut self, index: usize, gross: u64) -> Result<()> {
        require!(
            self.status == RunStatus::Running,
            GenoVaultError::RunNotRunning
        );
        require!(
            self.result_hash.is_some(),
            GenoVaultError::RunResultMissing
        );
        let entry = self
            .datasets
            .get(index)
            .ok_or(GenoVaultError::RunDatasetIndexOutOfRange)?;
        require!(!entry.settled, GenoVaultError::RunAlreadySettled);

        let settled_amount = self
            .settled_amount
            .checked_add(gross)
            .ok_or(GenoVaultError::RunSettlementOverflow)?;
        // Роздати більше, ніж заблоковано, не можна навіть на одну одиницю:
        // це рівно те, що доводить `SC-006`.
        require!(
            settled_amount <= self.escrow_amount,
            GenoVaultError::RunSettlementExceedsEscrow
        );

        self.datasets[index].settled = true;
        self.settled_amount = settled_amount;
        self.settled_count += 1;
        Ok(())
    }

    /// Скільки з депозиту лишилось покупцю (`FR-016`).
    ///
    /// Різниця, а не окреме поле: депозит — верхня оцінка (`FR-015a`), і те, що
    /// не пішло власникам, за побудовою належить тому, хто його вніс. Ціле
    /// віднімання тут безпечне, бо `settle` не дає сумі перевищити депозит.
    pub fn refund_amount(&self) -> u64 {
        self.escrow_amount.saturating_sub(self.settled_amount)
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
        self.refunded = true;
        Ok(())
    }

    /// Повернення депозиту з невдачі (`T028`, `FR-016`).
    ///
    /// Окремий шлях, а не гілка в `complete()`: «завершено» означає «всім
    /// заплачено», і пускати сюди прогін, який до нарахувань не дожив,
    /// означало б назвати невдачу успіхом у журналі, який читає покупець.
    /// Статус лишається `failed` — гроші повернулись, але прогін не відбувся,
    /// і зникнути з журналу причина невдачі не має права.
    ///
    /// Віддається `refund_amount()`, а не `escrow_amount`: сьогодні це те саме
    /// число, бо нарахування вимагають `result_hash`, а після розкриття прогін
    /// уже не падає — у `failed` завжди `settled_amount == 0`. Але вимагати
    /// цього як умови не можна: якби інваріант колись зламався, вимога
    /// замкнула б депозит у сейфі назавжди, а різниця віддає покупцю все, що
    /// ще його.
    pub fn refund_failed(&mut self) -> Result<u64> {
        require!(
            self.status == RunStatus::Failed,
            GenoVaultError::RunNotFailed
        );
        require!(!self.refunded, GenoVaultError::RunAlreadyRefunded);
        self.refunded = true;
        Ok(self.refund_amount())
    }
}

/// Ціна оголошується за 1000 записів (`FR-015`).
pub const RECORDS_PER_PRICE_UNIT: u64 = 1_000;

/// Верхня оцінка вартості одного датасету в прогоні (`FR-015a`).
///
/// Рахує **програма**, а не клієнт: число, яке передав би покупець, він же й
/// занизив би, а перевірити його все одно можна лише цим самим множенням.
/// Тому клієнт передає тільки стелю, вище якої не згоден (`max_escrow`).
///
/// # Чому вгору
///
/// Заокруглення вниз зробило б безкоштовним будь-який датасет, менший за
/// тисячу записів: 9 записів за ціною 1 000 це 9/1000 → 0. Заокруглення вгору
/// монотонне, тож `cost(p, r) ≤ cost(p, claimed)` для будь-якого `r ≤ claimed`
/// — саме на цьому тримається `FR-015a` («не перевищує її після»), і саме так
/// рахує квота в `packages/shared/src/quote.ts`.
///
/// Проміжок рахується в `u128`: `price` і `record_count` кожен до `u64::MAX`,
/// і їхній добуток у `u64` не вміщається за побудовою. Переповнення тут — це
/// відмова, а не обрізка: обрізане число покупець заблокував би як депозит,
/// поки програма рахувала б інше.
pub fn dataset_cost(price_per_1k: u64, record_count: u64) -> Result<u64> {
    let scaled = (price_per_1k as u128)
        .checked_mul(record_count as u128)
        .and_then(|product| product.checked_add(RECORDS_PER_PRICE_UNIT as u128 - 1))
        .ok_or(GenoVaultError::RunEscrowOverflow)?
        / RECORDS_PER_PRICE_UNIT as u128;

    u64::try_from(scaled).map_err(|_| GenoVaultError::RunEscrowOverflow.into())
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
            dispatcher: Pubkey::default(),
            nonce: 1,
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
            fee_bps: 250,
            escrow_amount: 1_000,
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
            bump: 255,
        }
    }

    /// Прогін, що дійшов до розкриття: пул вичерпано, звіт записано.
    fn revealed(datasets: usize) -> Run {
        let mut r = run(datasets);
        r.start().unwrap();
        for _ in 0..datasets {
            r.close_current_dataset(100, false).unwrap();
        }
        r.record_reveal(HASH, 100 * datasets as u32, false).unwrap();
        r
    }

    #[test]
    fn the_happy_path_ends_in_completed() {
        let mut r = revealed(2);
        r.settle(0, 400).unwrap();
        r.settle(1, 500).unwrap();
        r.complete().unwrap();

        assert_eq!(r.status, RunStatus::Completed);
        assert_eq!(r.settled_amount, 900);
        assert_eq!(r.result_hash, Some(HASH));
        assert_eq!(r.refund_amount(), 100, "решта депозиту належить покупцю");
    }

    #[test]
    fn completed_means_everyone_was_paid() {
        let mut r = revealed(3);
        r.settle(0, 100).unwrap();

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
            code(r.settle(0, 10)),
            expected(GenoVaultError::RunResultMissing)
        );
    }

    #[test]
    fn payouts_never_exceed_the_escrow() {
        let mut r = revealed(2);
        r.settle(0, 1_000).unwrap();

        assert_eq!(
            code(r.settle(1, 1)),
            expected(GenoVaultError::RunSettlementExceedsEscrow),
            "жодна порція не має права вийти за заблоковане"
        );
    }

    #[test]
    fn no_dataset_is_settled_twice() {
        // Лічильника мало: він дійшов би до кінця, поки один власник отримав
        // двічі, а сусідній — нічого.
        let mut r = revealed(2);
        r.settle(0, 10).unwrap();

        assert_eq!(
            code(r.settle(0, 10)),
            expected(GenoVaultError::RunAlreadySettled)
        );
        assert_eq!(
            code(r.settle(2, 10)),
            expected(GenoVaultError::RunDatasetIndexOutOfRange)
        );
        assert!(r.settle(1, 10).is_ok());
    }

    #[test]
    fn the_result_is_written_once() {
        let mut r = revealed(1);
        assert_eq!(
            code(r.record_reveal([9u8; 32], 100, false)),
            expected(GenoVaultError::RunResultAlreadyRecorded),
            "покупець уже бачить перший відбиток як свій результат"
        );
    }

    #[test]
    fn a_reveal_before_the_pool_is_exhausted_is_refused() {
        // Незакритий датасет означає записи в когорті, на які ніхто не оголосив
        // внеску: заплатили б усім, крім його власника.
        let mut r = run(2);
        r.start().unwrap();
        r.close_current_dataset(100, false).unwrap();

        assert_eq!(
            code(r.record_reveal(HASH, 200, false)),
            expected(GenoVaultError::RunPoolNotExhausted)
        );
    }

    #[test]
    fn a_cohort_smaller_than_the_contributions_is_refused() {
        // Ончейн-облік і рецепт порахували різні речі: платити з такого числа
        // означало б віддати власникам більше записів, ніж було в когорті.
        let mut r = run(2);
        r.start().unwrap();
        r.close_current_dataset(100, false).unwrap();
        r.close_current_dataset(100, false).unwrap();

        assert_eq!(
            code(r.record_reveal(HASH, 199, false)),
            expected(GenoVaultError::RunRecordsBelowContributions)
        );
        assert!(r.record_reveal(HASH, 200, false).is_ok());
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
                code(r.record_reveal(HASH, 0, false)),
                expected(GenoVaultError::RunNotRunning)
            );
        }
    }

    #[test]
    fn a_failed_run_gives_the_whole_deposit_back() {
        // `FR-016`: невдача повертає депозит повністю. Нарахувань тут немає за
        // побудовою — вони вимагають результату, а прогін упав до нього.
        let mut r = run(2);
        r.start().unwrap();
        r.record_fold(&Pubkey::new_unique(), RECIPE_BATCH as u8, &[1u8; 32])
            .unwrap();
        r.fail().unwrap();

        assert_eq!(r.refund_failed().unwrap(), r.escrow_amount);
        assert!(r.refunded);
        assert_eq!(
            r.status,
            RunStatus::Failed,
            "гроші повернулись, але прогін не відбувся — причина лишається в журналі"
        );
    }

    #[test]
    fn the_deposit_comes_back_only_once() {
        // Статус тут не стереже нічого: `failed` лишається `failed`. Без
        // прапорця другий виклик виніс би із сейфа депозит чужого прогону.
        let mut r = run(1);
        r.fail().unwrap();
        r.refund_failed().unwrap();

        assert_eq!(
            code(r.refund_failed().map(|_| ())),
            expected(GenoVaultError::RunAlreadyRefunded)
        );
    }

    #[test]
    fn only_failure_refunds_from_this_path() {
        // `accepted` і `running` ще можуть дійти до розподілу; `rejected` не
        // має шляху, яким туди потрапляють; `completed` уже віддав різницю
        // через `finalize_run`, і другий переказ був би виплатою двічі.
        for status in [
            RunStatus::Accepted,
            RunStatus::Running,
            RunStatus::Rejected,
            RunStatus::Completed,
        ] {
            let mut r = run(1);
            r.status = status;
            assert_eq!(
                code(r.refund_failed().map(|_| ())),
                expected(GenoVaultError::RunNotFailed),
                "{status:?} не є невдачею"
            );
        }
    }

    #[test]
    fn completion_marks_the_difference_as_returned() {
        // Прапорець означає «покупцю віддано», і `finalize_run` мусить його
        // ставити теж: інакше слово читалось би по-різному для двох шляхів,
        // якими гроші йдуть назад.
        let mut r = revealed(1);
        r.settle(0, 900).unwrap();
        r.complete().unwrap();

        assert!(r.refunded);
    }

    #[test]
    fn the_chain_of_folds_names_the_dataset_and_the_live_count() {
        // Ланцюжок мусить розрізняти три речі, які інакше дали б однаковий
        // відбиток: ті самі байти в іншому датасеті, ті самі байти з іншим
        // `live` і ті самі байти вдруге. Третя сторона перевіряє саме це.
        let bytes = [7u8; 96];
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();

        let full = RECIPE_BATCH as u8;

        let mut base = run(2);
        base.start().unwrap();
        base.record_fold(&a, full, &bytes).unwrap();

        let mut other_dataset = run(2);
        other_dataset.start().unwrap();
        other_dataset.record_fold(&b, full, &bytes).unwrap();

        let mut other_live = run(2);
        other_live.start().unwrap();
        other_live.record_fold(&a, full - 1, &bytes).unwrap();

        let mut twice = run(2);
        twice.start().unwrap();
        twice.record_fold(&a, full, &bytes).unwrap();
        twice.record_fold(&a, full, &bytes).unwrap();

        assert_ne!(base.folded_hash, other_dataset.folded_hash);
        assert_ne!(base.folded_hash, other_live.folded_hash);
        assert_ne!(base.folded_hash, twice.folded_hash);
        assert_ne!(base.folded_hash, [0u8; 32]);
        assert_eq!(base.folded_batches, 1);
        assert_eq!(twice.folded_batches, 2);
    }

    #[test]
    fn an_empty_or_overfull_batch_is_refused() {
        let mut r = run(1);
        r.start().unwrap();
        let dataset = r.current_dataset().unwrap();

        // Порожній батч витратив би обчислення, нічого не додавши; батч,
        // більший за контур, — обіцянка, яку рецепт не виконає.
        assert_eq!(
            code(r.record_fold(&dataset, 0, &[]).map(|_| ())),
            expected(GenoVaultError::BatchLiveOutOfRange)
        );
        assert_eq!(
            code(
                r.record_fold(&dataset, RECIPE_BATCH as u8 + 1, &[])
                    .map(|_| ())
            ),
            expected(GenoVaultError::BatchLiveOutOfRange)
        );
        assert!(r.record_fold(&dataset, RECIPE_BATCH as u8, &[]).is_ok());
    }

    #[test]
    fn folding_belongs_to_a_running_run() {
        let mut r = run(1);
        let dataset = r.datasets[0].dataset;
        assert_eq!(
            code(r.record_fold(&dataset, 1, &[]).map(|_| ())),
            expected(GenoVaultError::RunNotRunning),
            "депозит заблоковано, але обчислення ще не опубліковане"
        );
    }

    #[test]
    fn the_cursor_walks_the_pool_once() {
        let mut r = run(2);
        r.start().unwrap();

        let first = r.datasets[0].dataset;
        let second = r.datasets[1].dataset;

        assert_eq!(r.current_dataset().unwrap(), first);
        assert_eq!(r.close_current_dataset(120, false).unwrap(), first);
        assert_eq!(r.current_dataset().unwrap(), second);
        assert!(!r.pool_exhausted());

        assert_eq!(r.close_current_dataset(9, true).unwrap(), second);
        assert!(r.pool_exhausted());
        assert_eq!(
            code(r.close_current_dataset(1, false).map(|_| ())),
            expected(GenoVaultError::RunPoolExhausted),
            "зайве закриття оголосило б внесок датасету, якого в прогоні немає"
        );

        // Внесок сідає в той рядок, який був під курсором, а не в сусідній.
        assert_eq!(r.datasets[0].records_included, 120);
        assert!(!r.datasets[0].below_floor);
        assert_eq!(r.datasets[1].records_included, 9);
        assert!(r.datasets[1].below_floor);
        assert_eq!(r.contributed_records(), 129);
    }

    #[test]
    fn recipe_params_refuse_what_the_recipe_would_misread() {
        let ok = FrequenciesParams {
            min_age: 18,
            max_age: 65,
            sex_filter: FILTER_ANY,
            affected_filter: 1,
        };
        assert_eq!(FrequenciesParams::decode(&ok.encode()).unwrap(), ok);

        // Перевернуті межі дають порожню когорту, і покупець дізнався б про це
        // після оплати.
        let mut inverted = ok.encode();
        inverted[0] = 66;
        assert_eq!(
            code(FrequenciesParams::decode(&inverted).map(|_| ())),
            expected(GenoVaultError::RecipeParamsInvalid)
        );

        // Значення поза словником рецепт порівнює на рівність — воно тихо
        // відкинуло б усіх, і це виглядало б як порожній датасет.
        for index in [2usize, 3] {
            let mut raw = ok.encode();
            raw[index] = FILTER_ANY + 1;
            assert_eq!(
                code(FrequenciesParams::decode(&raw).map(|_| ())),
                expected(GenoVaultError::RecipeParamsInvalid)
            );
        }

        // Зарезервований байт, який приїхав заповненим, — це значення, якого
        // сьогодні не існує, а завтра існуватиме.
        let mut reserved = ok.encode();
        reserved[RECIPE_PARAMS_LEN - 1] = 1;
        assert_eq!(
            code(FrequenciesParams::decode(&reserved).map(|_| ())),
            expected(GenoVaultError::RecipeParamsInvalid)
        );
    }

    fn entry(dataset: Pubkey) -> RunDataset {
        RunDataset {
            dataset,
            price_per_1k: 1_000,
            records_included: 0,
            below_floor: false,
            settled: false,
        }
    }

    #[test]
    fn a_duplicate_dataset_is_refused() {
        let dataset = Pubkey::new_unique();
        let other = Pubkey::new_unique();

        assert!(Run::validate_datasets(&[entry(dataset), entry(other)]).is_ok());
        assert_eq!(
            code(Run::validate_datasets(&[
                entry(dataset),
                entry(other),
                entry(dataset)
            ])),
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

        let too_many: Vec<RunDataset> = (0..=MAX_RUN_DATASETS)
            .map(|_| entry(Pubkey::new_unique()))
            .collect();
        assert_eq!(
            code(Run::validate_datasets(&too_many)),
            expected(GenoVaultError::RunTooManyDatasets)
        );
        assert!(Run::validate_datasets(&too_many[..MAX_RUN_DATASETS]).is_ok());
    }

    #[test]
    fn a_dataset_under_a_thousand_records_is_not_free() {
        // Заокруглення вниз зробило б безкоштовним будь-який датасет, менший за
        // тисячу записів — а `FR-009` прямо каже, що окрема особа реєструє
        // датасет на одну людину.
        assert_eq!(dataset_cost(1_000, 1).unwrap(), 1);
        assert_eq!(dataset_cost(1_000, 9).unwrap(), 9);
        assert_eq!(dataset_cost(1_000, 999).unwrap(), 999);
        assert_eq!(dataset_cost(1_000, 1_000).unwrap(), 1_000);
    }

    #[test]
    fn the_bound_never_shrinks_when_records_grow() {
        // На цій монотонності тримається `FR-015a`: фактичний внесок ніколи не
        // більший за заявлений, тож і його вартість не більша за межу.
        let claimed = 10_000u64;
        let bound = dataset_cost(25_000_000, claimed).unwrap();
        for records in [0u64, 1, 9, 999, 5_000, claimed] {
            assert!(
                dataset_cost(25_000_000, records).unwrap() <= bound,
                "вартість {records} записів має вкладатись у межу"
            );
        }
    }

    #[test]
    fn nothing_costs_nothing() {
        assert_eq!(dataset_cost(25_000_000, 0).unwrap(), 0);
        assert_eq!(dataset_cost(0, 10_000).unwrap(), 0);
    }

    #[test]
    fn a_price_that_does_not_fit_is_refused_not_truncated() {
        // Обрізане число покупець заблокував би як депозит, поки програма
        // рахувала б інше.
        assert_eq!(
            code(dataset_cost(u64::MAX, 100_000).map(|_| ())),
            expected(GenoVaultError::RunEscrowOverflow)
        );
        // Рівно на межі — ще проходить: u64::MAX за тисячу записів це u64::MAX.
        assert_eq!(dataset_cost(u64::MAX, 1_000).unwrap(), u64::MAX);
    }
}
