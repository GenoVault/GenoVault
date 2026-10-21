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
/// # The surplus goes to the datasets that stayed silent (`T043`)
///
/// Records in the cohort without a declared contribution — the surplus,
/// `R − C` — are still paid for by the buyer **at the pool average**
/// (decision 2026-09-07): the bill is every declared contribution scaled by
/// `records_included / Σ contributions`. What changed on 2026-10-18 is who
/// receives it.
///
/// A dataset that cleared the floor is paid exactly its own price for its own
/// records, `ceil(price × records / 1000)` — `FR-018b` word for word, no
/// scaling. The rest of the bill is the price of the surplus, and the surplus
/// came from the datasets under the floor, so it is split **equally** between
/// the datasets with `below_floor`. Before, it went to the owners who had
/// cleared the floor, and a dataset of one person (`FR-009`) could never earn
/// anything in a pool with a clinic in it: one record is always under a floor
/// of ten.
///
/// Equally, not by contribution, for the same reason as in the silent pool:
/// the circuit reveals one bit per dataset, and splitting by anything finer
/// would reveal more. The silent pool (`C = 0`) is the same rule with nobody
/// above the floor; it only needs its own price, because there is no pool
/// average to take — see `silent_pool_share`.
///
/// Named costs of this rule:
/// - a dataset that gave no record under the filter is paid the same as one
///   that gave nine: `below_floor` does not tell them apart;
/// - a buyer can add datasets of their own under the floor and take a part
///   of the surplus back. They pay for those records at the pool average
///   like for any others, so what they win is a part of what the honest small
///   owners in the same pool would have got.
///
/// The alternative of paying only for declared contributions was rejected in
/// `T019`: a pool of 50 datasets of 9 records would hand the buyer 450 records
/// for free. Giving the surplus to the platform is worse: the platform would
/// gain a motive for datasets to stay under the floor, and `fee_bps` would
/// stop being the full answer to "how much does the platform take" (`FR-019`).
///
/// # Ceiling
///
/// The bill never exceeds the escrow. The pool average can come out above the
/// price the upper bound was computed from — an expensive dataset gave all its
/// records, a cheap one was suppressed — and then the surplus gets what is
/// left of the escrow after the owners above the floor are paid. Their own
/// price always fits: a contribution is never larger than the claimed volume
/// the escrow was computed from. If it ever does not fit, the escrow is split
/// between them in proportion to what they earned, and the surplus gets
/// nothing — the buyer never pays more than they locked.
///
/// Every branch is a pure function of `Run`. This is deliberate: payouts go
/// out in separate transactions, one dataset each, and each must compute the
/// same share without asking which others have already gone through.

/// How much the buyer pays for the dataset at `index`.
///
/// Own price is rounded up, as in `dataset_cost`: otherwise a contribution of
/// fewer than a thousand records would cost nothing. Shares of a finite sum —
/// the surplus and the ceiling — are rounded down, so they cannot exceed it;
/// the remainder goes back to the buyer.
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

    let escrow = run.escrow_amount as u128;
    let earned: u128 = run.datasets.iter().map(own_price).sum();

    let amount = if earned > escrow {
        // Unreachable while contributions do not exceed claimed volumes, and
        // guarded rather than assumed: split what there is in proportion to
        // what was earned. Each share is rounded down, so their sum fits.
        let base = (entry.price_per_1k as u128) * (entry.records_included as u128);
        let total_base: u128 = run
            .datasets
            .iter()
            .map(|other| (other.price_per_1k as u128) * (other.records_included as u128))
            .sum();
        if base == 0 {
            0
        } else {
            escrow * base / total_base
        }
    } else if !entry.below_floor {
        own_price(entry)
    } else {
        let bill = pool_bill(run, records, contributed).min(escrow);
        surplus_share(run, bill.saturating_sub(earned))
    };

    u64::try_from(amount).map_err(|_| GenoVaultError::RunSettlementOverflow.into())
}

/// What a dataset above the floor is paid: its price for its own records.
fn own_price(entry: &RunDataset) -> u128 {
    let base = (entry.price_per_1k as u128) * (entry.records_included as u128);
    ceil_div(base, RECORDS_PER_PRICE_UNIT as u128)
}

/// The buyer's bill before the ceiling: every contribution at the pool
/// average, that is, scaled by `records / contributed`.
fn pool_bill(run: &Run, records: u128, contributed: u128) -> u128 {
    let unit = RECORDS_PER_PRICE_UNIT as u128;
    run.datasets
        .iter()
        .map(|other| {
            let base = (other.price_per_1k as u128) * (other.records_included as u128);
            ceil_div(base * records, contributed * unit)
        })
        .sum()
}

