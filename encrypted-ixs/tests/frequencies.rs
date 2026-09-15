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
    MIN_CONTRIBUTION,
};

/// Скільки польових елементів займає накопичувач після пакування.
///
/// Рахується з форми `Frequencies`, а не пишеться числом: коли в накопичувач
/// додасться поле, тест на межу транзакції має поїхати разом із ним.
const ACC_FIELDS: usize = 4 + AGE_BINS + 2 * MARKERS;

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

/// Закриває поточний датасет: новий накопичувач, оголошений внесок і прапорець
/// «внесок нижчий за поріг».
fn close(accumulator: Enc<Mxe, Pack<Frequencies>>) -> (Enc<Mxe, Pack<Frequencies>>, u32, u32) {
    get_instruction("frequencies_close_dataset").eval(accumulator)
}

/// Розкриття повертає звіт покупцю, оголошену кількість записів пулу і
/// прапорець незакритого датасету.
fn reveal(accumulator: Enc<Mxe, Pack<Frequencies>>) -> (Frequencies, u32, u32, u32) {
    let (encrypted, disclosed, unclosed): (Enc<Shared, Pack<Report>>, u32, u32) =
        get_instruction("frequencies_reveal").eval((accumulator, buyer_key()));
    let report = encrypted.to_arcis().unpack();
    (
        Frequencies {
            included: report.included,
            // Внесок поточного датасету у звіт не потрапляє: він адресований
            // ланцюгу, а не покупцю. Після `close` він і так нуль.
            dataset_included: 0,
            male: report.male,
            affected: report.affected,
            age_at_least: report.age_at_least,
            allele_sum: report.allele_sum,
        },
        report.suppressed,
        disclosed,
        unclosed,
    )
}

/// Прогін одного датасету від згортки до звіту — рівно той порядок викликів,
/// яким його жене API: `fold`… → `close_dataset` → `reveal`.
///
/// Тести змісту звіту ходять сюди, а не в голий `reveal`, і тому кожен із них
/// заразом тримає сторожа порядку: розкриття із незакритим датасетом тут
/// падає, а не проходить тихо.
fn close_and_reveal(accumulator: Enc<Mxe, Pack<Frequencies>>) -> (Frequencies, u32, u32) {
    let (closed, _contribution, _below_floor) = close(accumulator);
    let (report, suppressed, disclosed, unclosed) = reveal(closed);
    assert_eq!(unclosed, 0, "після close_dataset незакритих датасетів немає");
    (report, suppressed, disclosed)
}

/// Когорта з `count` однакових записів — достатньо велика, щоб пройти `MIN_COHORT`.
fn cohort(count: usize, sex: u8, age: u8, affected: u8, genotypes: &[u8]) -> Vec<Record> {
    (0..count)
        .map(|_| record(sex, age, affected, genotypes))
        .collect()
}

#[test]
fn empty_accumulator_is_all_zeros() {
    let (report, suppressed, disclosed) = close_and_reveal(empty_accumulator());

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
    let (report, suppressed, disclosed) = close_and_reveal(acc);

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
    let (report, _, _) = close_and_reveal(acc);

    assert_eq!(report.included, MIN_COHORT);
    assert_eq!(report.male, MIN_COHORT, "жодної «жінки віку 0» з хвоста батча");
}

#[test]
fn age_filter_excludes_records_outside_the_range() {
    let mut records = cohort(MIN_COHORT as usize, 1, 45, 0, &[1]);
    records.extend(cohort(5, 1, 80, 0, &[1]));

    let acc = fold(empty_accumulator(), &records, 40, 50, FILTER_ANY, FILTER_ANY);
    let (report, suppressed, _) = close_and_reveal(acc);

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
    let (report, _, _) = close_and_reveal(acc);

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
    let (report, _, _) = close_and_reveal(acc);

    assert_eq!(report.included, 23);
    // Σg = 11·1 + 5·2. Розкласти це назад на трійку {0, 1, 2} нічим: `Σg²`
    // прибрано з рецепта (`T030`), бо вивід MPC мусить вміститись в одну
    // транзакцію. Покупець отримує середнє число копій алеля, а не розподіл
    // генотипів, і це сказано в каталозі, а не сховано.
    assert_eq!(report.allele_sum[0], 11 + 2 * 5);
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
    let (report, _, _) = close_and_reveal(acc);

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
    let (report, _, disclosed) = close_and_reveal(acc);

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
    let (report, suppressed, disclosed) = close_and_reveal(acc);

    assert_eq!(suppressed, 1, "дев'ятеро — це менше за поріг");
    assert_eq!(report.included, 0, "розмір когорти теж не оголошується");
    assert_eq!(disclosed, 0, "ланцюгу нема за що платити");
    assert_eq!(report.male, 0);
    assert_eq!(report.affected, 0);
    assert_eq!(report.allele_sum[0], 0);
    assert_eq!(report.age_at_least, [0; AGE_BINS]);
}

