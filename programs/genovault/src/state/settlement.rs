use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;
use crate::state::{Run, RunDataset, BPS_DENOMINATOR, RECORDS_PER_PRICE_UNIT};

/// Розподіл плати за прогін (`T026`, `FR-018b`, `FR-019`).
///
/// # Що саме ділиться
///
/// Покупець заблокував `escrow_amount` — верхню оцінку з ончейн-цін і
/// заявлених обсягів (`FR-015a`). MPC повернув два числа: скільки записів
/// увійшло в когорту всього (`records_included`, відкрито) і скільки дав
/// кожен датасет окремо (`RunDataset.records_included`, оголошено при
/// закритті). Ці числа не зобов'язані збігатися: датасет, чий внесок не
/// дотягнув до `MIN_CONTRIBUTION`, оголошує нуль, але його записи вже в
/// когорті й відкотити їх нічим.
///
/// # Продуктове рішення 2026-09-07: середня ціна пулу
///
/// За надлишок — записи в когорті без оголошеного внеску — покупець платить
/// **середньою ціною пулу**, а гроші дістаються власникам, які поріг пройшли,
/// пропорційно тому, що вони вже заробили. Це те саме, що сказати: внесок
/// кожного платного власника масштабується на `records_included / Σ внесків`.
///
/// Альтернативу («платить лише за оголошені внески») відкинуто в `T019`: пул
/// із 50 датасетів по 9 записів віддав би покупцю 450 записів безкоштовно, і
/// поріг приватності перетворився б на спосіб не платити. Віддати надлишок
/// платформі — гірше: у платформи з'явився б мотив, щоб датасети до порога не
/// дотягували, а `fee_bps` перестав би бути повною відповіддю на питання
/// «скільки бере платформа» (`FR-019`).
///
/// # Стеля
///
/// Масштаб `R / C` може вивести суму за межу депозиту: коли дорогий датасет
/// дав усі свої записи, а дешевий придушено, середня ціна пулу виявляється
/// вищою за ту, з якої рахувалась верхня оцінка. Тому є друга гілка: коли
/// повна ціна не вміщається в депозит, депозит ділиться між власниками
/// **рівно** — пропорційно вже заробленому. Покупець ніколи не платить більше,
/// ніж заблокував, і це не «захист», а умова, під якою він підписував.
///
/// # Пул, у якому мовчать усі
///
/// Третя гілка (`T027a`): коли `Σ внесків = 0`, масштабу нема на що множити, і
/// перші дві віддали б нуль усім при розкритій когорті. Правило й ціна цього
/// рішення — у `silent_pool_share`.
///
/// Усі три гілки — чисті функції від `Run`. Це навмисно: нарахування йдуть
/// окремими транзакціями по одному датасету, і кожна мусить порахувати ту саму
/// частку, не питаючи, які інші вже пройшли.

/// Скільки покупець платить за внесок датасету під індексом `index`.
///
/// Заокруглення в першій гілці — вгору, як і в `dataset_cost`: інакше внесок
/// дрібнішого за тисячу записів датасету коштував би нуль, а `FR-009` прямо
/// каже, що окрема особа реєструє датасет на одну людину. У другій гілці —
/// вниз, бо там ділиться скінченна сума й перевищити її не можна.
pub fn gross_for(run: &Run, index: usize) -> Result<u64> {
    let entry = run
        .datasets
        .get(index)
        .ok_or(GenoVaultError::RunDatasetIndexOutOfRange)?;

    let records = run.records_included as u128;
    let contributed = run.contributed_records() as u128;
    if contributed == 0 {
        return silent_pool_share(run, entry, records);
    }

    let base = (entry.price_per_1k as u128) * (entry.records_included as u128);
    if base == 0 {
        return Ok(0);
    }

    let unit = RECORDS_PER_PRICE_UNIT as u128;
    let raw = ceil_div(base * records, contributed * unit);

    let total: u128 = run
        .datasets
        .iter()
        .map(|other| {
            let other_base = (other.price_per_1k as u128) * (other.records_included as u128);
            ceil_div(other_base * records, contributed * unit)
        })
        .sum();

    let escrow = run.escrow_amount as u128;
    let amount = if total <= escrow {
        raw
    } else {
        // Повна ціна не вміщається в депозит: ділимо те, що є, пропорційно
        // заробленому. Сума часток тут не перевищує депозит за побудовою —
        // кожна заокруглена вниз, а їхня точна сума дорівнює йому.
        let total_base: u128 = run
            .datasets
            .iter()
            .map(|other| (other.price_per_1k as u128) * (other.records_included as u128))
            .sum();
        escrow * base / total_base
    };

    u64::try_from(amount).map_err(|_| GenoVaultError::RunSettlementOverflow.into())
}

