//! Перевірка рецепта «частоти й розподіли» (`T018`).
//!
//! Тести ганяють **скомпільований контур**, а не функцію мовою Rust: інтерпретатор
//! бере `build/<instruction>.arcis.ir` — рівно той артефакт, що поїде у вузли —
//! і виконує його на мок-обчислювачі. Тому тести вимагають попереднього
//! `scripts/wsl-build-circuits.sh`; запускати їх обгорткою
//! `scripts/wsl-test-circuits.sh`, яка збірку робить сама.
//!
//! Різниця істотна. Функція в `lib.rs` після `#[encrypted]` лишається звичайним
//! Rust'ом і на хості порахує що завгодно правильно — навіть те, що в контур не
//! компілюється або компілюється в інше. Питання «чи рахує MPC те саме, що я
//! написав» відповідає тільки IR.

use arcis::{testing::*, *};
use encrypted_ixs::circuits::{
    Frequencies, Record, Report, AGE_BINS, AGE_THRESHOLDS, BATCH, FILTER_ANY, MARKERS, MIN_COHORT,
};

/// Скільки польових елементів займає накопичувач після пакування.
///
/// Рахується з форми `Frequencies`, а не пишеться числом: коли в накопичувач
/// додасться поле, тест на межу транзакції має поїхати разом із ним.
const ACC_FIELDS: usize = 3 + AGE_BINS + 2 * MARKERS;

/// Ключ покупця. Справжнім бути не мусить — рецепт ним лише шифрує вихід.
fn buyer_key() -> ArcisX25519Pubkey {
    ArcisX25519Pubkey::from_base58(b"genovault-buyer")
}

fn owner_key() -> ArcisX25519Pubkey {
    ArcisX25519Pubkey::from_base58(b"genovault-owner")
}

/// Запис із маркерами, доповненими нулями до профілю рецепта.
fn record(sex: u8, age: u8, affected: u8, genotypes: &[u8]) -> Record {
    assert!(genotypes.len() <= MARKERS, "маркерів більше за профіль");
    let mut padded = [0u8; MARKERS];
    padded[..genotypes.len()].copy_from_slice(genotypes);
    Record {
        sex,
        age,
        affected,
        genotypes: padded,
    }
}

/// Шифрує батч на ключ власника — те саме, що робить браузер у `packages/crypto`.
///
/// Хвіст добивається порожніми записами; скільки з них справжні, каже `live`.
fn seal(records: &[Record]) -> [Enc<Shared, Record>; BATCH] {
    assert!(records.len() <= BATCH, "батч не вміщає стільки записів");
    std::array::from_fn(|slot| {
        let source = records
            .get(slot)
            .map(|r| record(r.sex, r.age, r.affected, &r.genotypes))
            .unwrap_or_else(|| record(0, 0, 0, &[]));
        Shared::new(owner_key()).from_arcis(source)
    })
}

fn empty_accumulator() -> Enc<Mxe, Pack<Frequencies>> {
    get_instruction("frequencies_init").eval(())
}

#[allow(clippy::too_many_arguments)]
fn fold(
    accumulator: Enc<Mxe, Pack<Frequencies>>,
    records: &[Record],
    min_age: u8,
    max_age: u8,
    sex_filter: u8,
    affected_filter: u8,
) -> Enc<Mxe, Pack<Frequencies>> {
    let live = u8::try_from(records.len()).expect("батч не довший за 255");
    get_instruction("frequencies_fold").eval((
        seal(records),
        accumulator,
        live,
        min_age,
        max_age,
        sex_filter,
        affected_filter,
    ))
}

/// Розкриття повертає звіт покупцю і оголошену кількість записів.
fn reveal(accumulator: Enc<Mxe, Pack<Frequencies>>) -> (Frequencies, u32, u32) {
    let (encrypted, disclosed): (Enc<Shared, Pack<Report>>, u32) =
        get_instruction("frequencies_reveal").eval((accumulator, buyer_key()));
    let report = encrypted.to_arcis().unpack();
    (
        Frequencies {
            included: report.included,
            male: report.male,
            affected: report.affected,
            age_at_least: report.age_at_least,
            allele_sum: report.allele_sum,
            allele_square_sum: report.allele_square_sum,
        },
        report.suppressed,
        disclosed,
    )
}

/// Когорта з `count` однакових записів — достатньо велика, щоб пройти `MIN_COHORT`.
fn cohort(count: usize, sex: u8, age: u8, affected: u8, genotypes: &[u8]) -> Vec<Record> {
    (0..count)
        .map(|_| record(sex, age, affected, genotypes))
        .collect()
}