/// One equal share of the surplus. Zero when nobody is under the floor —
/// then there is no surplus either, since `records == contributed`.
fn surplus_share(run: &Run, surplus: u128) -> u128 {
    let recipients = run
        .datasets
        .iter()
        .filter(|other| other.below_floor)
        .count() as u128;
    if recipients == 0 {
        return 0;
    }
    surplus / recipients
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

    /// How much is still available to withdraw.
    pub fn available(&self) -> u64 {
        // `withdraw` keeps `withdrawn ≤ accrued`, so the subtraction does not
        // underflow; saturation covers an account not written by us.
        self.accrued.saturating_sub(self.withdrawn)
    }

    /// Debits `amount` from what was accrued (`T049`, `FR-020`).
    ///
    /// # Why `withdrawn_before`
    ///
    /// A balance check alone does not make a repeated withdrawal impossible:
    /// on a balance of 10 a request for 3 passes three times, and a double
    /// click or a wallet retry with a fresh blockhash takes out twice what the
    /// owner meant. The chain will not accept the same signed transaction
    /// twice, but a re-signed one is a different transaction. So the request
    /// carries the `withdrawn` its builder saw and passes only while that
    /// value is unchanged: a second transaction built from the same state is
    /// refused whatever the balance.
    ///
    /// Accruals (`settle_dataset`) do not touch `withdrawn`, so a run that
    /// closes between building and sending does not break the request.
    pub fn withdraw(&mut self, amount: u64, withdrawn_before: u64) -> Result<()> {
        require!(amount > 0, GenoVaultError::WithdrawalIsZero);
        require!(
            self.withdrawn == withdrawn_before,
            GenoVaultError::WithdrawalIsStale
        );
        require!(
            amount <= self.available(),
            GenoVaultError::WithdrawalExceedsBalance
        );
        // Cannot overflow: `withdrawn + amount ≤ accrued`.
        self.withdrawn += amount;
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
///
/// Саме цей контур і задає стелю обом: його callback несе на акаунт і на ключ
/// читача більше за сусідні, тож `597 + 32 × N ≤ 1232` дає `N ≤ 19` (`T030`).
pub const REPORT_CIPHERTEXTS: usize = 13;

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

    /// Розкладка звіту мусить збігатися з тим, що віддає контур: 13
    /// шифротекстів із `build/frequencies_reveal.idarc`. Розійтись їм означало
    /// б приймати callback, який не влазить у власний акаунт.
    ///
    /// Друге твердження важливіше за перше й тому стоїть числом: callback
    /// розкриття це `597 + 32 × N` байтів проти стелі транзакції 1232, тобто
    /// `N ≤ 19`. Виміряно на живому кластері (`T030`) — при 24 вузол відмовляє
    /// доставляти вивід, а прогін мовчки падає в `failed`.
    #[test]
    fn the_report_matches_the_circuit() {
        assert_eq!(REPORT_CIPHERTEXTS, 13);
        assert_eq!(REPORT_CIPHERTEXTS, ACCUMULATOR_CIPHERTEXTS);
        assert!(
            597 + 32 * REPORT_CIPHERTEXTS <= 1232,
            "callback розкриття не вміщається в транзакцію"
        );
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
        // The second dataset gave 9 records — under the floor, declared zero.
        // The records are in the cohort and the buyer pays for them:
        // R = 1009, C = 1000, the bill is 100 000 × 1 009 / 1 000 = 100 900.
        let r = run(1_000_000, 1_009, &[(100_000, 1_000), (100_000, 0)]);

        assert_eq!(total(&r), 100_900, "the buyer pays for all 1 009 records");
        assert_eq!(
            gross_for(&r, 0).unwrap(),
            100_000,
            "above the floor: its own price for its own records, not scaled"
        );
        assert_eq!(
            gross_for(&r, 1).unwrap(),
            900,
            "the surplus goes to the dataset it came from — `T043`"
        );
    }

    #[test]
    fn a_dataset_of_one_person_is_paid_in_a_pool_with_a_clinic() {
        // `FR-009`: one record is always under a floor of ten. Before `T043`
        // its owner got nothing in any pool where someone cleared the floor.
        // 2 000 × 1 000 × 1 001 / 1 000 000 = 2 002, of which 2 000 is the
        // clinic's own price.
        let r = run(1_000_000, 1_001, &[(2_000, 1_000), (2_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 2_000);
        assert_eq!(gross_for(&r, 1).unwrap(), 2);
        assert_eq!(total(&r), 2_002);
    }

    #[test]
    fn the_surplus_is_split_equally_between_the_silent() {
        // Two datasets under the floor gave 1 and 9 records, but only the sum
        // is known: 10 surplus records at 1 000 per thousand is 10, five each.
        let r = run(1_000_000, 1_010, &[(1_000, 1_000), (1_000, 0), (1_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 1_000);
        assert_eq!(gross_for(&r, 1).unwrap(), 5);
        assert_eq!(gross_for(&r, 2).unwrap(), 5);
    }

    #[test]
    fn the_remainder_of_the_surplus_goes_back_to_the_buyer() {
        // 10 on three is 3 each and 1 left over. The order of the pool is the
        // buyer's, so it does not decide who gets the extra unit.
        let r = run(1_000_000, 1_010, &[(1_000, 1_000), (1_000, 0), (1_000, 0), (1_000, 0)]);

        assert_eq!(gross_for(&r, 1).unwrap(), 3);
        assert_eq!(total(&r), 1_009);
    }

    #[test]
    fn with_no_surplus_the_silent_get_nothing() {
        // R = C: the dataset under the floor gave no record under the filter —
        // there is nothing to pay it for, and nothing was taken from the buyer.
        let r = run(1_000_000, 1_000, &[(1_000, 1_000), (1_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 1_000);
        assert_eq!(gross_for(&r, 1).unwrap(), 0);
    }

    #[test]
    fn the_ceiling_cuts_the_surplus_not_the_owners_above_the_floor() {
        // The expensive dataset gave everything, the cheap one was suppressed:
        // the pool average is above the price the escrow was computed from.
        // The owner above the floor still gets exactly its own price; the
        // surplus gets what is left of the escrow.
        let r = run(1_000_001, 1_009, &[(1_000_000, 1_000), (1, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 1_000_000);
        assert_eq!(gross_for(&r, 1).unwrap(), 1);
        assert_eq!(total(&r), r.escrow_amount);
    }

    #[test]
    fn a_contribution_above_the_escrow_splits_the_escrow() {
        // Unreachable while contributions do not exceed claimed volumes, and
        // guarded rather than assumed: the escrow is split in proportion to
        // what was earned, and the surplus gets nothing.
        let r = run(150, 2_010, &[(1_000, 1_000), (1_000, 1_000), (1_000, 0)]);

        assert_eq!(gross_for(&r, 0).unwrap(), 75);
        assert_eq!(gross_for(&r, 1).unwrap(), 75);
        assert_eq!(gross_for(&r, 2).unwrap(), 0);
        assert_eq!(total(&r), 150);
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
        assert_eq!(gross_for(&r, 2).unwrap(), 668, "and it went to the silent dataset");
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

    fn balance(accrued: u64, withdrawn: u64) -> OwnerBalance {
        OwnerBalance {
            owner: Pubkey::new_unique(),
            accrued,
            withdrawn,
            bump: 255,
        }
    }

    fn code_of(result: Result<()>) -> u32 {
        match result.expect_err("a refusal was expected") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("expected a program error, got {other:?}"),
        }
    }

    #[test]
    fn a_withdrawal_moves_exactly_its_amount() {
        let mut b = balance(10, 0);
        b.withdraw(4, 0).unwrap();
        assert_eq!(b.withdrawn, 4);
        assert_eq!(b.accrued, 10, "a withdrawal does not touch the accrued total");
        assert_eq!(b.available(), 6);
    }

    #[test]
    fn the_same_request_does_not_go_through_twice() {
        // The balance covers two more such requests, which is why the refusal
        // here proves `withdrawn_before` and not the balance check.
        let mut b = balance(10, 0);
        b.withdraw(3, 0).unwrap();
        assert_eq!(
            code_of(b.withdraw(3, 0)),
            expected(GenoVaultError::WithdrawalIsStale)
        );
        assert_eq!(b.withdrawn, 3, "the refusal debited nothing");
    }

    #[test]
    fn a_request_built_from_the_new_state_goes_through() {
        let mut b = balance(10, 0);
        b.withdraw(3, 0).unwrap();
        b.withdraw(3, 3).unwrap();
        assert_eq!(b.available(), 4);
    }

    #[test]
    fn more_than_is_left_is_refused() {
        let mut b = balance(10, 4);
        assert_eq!(
            code_of(b.withdraw(7, 4)),
            expected(GenoVaultError::WithdrawalExceedsBalance)
        );
        b.withdraw(6, 4).unwrap();
        assert_eq!(b.available(), 0);
        assert_eq!(
            code_of(b.withdraw(1, 10)),
            expected(GenoVaultError::WithdrawalExceedsBalance)
        );
    }

    #[test]
    fn a_zero_withdrawal_is_refused() {
        // A zero transfer moves nothing but would leave a withdrawal event in
        // the log with no money behind it.
        let mut b = balance(10, 0);
        assert_eq!(
            code_of(b.withdraw(0, 0)),
            expected(GenoVaultError::WithdrawalIsZero)
        );
    }

    #[test]
    fn an_accrual_between_build_and_send_does_not_break_the_request() {
        let mut b = balance(10, 0);
        b.accrue(5).unwrap();
        b.withdraw(12, 0).unwrap();
        assert_eq!(b.available(), 3);
    }
}