/// Пул, у якому мовчать усі (`T027a`, продуктове рішення 2026-09-07).
///
/// Коли жоден датасет не дотягнув до `MIN_CONTRIBUTION`, `Σ внесків = 0` і
/// масштабу `records_included / Σ внесків` нема на що множити: основна гілка
/// віддала б нуль **усім**, а когорта з `records_included ≥ MIN_COHORT` при
/// цьому розкривається. Покупець отримав би звіт безкоштовно й із повним
/// поверненням депозиту — рівно та дірка, яку `T019` називав неприйнятною, і
/// гірша за разову втрату грошей: вузьким фільтром це безкоштовний зонд, у
/// якому й невдала спроба коштує нуль.
///
/// Ціна тут — **найнижча ненульова** ціна серед мовчазних, за весь
/// `records_included`. Те саме правило, за яким верхня оцінка вже врахувала
/// мовчазні записи (`FR-015a`), тож гроші заблоковані й межа тримається без
/// окремої домовленості. Ненульова, а не просто найнижча: один безкоштовний
/// датасет у пулі — консорціумний або зареєстрований покупцем саме заради
/// цього — знову зробив би весь пул безкоштовним. Пул, у якому всі ціни
/// нульові, чесно коштує нуль: так вирішили його власники.
///
/// Ділиться **порівну** між датасетами з `below_floor`, а не пропорційно
/// внеску: внесків тут немає, всі оголосили нуль. Названа ціна цього рішення —
/// платимо й тому, хто не дав жодного запису під фільтр: `below_floor` не
/// відрізняє «дав, але замало» від «не дав нічого», і відрізняти означало б
/// розкрити більше, ніж один біт, який рецепт і так оголошує.
///
/// Залишок від ділення повертається покупцю, а не дістається першим у списку:
/// склад і порядок пулу називає покупець, і порядок не має вирішувати, кому
/// перепаде зайва одиниця. Максимум 49 найменших одиниць на прогін.
fn silent_pool_share(run: &Run, entry: &RunDataset, records: u128) -> Result<u64> {
    // Когорта придушена (`records_included = 0`): звіт із нулів, платити нема
    // за що. `below_floor` тут — сторож: датасет, якого не закрили, не
    // оголошував нічого, і його частка не має братися з повітря.
    if records == 0 || !entry.below_floor {
        return Ok(0);
    }

    let recipients = run
        .datasets
        .iter()
        .filter(|other| other.below_floor)
        .count() as u128;
    let lowest = run
        .datasets
        .iter()
        .filter(|other| other.below_floor && other.price_per_1k > 0)
        .map(|other| other.price_per_1k as u128)
        .min()
        .unwrap_or(0);
    if recipients == 0 || lowest == 0 {
        return Ok(0);
    }

    // Стеля та сама, що й в основній гілці: покупець не платить більше, ніж
    // заблокував. Спрацювати вона тут не мусить — депозит рахувався по всьому
    // пулу, а платимо за найнижчою ціною, — але спиратись на це без перевірки
    // означало б вірити, що заявлені обсяги не менші за фактичні.
    let full = ceil_div(lowest * records, RECORDS_PER_PRICE_UNIT as u128);
    let total = full.min(run.escrow_amount as u128);

    u64::try_from(total / recipients).map_err(|_| GenoVaultError::RunSettlementOverflow.into())
}