/// Розподіл генотипів {0, 1, 2} з пари достатніх статистик.
///
/// Це та сама формула, за якою результат читатиме `apps/web`; тест на ній і
/// тримається — без неї `Σg` і `Σg²` це два числа без сенсу.
fn genotype_counts(included: u32, sum: u32, square_sum: u32) -> (u32, u32, u32) {
    assert!(square_sum >= sum, "Σg² не може бути меншим за Σg при g ∈ {{0,1,2}}");
    let homozygous = (square_sum - sum) / 2;
    let heterozygous = sum - 2 * homozygous;
    let reference = included - heterozygous - homozygous;
    (reference, heterozygous, homozygous)
}

#[test]
fn empty_accumulator_is_all_zeros() {
    let (report, suppressed, disclosed) = reveal(empty_accumulator());

    assert_eq!(report.included, 0);
    assert_eq!(disclosed, 0);
    assert_eq!(suppressed, 1, "порожня когорта менша за поріг, отже придушена");
}

#[test]
fn counts_every_record_when_no_filter_narrows() {
    let records = cohort(MIN_COHORT as usize, 1, 40, 1, &[1, 2, 0]);
    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, suppressed, disclosed) = reveal(acc);

    assert_eq!(suppressed, 0);
    assert_eq!(report.included, MIN_COHORT);
    assert_eq!(disclosed, MIN_COHORT, "оголошене число дорівнює тому, що у звіті");
    assert_eq!(report.male, MIN_COHORT);
    assert_eq!(report.affected, MIN_COHORT);
}

#[test]
fn padding_beyond_live_is_not_counted() {
    // Десять справжніх записів у батчі на BATCH місць. Решта — нулі, і при
    // фільтрі «будь-який вік» вони пройшли б як жінки віку 0, якби `live` не
    // існувало. Саме цей тест і тримає параметр `live` у сигнатурі.
    let records = cohort(MIN_COHORT as usize, 1, 40, 1, &[2]);
    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, _, _) = reveal(acc);

    assert_eq!(report.included, MIN_COHORT);
    assert_eq!(report.male, MIN_COHORT, "жодної «жінки віку 0» з хвоста батча");
}

#[test]
fn age_filter_excludes_records_outside_the_range() {
    let mut records = cohort(MIN_COHORT as usize, 1, 45, 0, &[1]);
    records.extend(cohort(5, 1, 80, 0, &[1]));

    let acc = fold(empty_accumulator(), &records, 40, 50, FILTER_ANY, FILTER_ANY);
    let (report, suppressed, _) = reveal(acc);

    assert_eq!(suppressed, 0);
    assert_eq!(report.included, MIN_COHORT, "п'ятеро 80-річних поза діапазоном");
    assert_eq!(report.allele_sum[0], MIN_COHORT, "їхні генотипи теж не увійшли");
}

#[test]
fn sex_and_affected_filters_narrow_the_cohort() {
    let mut records = cohort(MIN_COHORT as usize, 1, 50, 1, &[2]);
    records.extend(cohort(7, 0, 50, 1, &[2]));
    records.extend(cohort(7, 1, 50, 0, &[2]));

    let acc = fold(empty_accumulator(), &records, 0, u8::MAX, 1, 1);
    let (report, _, _) = reveal(acc);

    assert_eq!(report.included, MIN_COHORT);
    assert_eq!(report.male, MIN_COHORT);
    assert_eq!(report.affected, MIN_COHORT);
}

#[test]
fn genotype_distribution_is_exact_from_two_sums() {
    // Сім записів із генотипом 0, одинадцять із 1, п'ять із 2.
    let mut records = cohort(7, 0, 30, 0, &[0]);
    records.extend(cohort(11, 0, 30, 0, &[1]));
    records.extend(cohort(5, 0, 30, 0, &[2]));

    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, _, _) = reveal(acc);

    assert_eq!(report.included, 23);
    assert_eq!(report.allele_sum[0], 11 + 2 * 5);
    assert_eq!(report.allele_square_sum[0], 11 + 4 * 5);
    assert_eq!(
        genotype_counts(
            report.included,
            report.allele_sum[0],
            report.allele_square_sum[0]
        ),
        (7, 11, 5),
        "розподіл {{0,1,2}} відновлюється з Σg і Σg² точно"
    );
}