#[test]
fn threshold_is_reached_exactly_at_min_cohort() {
    // Межа з обох боків одним тестом: на MIN_COHORT − 1 придушено, на
    // MIN_COHORT — ні. Помилка на одиницю тут коштує або витоку, або відмови
    // на кожному другому прогоні.
    let below = cohort(MIN_COHORT as usize - 1, 0, 30, 0, &[1]);
    let exact = cohort(MIN_COHORT as usize, 0, 30, 0, &[1]);

    let (_, suppressed_below, _) = close_and_reveal(fold(
        empty_accumulator(),
        &below,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    ));
    let (report_exact, suppressed_exact, disclosed_exact) = close_and_reveal(fold(
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
    let (report, _, _) = close_and_reveal(acc);

    for marker in 0..3 {
        assert_eq!(report.allele_sum[marker], 2 * MIN_COHORT);
    }
    for marker in 3..MARKERS {
        assert_eq!(report.allele_sum[marker], 0, "маркер {marker} поза датасетом");
    }
}

#[test]
fn contribution_counts_only_the_current_dataset() {
    // Два датасети в одному прогоні. Внесок кожного оголошується на своєму
    // `close_dataset`, а підсумок пулу — один на всіх.
    let first = cohort(12, 1, 35, 1, &[1, 2]);
    let second = cohort(15, 0, 65, 0, &[2, 1]);

    let acc = fold(
        empty_accumulator(),
        &first,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (acc, first_contribution, first_below) = close(acc);
    let acc = fold(acc, &second, 0, u8::MAX, FILTER_ANY, FILTER_ANY);
    let (acc, second_contribution, second_below) = close(acc);

    let (report, suppressed, disclosed, unclosed) = reveal(acc);

    assert_eq!(first_contribution, 12);
    assert_eq!(second_contribution, 15);
    assert_eq!(first_below, 0);
    assert_eq!(second_below, 0);
    assert_eq!(unclosed, 0);
    assert_eq!(suppressed, 0);
    assert_eq!(report.included, 27, "підсумок пулу — сума двох датасетів");
    assert_eq!(disclosed, 27);
    assert_eq!(
        first_contribution + second_contribution,
        disclosed,
        "коли жоден внесок не придушений, вектор сходиться з підсумком пулу"
    );
}

#[test]
fn contribution_is_measured_after_filters_not_by_dataset_size() {
    // Датасет на 20 записів, під фільтр підпадають 11. Внеском іде 11 — і саме
    // це `FR-018a`: число рахує MPC, а не власник при реєстрації.
    let mut records = cohort(11, 1, 45, 1, &[1]);
    records.extend(cohort(9, 0, 45, 1, &[1]));

    let acc = fold(empty_accumulator(), &records, 0, u8::MAX, 1, FILTER_ANY);
    let (_, contribution, below) = close(acc);

    assert_eq!(contribution, 11);
    assert_eq!(below, 0);
}

#[test]
fn contribution_below_the_floor_is_not_disclosed() {
    // Дев'ять записів від першого власника — менше за поріг, тож внеском іде
    // нуль і прапорець. Але записи лишаються в пулі: відкотити їх з
    // накопичувача нічим, і саме тому покупець за них платить (ціна рахується
    // з `records_included`), а не отримує задарма.
    let small = cohort(MIN_CONTRIBUTION as usize - 1, 1, 40, 1, &[2]);
    let large = cohort(12, 1, 40, 1, &[2]);

    let acc = fold(empty_accumulator(), &small, 0, u8::MAX, FILTER_ANY, FILTER_ANY);
    let (acc, small_contribution, small_below) = close(acc);
    let acc = fold(acc, &large, 0, u8::MAX, FILTER_ANY, FILTER_ANY);
    let (acc, large_contribution, large_below) = close(acc);

    let (report, suppressed, disclosed, _) = reveal(acc);

    assert_eq!(small_contribution, 0, "внесок нижчий за поріг не називається");
    assert_eq!(small_below, 1, "але прапорець каже, що він був ненульовим");
    assert_eq!(large_contribution, 12);
    assert_eq!(large_below, 0);

    assert_eq!(suppressed, 0, "пул із 21 запису поріг когорти проходить");
    assert_eq!(report.included, 21, "придушені записи все одно у звіті покупця");
    assert_eq!(disclosed, 21);
    assert!(
        small_contribution + large_contribution < disclosed,
        "різниця між платою і сумою часток — це і є ціна придушення"
    );
}

#[test]
fn contribution_floor_is_reached_exactly_at_min_contribution() {
    // Межа з обох боків. Помилка на одиницю тут коштує або витоку про людину,
    // або неоплаченого датасету на кожному другому прогоні.
    let below = cohort(MIN_CONTRIBUTION as usize - 1, 0, 30, 0, &[1]);
    let exact = cohort(MIN_CONTRIBUTION as usize, 0, 30, 0, &[1]);

    let (_, below_contribution, below_flag) = close(fold(
        empty_accumulator(),
        &below,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    ));
    let (_, exact_contribution, exact_flag) = close(fold(
        empty_accumulator(),
        &exact,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    ));

    assert_eq!(below_contribution, 0);
    assert_eq!(below_flag, 1);
    assert_eq!(exact_contribution, MIN_CONTRIBUTION);
    assert_eq!(exact_flag, 0);
}

#[test]
fn closing_resets_the_counter_for_the_next_dataset() {
    // Найдорожча помилка цієї конструкції — лічильник, який не обнулився:
    // другий датасет отримав би плату за записи першого. Тест ганяє два
    // однакові датасети й вимагає однакових внесків, а не наростаючих.
    let records = cohort(11, 1, 50, 1, &[1]);

    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (acc, first, _) = close(acc);
    let acc = fold(acc, &records, 0, u8::MAX, FILTER_ANY, FILTER_ANY);
    let (acc, second, _) = close(acc);

    assert_eq!(first, 11);
    assert_eq!(second, 11, "другий внесок не тягне за собою перший");
    assert_eq!(reveal(acc).2, 22, "а пул рахує обидва");
}

#[test]
fn closing_an_empty_dataset_discloses_zero_without_touching_the_pool() {
    // Датасет, жоден запис якого не пройшов фільтр, закривається так само, як
    // будь-який інший: пул від цього не змінюється.
    let records = cohort(12, 1, 40, 1, &[1]);

    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );
    let (acc, paid, _) = close(acc);
    let (acc, empty, empty_flag) = close(acc);

    assert_eq!(paid, 12);
    assert_eq!(empty, 0);
    assert_eq!(empty_flag, 1, "нуль теж нижчий за поріг");
    assert_eq!(reveal(acc).2, 12, "порожнє закриття нічого не додало й не з'їло");
}

#[test]
fn reveal_flags_a_dataset_left_unclosed() {
    // Пропущений `close_dataset` не видно ні по звіту, ні по підсумку: записи
    // на місці, покупець платить, а внеску на них ніхто не оголосив, і частка
    // тихо розтечеться між рештою власників. Саме тому рецепт називає це
    // окремим виходом, а програма на ньому відхиляє розкриття (`T026`).
    let records = cohort(12, 1, 40, 1, &[1]);
    let acc = fold(
        empty_accumulator(),
        &records,
        0,
        u8::MAX,
        FILTER_ANY,
        FILTER_ANY,
    );

    let (_, _, disclosed, unclosed) = reveal(acc);

    assert_eq!(disclosed, 12, "записи в пулі, тобто оплачені");
    assert_eq!(unclosed, 1, "але внеску на них не оголошено");
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

    // Лічильник поточного датасету (`T019`) сів у той самий 24-й шифротекст, у
    // якому вже було вільне місце, — тобто коштував нуль байтів у транзакції.
    assert_eq!(packed, 24, "пакування накопичувача змінилось");

    // А вектор внесків на весь пул, як просив первісний текст `T019`, коштував
    // би вісім шифротекстів зверху. Це число і є причиною, з якої внесок
    // оголошується на `close_dataset`, а вектор збирається ончейн.
    let with_pool_vector = 16 + (ACC_FIELDS + 50).div_ceil(6) * 32;
    assert_eq!(with_pool_vector, 1040);
    assert!(
        with_pool_vector + 64 + 32 + 7 * 32 > 1232,
        "вектор на 50 датасетів мав би влізти разом із підписом і адресами callback'а"
    );
}