/// Комісія платформи з нарахування (`FR-019`).
///
/// Береться **з нарахування власника**, а не додається до рахунку покупця:
/// `FR-018b` каже, що власник отримує свою ціну мінус комісія, а квота
/// (`FR-015a`) не має права показати одне число й списати інше.
///
/// Заокруглення вниз — на користь власника: залишок від ділення лишається
/// йому, а не платформі. Сходження сум від цього не страждає, бо частка
/// власника рахується відніманням, а не окремим множенням.
pub fn platform_fee(gross: u64, fee_bps: u16) -> Result<u64> {
    let fee = (gross as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(GenoVaultError::RunSettlementOverflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(fee).map_err(|_| GenoVaultError::RunSettlementOverflow.into())
}

fn ceil_div(numerator: u128, denominator: u128) -> u128 {
    if numerator == 0 {
        return 0;
    }
    (numerator - 1) / denominator + 1
}

// ── Баланс власника ──────────────────────────────────────────────────────────

/// Нарахування власника (`FR-020`).
///
/// Seeds: `["balance", owner]`.
///
/// Один акаунт на власника, а не на пару «власник + прогін»: токени рухаються
/// рівно двічі — внесок покупця в сейф і виведення власника з сейфа, — і саме
/// тому `SC-007` (розподіл між 50 власниками < 30 с) досяжний без петлі з 50
/// переказів. Розшифровку «звідки взялась ця сума» дають події прогонів, а не
/// окремі акаунти під кожну з них.
///
/// Тут же лежить і комісія платформи: її балансом володіє `PlatformConfig.
/// authority`, і жодного окремого шляху для неї не існує. Виняток був би
/// місцем, де платформа рухає гроші не так, як усі.
#[account]
#[derive(InitSpace)]
pub struct OwnerBalance {
    pub owner: Pubkey,
    /// Скільки нараховано за весь час.
    pub accrued: u64,
    /// Скільки з нарахованого вже виведено (`T049`).
    pub withdrawn: u64,
    pub bump: u8,
}

impl OwnerBalance {
    pub const SEED: &'static [u8] = b"balance";

    pub fn accrue(&mut self, amount: u64) -> Result<()> {
        self.accrued = self
            .accrued
            .checked_add(amount)
            .ok_or(GenoVaultError::OwnerBalanceOverflow)?;
        Ok(())
    }
}

// ── Звіт покупця ─────────────────────────────────────────────────────────────

/// Скільки шифротекстів везе звіт покупця.
///
/// Число з `build/frequencies_reveal.idarc`, а не з арифметики на полях, і
/// навмисно окрема константа від `ACCUMULATOR_CIPHERTEXTS`, хоч вони й
/// збіглися: це вихід іншого контуру під іншим ключем, і зміна `Report` без
/// зміни `Frequencies` — цілком звичайна правка. Розходження стереже
/// `the_report_matches_the_circuit`.
pub const REPORT_CIPHERTEXTS: usize = 24;

/// Результат прогону, зашифрований на ключ покупця (`T026`, `FR-014`).
///
/// Seeds: `["result", run]`.
///
/// # Чому акаунт, а не подія
///
/// Подія коштувала б нуль rent і жила б рівно доти, доки RPC тримає логи.
/// Покупець, який не забрав звіт вчасно, втратив би його назавжди: MPC стану
/// не зберігає, накопичувач на той момент уже закритий, і перерахувати нема з
/// чого — довелось би замовляти й оплачувати прогін удруге. Акаунт коштує
/// ~0,006 SOL і читається з ланцюга будь-коли й без нашого API — рівно те, що
/// потрібно `FR-025` і звіряцу з `T031`.
///
/// # Що тут відкрито, а що ні
///
/// Відкрито `records_included` — за ним рахується оплата, і приховати його від
/// програми означало б не мати чим платити. Сам звіт зашифрований на ключ
/// покупця: ні платформа, ні власник датасету, ні диспетчер його не читають.
/// Приватність **сум платежів** — окрема задача (`FR-021`, `T054`-`T055`); на
/// M1 суми публічні, і це сказано вголос у віхах.
#[account]
#[derive(InitSpace)]
pub struct RunResult {
    pub run: Pubkey,
    /// Ключ, яким MXE зашифрував звіт на покупця. Разом із нонсом його
    /// вистачає, щоб покупець розшифрував звіт своїм ключем і більше нічим.
    pub encryption_key: [u8; 32],
    pub nonce: u128,
    pub ciphertexts: [[u8; 32]; REPORT_CIPHERTEXTS],
    /// Розмір когорти — те саме число, що в `Run.records_included`.
    pub records_included: u32,
    /// Когорта менша за `MIN_COHORT`: звіт складається з нулів (`FR-012`).
    pub suppressed: bool,
    pub bump: u8,
}

impl RunResult {
    pub const SEED: &'static [u8] = b"result";

    /// Відбиток звіту для `Run.result_hash`.
    ///
    /// Вплітає ключ і нонс, а не самі лише шифротексти: без них той самий звіт,
    /// перешифрований на іншого читача, дав би той самий відбиток — і
    /// підміна адресата стала б непомітною для звіряча журналу.
    pub fn digest(
        encryption_key: &[u8; 32],
        nonce: u128,
        ciphertexts: &[[u8; 32]; REPORT_CIPHERTEXTS],
    ) -> [u8; 32] {
        let mut bytes = Vec::with_capacity(32 + 16 + REPORT_CIPHERTEXTS * 32);
        bytes.extend_from_slice(encryption_key);
        bytes.extend_from_slice(&nonce.to_le_bytes());
        for ciphertext in ciphertexts.iter() {
            bytes.extend_from_slice(ciphertext);
        }
        solana_sha256_hasher::hash(&bytes).to_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{RunDataset, RunStatus, ACCUMULATOR_CIPHERTEXTS, RECIPE_PARAMS_LEN};

    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    /// Прогін із заданими парами «ціна за 1000 · внесок».
    fn run(escrow: u64, records_included: u32, pool: &[(u64, u32)]) -> Run {
        Run {
            buyer: Pubkey::new_unique(),
            dispatcher: Pubkey::new_unique(),
            nonce: 1,
            recipe_id: 1,
            recipe_params: [0u8; RECIPE_PARAMS_LEN],
            use_type: 1,
            buyer_category: 1,
            buyer_x25519: [4u8; 32],
            datasets: pool
                .iter()
                .map(|(price, records)| RunDataset {
                    dataset: Pubkey::new_unique(),
                    price_per_1k: *price,
                    records_included: *records,
                    below_floor: *records == 0,
                    settled: false,
                })
                .collect(),
            fee_bps: 700,
            escrow_amount: escrow,
            settled_count: 0,
            settled_amount: 0,
            refunded: false,
            status: RunStatus::Running,
            result_hash: Some([1u8; 32]),
            records_included,
            suppressed: false,
            dataset_cursor: pool.len() as u32,
            folded_batches: 0,
            folded_hash: [0u8; 32],
            created_at: 0,
            bump: 255,
        }
    }

    fn total(run: &Run) -> u64 {
        (0..run.datasets.len())
            .map(|index| gross_for(run, index).unwrap())
            .sum()
    }

    /// Розкладка звіту мусить збігатися з тим, що віддає контур: 24
    /// шифротексти з `build/frequencies_reveal.idarc`. Розійтись їм означало б
    /// приймати callback, який не влазить у власний акаунт.
    #[test]
    fn the_report_matches_the_circuit() {
        assert_eq!(REPORT_CIPHERTEXTS, 24);
        assert_eq!(REPORT_CIPHERTEXTS, ACCUMULATOR_CIPHERTEXTS);
    }

    #[test]
    fn each_owner_is_paid_for_the_records_that_entered() {
        // Ніхто не придушений: R = C, масштабу немає, кожен отримує рівно
        // «ціна × записи» — це і є `FR-018b` дослівно.
        let r = run(1_000_000, 3_000, &[(100_000, 1_000), (50_000, 2_000)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 100_000);
        assert_eq!(gross_for(&r, 1).unwrap(), 100_000);
        assert_eq!(total(&r), 200_000);
    }

    #[test]
    fn suppressed_records_are_paid_for_at_the_pool_average() {
        // Другий датасет дав 9 записів — під порогом, оголошено нуль. Але
        // записи в когорті, і покупець за них платить: R = 1009, C = 1000.
        let r = run(1_000_000, 1_009, &[(100_000, 1_000), (100_000, 0)]);

        // 100 000 × 1 000 × 1 009 / (1 000 × 1 000) = 100 900.
        assert_eq!(gross_for(&r, 0).unwrap(), 100_900);
        assert_eq!(
            gross_for(&r, 1).unwrap(),
            0,
            "власник, який не дотягнув до порога, не отримує нічого — `T019`"
        );
    }

    #[test]
    fn the_buyer_never_pays_more_than_the_escrow() {
        // Дорогий датасет дав усе, дешевий придушено: середня ціна пулу вища
        // за ту, з якої рахувалась верхня оцінка, і повна ціна за депозит не
        // влазить. Депозит ділиться рівно, і жодна частка за нього не виходить.
        let r = run(100, 109, &[(1_000, 100), (1, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 100);
        assert_eq!(total(&r), 100, "сума часток не більша за заблоковане");
        assert!(total(&r) <= r.escrow_amount);
    }

    #[test]
    fn a_suppressed_cohort_costs_nothing() {
        // Когорта менша за `MIN_COHORT`: рецепт віддав нулі, платити нема за що,
        // депозит повертається повністю (`FR-016`).
        let r = run(1_000_000, 0, &[(100_000, 0), (50_000, 0)]);

        assert_eq!(total(&r), 0);
        assert_eq!(r.refund_amount(), 1_000_000);
    }

    #[test]
    fn a_pool_where_everyone_is_silent_is_not_free() {
        // `T027a`. Ніхто не дотягнув до `MIN_CONTRIBUTION`, але 450 записів у
        // когорті, і звіт розкрито. Ціна — найнижча в пулі за весь обсяг:
        // ceil(1 000 × 450 / 1 000) = 450, порівну на трьох.
        let r = run(1_000_000, 450, &[(1_000, 0), (2_000, 0), (3_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 150);
        assert_eq!(gross_for(&r, 1).unwrap(), 150);
        assert_eq!(gross_for(&r, 2).unwrap(), 150);
        assert_eq!(total(&r), 450, "покупець платить за те, що отримав");
    }

    #[test]
    fn a_free_dataset_does_not_make_the_silent_pool_free() {
        // Один безкоштовний датасет у пулі — консорціумний або зареєстрований
        // покупцем саме заради цього — не має обнуляти рахунок. Ціна береться
        // найнижча **ненульова**.
        let r = run(1_000_000, 100, &[(0, 0), (1_000, 0)]);

        assert_eq!(total(&r), 100);
        assert_eq!(
            gross_for(&r, 0).unwrap(),
            50,
            "платимо й тому, хто віддав дані безкоштовно: `below_floor` не              відрізняє «дав, але замало» від «не дав нічого» — названа ціна рішення"
        );
        assert_eq!(gross_for(&r, 1).unwrap(), 50);
    }

    #[test]
    fn a_silent_pool_priced_at_zero_costs_zero() {
        // Усі ціни нульові — пул чесно безкоштовний: так вирішили його власники.
        let r = run(1_000_000, 100, &[(0, 0), (0, 0)]);
        assert_eq!(total(&r), 0);
        assert_eq!(r.refund_amount(), 1_000_000);
    }

    #[test]
    fn the_remainder_of_a_silent_pool_goes_back_to_the_buyer() {
        // 450 на чотирьох — це 112 кожному й 2 одиниці залишку. Вони не
        // дістаються першим у списку: склад і порядок пулу називає покупець.
        let r = run(1_000_000, 450, &[(1_000, 0), (1_000, 0), (1_000, 0), (1_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 112);
        assert_eq!(total(&r), 448);
        assert_eq!(r.escrow_amount - total(&r), 999_552);
    }

    #[test]
    fn a_silent_pool_never_exceeds_the_escrow() {
        // Стеля тут спрацювати не мусить, але спиратись на це без перевірки
        // означало б вірити, що заявлені обсяги не менші за фактичні.
        let r = run(50, 1_000, &[(1_000, 0), (1_000, 0)]);

        assert_eq!(total(&r), 50);
        assert!(total(&r) <= r.escrow_amount);
    }

    #[test]
    fn a_dataset_under_a_thousand_records_is_not_free() {
        // Те саме заокруглення, що й у верхній оцінці: 9 записів за ціною
        // 1 000 це 9, а не нуль.
        let r = run(1_000_000, 9, &[(1_000, 9)]);
        assert_eq!(gross_for(&r, 0).unwrap(), 9);
    }

    #[test]
    fn the_sums_add_up_to_the_escrow() {
        // `SC-006` до найменшої одиниці: частки власників + комісія + різниця.
        // Комісія береться з частки, тож сходження перевіряється на трьох
        // числах, а не на двох.
        let r = run(1_000_000, 3_010, &[(100_000, 1_000), (50_000, 2_000), (70_000, 0)]);

        let mut owners = 0u64;
        let mut fees = 0u64;
        let mut gross_total = 0u64;
        for index in 0..r.datasets.len() {
            let gross = gross_for(&r, index).unwrap();
            let fee = platform_fee(gross, r.fee_bps).unwrap();
            gross_total += gross;
            fees += fee;
            owners += gross - fee;
        }
        let refund = r.escrow_amount - gross_total;

        assert_eq!(owners + fees + refund, r.escrow_amount);
        assert!(gross_total > 200_000, "надлишок за придушені записи оплачено");
    }

    #[test]
    fn the_fee_is_taken_from_the_payout_not_added_to_the_bill() {
        // 7% від 100 000 це 7 000, і власник отримує 93 000 — а покупець
        // платить ті самі 100 000, які бачив у квоті (`FR-015a`).
        assert_eq!(platform_fee(100_000, 700).unwrap(), 7_000);
        assert_eq!(platform_fee(0, 700).unwrap(), 0);
        // Заокруглення вниз лишає залишок власнику, а не платформі.
        assert_eq!(platform_fee(99, 700).unwrap(), 6);
    }

    #[test]
    fn an_index_outside_the_pool_is_refused() {
        let r = run(1_000, 10, &[(1_000, 10)]);
        let error = gross_for(&r, 1).expect_err("індексу поза пулом не існує");
        let code = match error {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        };
        assert_eq!(code, expected(GenoVaultError::RunDatasetIndexOutOfRange));
    }

    #[test]
    fn the_digest_names_the_reader() {
        // Той самий звіт, перешифрований на іншого читача, мусить дати інший
        // відбиток: інакше підміна адресата була б непомітною для звіряча.
        let ciphertexts = [[3u8; 32]; REPORT_CIPHERTEXTS];
        let base = RunResult::digest(&[1u8; 32], 7, &ciphertexts);

        assert_ne!(base, RunResult::digest(&[2u8; 32], 7, &ciphertexts));
        assert_ne!(base, RunResult::digest(&[1u8; 32], 8, &ciphertexts));
        assert_ne!(
            base,
            RunResult::digest(&[1u8; 32], 7, &[[4u8; 32]; REPORT_CIPHERTEXTS])
        );
    }
}