#[test]
fn age_thresholds_are_cumulative() {
    let mut records = cohort(4, 0, 25, 0, &[0]);
    records.extend(cohort(6, 0, 45, 0, &[0]));
    records.extend(cohort(3, 0, 85, 0, &[0]));

    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, _, _) = reveal(acc);

    assert_eq!(report.included, 13);
    // Пороги: 20, 30, 40, 50, 60, 70, 80, 90.
    assert_eq!(AGE_THRESHOLDS, [20, 30, 40, 50, 60, 70, 80, 90]);
    assert_eq!(report.age_at_least, [13, 9, 9, 3, 3, 3, 3, 0]);

    // Кошик — різниця сусідніх порогів.
    assert_eq!(report.age_at_least[0] - report.age_at_least[1], 4, "[20,30)");
    assert_eq!(report.age_at_least[2] - report.age_at_least[3], 6, "[40,50)");
    assert_eq!(report.age_at_least[6] - report.age_at_least[7], 3, "[80,90)");
}

#[test]
fn folds_accumulate_across_batches() {
    // Двадцять записів двома батчами по десять: підсумок має збігтись із тим,
    // що дав би один батч. Без цього порційність нічого не варта.
    let first = cohort(10, 1, 35, 1, &[1, 2]);
    let second = cohort(10, 0, 65, 0, &[2, 1]);

    let acc = fold(
        empty_accumulator(),
        &first,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let acc = fold(acc, &second, 0, u8::MAX, FILTER_ANY, FILTER_ANY);
    let (report, _, disclosed) = reveal(acc);

    assert_eq!(report.included, 20);
    assert_eq!(disclosed, 20);
    assert_eq!(report.male, 10);
    assert_eq!(report.affected, 10);
    assert_eq!(report.allele_sum[0], 10 * 1 + 10 * 2);
    assert_eq!(report.allele_sum[1], 10 * 2 + 10 * 1);
}

#[test]
fn cohort_below_the_threshold_discloses_nothing() {
    let records = cohort(MIN_COHORT as usize - 1, 1, 40, 1, &[2, 2, 2]);
    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, suppressed, disclosed) = reveal(acc);

    assert_eq!(suppressed, 1, "дев'ятеро — це менше за поріг");
    assert_eq!(report.included, 0, "розмір когорти теж не оголошується");
    assert_eq!(disclosed, 0, "ланцюгу нема за що платити");
    assert_eq!(report.male, 0);
    assert_eq!(report.affected, 0);
    assert_eq!(report.allele_sum[0], 0);
    assert_eq!(report.allele_square_sum[0], 0);
    assert_eq!(report.age_at_least, [0; AGE_BINS]);
}

#[test]
fn threshold_is_reached_exactly_at_min_cohort() {
    // Межа з обох боків одним тестом: на MIN_COHORT − 1 придушено, на
    // MIN_COHORT — ні. Помилка на одиницю тут коштує або витоку, або відмови
    // на кожному другому прогоні.
    let below = cohort(MIN_COHORT as usize - 1, 0, 30, 0, &[1]);
    let exact = cohort(MIN_COHORT as usize, 0, 30, 0, &[1]);

    let (_, suppressed_below, _) = reveal(fold(
        empty_accumulator(),
        &below,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    ));
    let (report_exact, suppressed_exact, disclosed_exact) = reveal(fold(
        empty_accumulator(),
        &exact,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    ));

    assert_eq!(suppressed_below, 1);
    assert_eq!(suppressed_exact, 0);
    assert_eq!(report_exact.included, MIN_COHORT);
    assert_eq!(disclosed_exact, MIN_COHORT);
}

#[test]
fn padded_markers_report_zero() {
    // Датасет на три маркери в профілі на 64: решта слотів мусить бути нулями,
    // інакше покупець побачить частоти маркерів, яких у датасеті немає.
    let records = cohort(MIN_COHORT as usize, 0, 30, 0, &[2, 2, 2]);
    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (report, _, _) = reveal(acc);

    for marker in 0..3 {
        assert_eq!(report.allele_sum[marker], 2 * MIN_COHORT);
    }
    for marker in 3..MARKERS {
        assert_eq!(report.allele_sum[marker], 0, "маркер {marker} поза датасетом");
        assert_eq!(report.allele_square_sum[marker], 0);
    }
}

#[test]
fn accumulator_fits_one_solana_transaction() {
    // Накопичувач їде між викликами через транзакцію, а в ній 1232 байти на
    // все — інструкції, підписи, адреси. Тому він пакується, і тому в нього не
    // можна просто «додати ще одне поле».
    // Шість `u32` на польовий елемент — не 255/32, а виміряне: стільки їх у
    // `build/frequencies_init.idarc` (139 полів → 24 шифротексти).
    let packed = ACC_FIELDS.div_ceil(6);
    let on_chain = 16 + packed * 32;

    assert!(
        on_chain < 1232,
        "накопичувач {ACC_FIELDS} полів → {on_chain} байтів, у транзакцію не влазить"
    );
}
