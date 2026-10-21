use arcis::*;

/// Рецепти, які виконуються над зашифрованими даними (`FR-011`).
///
/// Тут «частоти й розподіли за полями» — перший рецепт каталогу. Кореляції,
/// GWAS-асоціація приходять задачею T045; логістична регресія (T044) — у
/// кінці модуля, з власним поясненням.
///
/// # Чому рецепт складається з чотирьох інструкцій, а не з однієї
///
/// Контур MPC має **сталий розмір, зафіксований при компіляції**: кількість
/// параметрів рецепта — властивість артефакту, а не аргумент виклику. Датасет
/// на 10 000 записів у такий контур не входить ні за яких обставин: це
/// 670 000 польових елементів, тобто ~21 МБ шифротексту, тоді як увесь вхід
/// обчислення мусить лежати або в аргументах транзакції (не більше 256
/// шифротекстів — індекс `ArgumentRef` це `u8`), або в Solana-акаунті, який
/// вузли читають самі.
///
/// Тому прогін іде порціями: `frequencies_init` створює порожній накопичувач,
/// `frequencies_fold` згортає в нього черговий батч записів, коли датасет
/// вичерпано — `frequencies_close_dataset` оголошує його внесок і звільняє
/// лічильник під наступний, а `frequencies_reveal` віддає результат покупцю,
/// коли вичерпано весь пул. Накопичувач між
/// викликами лежить ончейн під шифром MXE (`Enc<Mxe, _>`) і не розкривається
/// ніде: проміжна сума по 32 записах — це теж дані про людей, і побачити її не
/// повинен ніхто, включно з нами.
///
/// # Що саме накопичується
///
/// Не гістограми, а **достатні статистики**: суми, з яких те, що можна
/// порахувати, рахує читач результату. По маркеру накопичується `Σg` —
/// середнє число копій мінорного алеля по когорті. Так само з віком: замість
/// восьми кошиків накопичуються вісім **кумулятивних** лічильників «вік ≥
/// порогу», а кошик — різниця сусідніх.
///
/// # Чого тут немає і чому
///
/// `Σg²` тут було. Разом із `Σg` воно давало **точний** розподіл генотипів
/// {0, 1, 2} по маркеру:
///
/// ```text
/// n₂ = (Σg² − Σg) / 2      n₁ = Σg − 2·n₂      n₀ = n − n₁ − n₂
/// ```
///
/// Прибрано на `T030`, і не заради швидкості: вивід MPC повертається
/// **однією транзакцією**, а вузол відмовляється доставляти callback, що в неї
/// не вміщається («multi-tx-callbacks feature disabled»), і замість результату
/// надсилає відмову. З `Σg²` накопичувач це 140 польових елементів → 24
/// шифротексти → callback розкриття на 1365 байтів проти стелі 1232. Без нього
/// — 76 елементів → 13 шифротекстів → 1013 байтів. Продуктове рішення
/// 2026-09-14. Ціна названа вголос: покупець отримує середнє, а не розподіл.
///
/// Вартість арифметики тут ні до чого, і це **виміряно**: заміна `Σg²` на
/// лічильник гомозигот із порівнянням міняла вагу контуру на 0,5 %, а заміна
/// множення на `u32` вибором між двома `u8` — на 256 ACU з мільярдів. Вага
/// згортки на 87 % складається з розшифрування батча
/// (`auxiliary_circuit_weight`) і мережевого обміну (`network_size_weight`),
/// тобто з того, що дані взагалі беруться в руки.
///
/// # Межа рецепта (`FR-012`)
///
/// Частоти на когорті з одного запису — це сам запис. Тому `frequencies_reveal`
/// перевіряє розмір когорти **всередині MPC** і при `included < MIN_COHORT`
/// віддає нулі, включно з самим `included`. Перевірку неможливо обійти ні через
/// API, ні прямим викликом програми: її робить не той, хто питає, а той, хто
/// рахує.
///
/// # Профіль
///
/// `MARKERS` фіксується при компіляції, тому рецепт має один профіль на 64
/// маркери. Датасет із меншою кількістю доповнюється нулями: `markerCount` і
/// так публічний у каталозі, тож покупець знає, які слоти читати, а решта
/// віддає нульові суми. Ціна прогону при цьому не залежить від датасету —
/// властивість, потрібна `FR-015a` (верхня оцінка вартості наперед).
#[encrypted]
pub mod circuits {
    use arcis::*;

    /// Скільки маркерів вміщає профіль. Змінити це число — випустити новий
    /// рецепт із новим `comp_def`, а не «перебудувати той самий».
    pub const MARKERS: usize = 64;

    /// Скільки записів рецепт з'їдає за один виклик.
    ///
    /// Батч визначає і розмір буферного акаунта (`BATCH × 69 × 32` байтів), і
    /// кількість викликів на датасет. Обидва напрямки погані в надлишку: більший
    /// батч — довший контур і дорожча кожна транзакція, менший — більше викликів
    /// на той самий датасет.
    pub const BATCH: usize = 4;

    /// Пороги кумулятивних вікових лічильників.
    ///
    /// Кошик `[20, 30)` — це `age_at_least[0] − age_at_least[1]`; наймолодший
    /// кошик `(−∞, 20)` — це `included − age_at_least[0]`.
    pub const AGE_BINS: usize = 8;
    pub const AGE_THRESHOLDS: [u8; AGE_BINS] = [20, 30, 40, 50, 60, 70, 80, 90];

    /// Найменша когорта, про яку рецепт погоджується говорити (`FR-012`).
    pub const MIN_COHORT: u32 = 10;

    /// Найменший внесок датасету, який рецепт погоджується назвати вголос.
    ///
    /// Те саме число, що й `MIN_COHORT`, і навмисно окрема константа: це
    /// **інше рішення про інший канал розкриття**, яке просто збіглося
    /// значенням. `MIN_COHORT` захищає звіт покупця, `MIN_CONTRIBUTION` —
    /// число, за яким рахується оплата власнику (`FR-018a`), а воно
    /// оголошується відкрито й до того, як пул зібрано.
    ///
    /// Без цього порога `MIN_COHORT` не захищає ні від чого в прогоні по пулу:
    /// покупець добиває пул власними записами до десяти, і внесок «датасет X
    /// дав 1 запис під фільтр [чоловік, 47, уражений]» стає прямою відповіддю
    /// про конкретну людину. Для датасету на одну людину (`FR-009a`) — прямою
    /// відповіддю про членство.
    ///
    /// **Ціна рішення, яку треба казати вголос:** записи датасету, що не
    /// дотягнув до порога, все одно входять у звіт покупця — відкотити їх з
    /// накопичувача нічим, для цього довелось би вести всі суми ще й окремо на
    /// датасет, а це подвоєний накопичувач, який у транзакцію не влазить. Тому
    /// такий власник не отримує нічого за використані записи. Щоб на цьому не
    /// наживався покупець, ціна прогону рахується з `records_included` (весь
    /// пул), а не з суми оголошених внесків: платить він за все, що отримав, а
    /// частка придушеного датасету дістається решті власників пулу.
    pub const MIN_CONTRIBUTION: u32 = MIN_COHORT;

    /// Значення фільтра «будь-яке». Ділить простір із самими значеннями полів
    /// (`sex` і `affected` — 0 або 1), тому окремого прапорця не потрібно.
    pub const FILTER_ANY: u8 = 2;

    /// Запис у тій самій розкладці, в якій його шифрує браузер.
    ///
    /// Порядок полів дублює `toFieldElements` у `packages/crypto`: MPC читає
    /// плаский вектор польових елементів і заголовка, з якого дізнався б
    /// розкладку, не має. Розійтись цим двом місцям не дасть round-trip тест
    /// у `encrypted-ixs/tests/frequencies.rs`.
    pub struct Record {
        pub sex: u8,
        pub age: u8,
        pub affected: u8,
        pub genotypes: [u8; MARKERS],
    }

    /// Накопичувач між батчами. Живе ончейн під шифром MXE і не розкривається.
    pub struct Frequencies {
        /// Скільки записів пройшло фільтри — те саме число, що йде в розподіл
        /// плати (`FR-018a`). Рахується тут, а не в API, саме тому, що інакше
        /// його підміняє власник датасету.
        pub included: u32,
        /// Скільки записів дав **поточний** датасет пулу — з тих, що вже
        /// згорнуті. `frequencies_close_dataset` оголошує це число і обнуляє
        /// лічильник перед наступним датасетом.
        ///
        /// Одне поле замість вектора на весь пул — див. коментар до
        /// `frequencies_close_dataset`.
        pub dataset_included: u32,
        /// `Σ sex` по когорті. Жінок — це `included − male`, бо `sex` це 0 або 1.
        pub male: u32,
        /// `Σ affected`. Неуражених — `included − affected`.
        pub affected: u32,
        pub age_at_least: [u32; AGE_BINS],
        pub allele_sum: [u32; MARKERS],
    }

    /// Те, що бачить покупець. Відрізняється від накопичувача рівно одним полем.
    pub struct Report {
        pub included: u32,
        /// 1, якщо когорта менша за `MIN_COHORT`. Тоді решта полів — нулі, і
        /// `included` теж нуль: інакше сам розмір когорти був би відповіддю на
        /// питання «чи є в датасеті хоч одна людина ось із такими ознаками».
        pub suppressed: u32,
        pub male: u32,
        pub affected: u32,
        pub age_at_least: [u32; AGE_BINS],
        pub allele_sum: [u32; MARKERS],
    }

    /// Порожній накопичувач під новий прогін.
    ///
    /// Окрема інструкція, а не нулі з боку програми: нулі, зашифровані ключем
    /// MXE, може зробити тільки сам MXE. Програма не має цього ключа — у цьому
    /// й суть (`FR-004a`).
    #[instruction]
    pub fn frequencies_init() -> Enc<Mxe, Pack<Frequencies>> {
        let empty = Frequencies {
            included: 0,
            dataset_included: 0,
            male: 0,
            affected: 0,
            age_at_least: [0u32; AGE_BINS],
            allele_sum: [0u32; MARKERS],
        };
        Mxe::get().from_arcis(Pack::new(empty))
    }

    /// Згортає черговий батч записів у накопичувач.
    ///
    /// `live` — скільки записів у батчі справжні. Останній батч датасету майже
    /// ніколи не повний, а контур має сталу довжину, тож хвіст доводиться чимось
    /// добивати. Без `live` добиті записи потрапили б у когорту: нулі в усіх
    /// полях — це цілком валідний запис (жінка, вік 0, не уражена), і при
    /// фільтрі «будь-який вік» він порахувався б як людина.
    ///
    /// Параметри фільтра відкриті навмисно. Вони і так публічні: власник звіряє
    /// їх зі своєю згодою (`FR-006`), а незалежний звіряч журналу — з тим, що
    /// записано в `Run` (`FR-025`). Зашифрувати їх означало б зробити згоду
    /// неперевірною, нічого не приховавши.
    #[instruction]
    pub fn frequencies_fold(
        batch: [Enc<Shared, Record>; BATCH],
        accumulator: Enc<Mxe, Pack<Frequencies>>,
        live: u8,
        min_age: u8,
        max_age: u8,
        sex_filter: u8,
        affected_filter: u8,
    ) -> Enc<Mxe, Pack<Frequencies>> {
        let mut acc = accumulator.to_arcis().unpack();

        for slot in 0..BATCH {
            let record = batch[slot].to_arcis();

            let present = (slot as u8) < live;
            let age_ok = record.age >= min_age && record.age <= max_age;
            let sex_ok = sex_filter == FILTER_ANY || record.sex == sex_filter;
            let affected_ok = affected_filter == FILTER_ANY || record.affected == affected_filter;
            let counted = present && age_ok && sex_ok && affected_ok;

            // Внесок запису поза когортою обнуляється вибором, а не множенням
            // на маску. Вибір між двома `u8` коштує одного множення на біт
            // умови; множення двох `u32` у полі на 255 біт тягне за собою ще й
            // звуження результату, а звуження — це побітовий розклад. На
            // 64 маркери різниця виходить у рази, і вона виміряна: див.
            // `docs/SCRATCHPAD.md`, блок T018.
            acc.included += if counted { 1u32 } else { 0u32 };
            // Той самий біт `counted` веде два лічильники: підсумок пулу і
            // внесок поточного датасету. Розійтись їм ніде — саме тому міра
            // внеску (`FR-018`) однакова для всіх учасників за побудовою, а не
            // за домовленістю.
            acc.dataset_included += if counted { 1u32 } else { 0u32 };
            acc.male += if counted { record.sex } else { 0u8 } as u32;
            acc.affected += if counted { record.affected } else { 0u8 } as u32;

            for bin in 0..AGE_BINS {
                let reached = record.age >= AGE_THRESHOLDS[bin];
                acc.age_at_least[bin] += if counted && reached { 1u32 } else { 0u32 };
            }

            for marker in 0..MARKERS {
                let taken = if counted { record.genotypes[marker] } else { 0u8 };
                acc.allele_sum[marker] += taken as u32;
            }
        }

        // Свіжий nonce на кожну згортку, а не `nonce + 1` від входу. Rescue
        // працює в режимі CTR: за того самого ключа MXE повторений nonce дає
        // повторену гаму, а згортка може виконатись двічі — черга обчислень
        // цього не забороняє.
        Mxe::get().from_arcis(Pack::new(acc))
    }

    /// Закриває поточний датасет пулу: оголошує його внесок і обнуляє лічильник.
    ///
    /// # Чому внесок оголошується тут, а не вектором наприкінці
    ///
    /// `FR-018a` просить кількість записів **на кожен датасет** прогону, і
    /// напрошується вектор `[u32; POOL]` у накопичувачі. Він туди не влазить.
    /// Накопичувач їде назад у транзакції callback'а, а в ній 1232 байти на
    /// все; зараз це 140 полів → 24 шифротексти → 784 байти, і місця лишається
    /// рівно на підписи й адреси. Вектор на 50 датасетів — це 190 полів → 32
    /// шифротексти → 1040 байтів, і транзакція перестає складатись.
    ///
    /// Але вектор і не потрібен: внесок датасету відомий точно тоді, коли
    /// згорнуто його останній батч, і возити його до кінця прогону нема сенсу.
    /// Тому рецепт веде один лічильник поточного датасету, а вектор збирається
    /// ончейн у `RunContribution` (`T046`) — по запису на виклик. Побічний
    /// наслідок приємний: розмір пулу перестає бути властивістю контуру.
    ///
    /// # Що саме оголошується
    ///
    /// Внесок менший за `MIN_CONTRIBUTION` оголошується нулем — з тієї ж
    /// причини, з якої `frequencies_reveal` придушує малу когорту, і тим самим
    /// способом: рішення ухвалює той, хто рахує, а не той, хто питає. Витікає
    /// рівно один біт, і він названий: `below_floor`.
    ///
    /// `below_floor` існує окремо від нульового внеску, бо нуль двозначний —
    /// «датасет не дав жодного запису під фільтр» і «дав, але замало, щоб про
    /// це говорити» це різні речі для власника, який дивиться на свій екран
    /// нарахувань (`FR-018b`), і однакові для гаманця.
    #[instruction]
    pub fn frequencies_close_dataset(
        accumulator: Enc<Mxe, Pack<Frequencies>>,
    ) -> (Enc<Mxe, Pack<Frequencies>>, u32, u32) {
        let mut acc = accumulator.to_arcis().unpack();

        let payable = acc.dataset_included >= MIN_CONTRIBUTION;
        let keep: u32 = if payable { 1 } else { 0 };
        let contribution = acc.dataset_included * keep;
        let below_floor = 1 - keep;

        // Обнуляється тільки лічильник датасету. Записи, які він дав, лишаються
        // в `included` і в сумах: відкотити їх нічим, і саме тому за них платить
        // покупець, а не отримує задарма — див. `MIN_CONTRIBUTION`.
        acc.dataset_included = 0;

        (
            Mxe::get().from_arcis(Pack::new(acc)),
            contribution.reveal(),
            below_floor.reveal(),
        )
    }

    /// Закриває прогін: віддає звіт покупцю і оголошує кількість записів.
    ///
    /// Два виходи, бо в них різні адресати. Звіт зашифрований на ключ покупця й
    /// не читається ні платформою, ні власником датасету. `records_included`
    /// оголошується відкрито: за ним програма рахує нарахування (`FR-018b`), і
    /// приховати його від програми означало б не мати чим платити. Приватність
    /// сум — окрема задача (`FR-021`, T054-T055); на M1 суми публічні, і це
    /// сказано вголос у віхах.
    ///
    /// Третій вихід — `unclosed` — сторож порядку викликів. Якщо останній
    /// датасет пулу не закрито, його записи вже в `included` (тобто покупець за
    /// них заплатить), але внеску на них ніхто не оголосив, і частка мовчки
    /// розтечеться між рештою власників. Помилка на один пропущений виклик, і
    /// вона нічим себе не виявляє — тому рецепт її називає, а програма на
    /// `unclosed = 1` відхиляє розкриття (`T026`). При правильному порядку це
    /// завжди нуль, тож і витоку тут немає.
    #[instruction]
    pub fn frequencies_reveal(
        accumulator: Enc<Mxe, Pack<Frequencies>>,
        buyer: ArcisX25519Pubkey,
    ) -> (Enc<Shared, Pack<Report>>, u32, u32) {
        let acc = accumulator.to_arcis().unpack();

        let disclosable = acc.included >= MIN_COHORT;
        let keep: u32 = if disclosable { 1 } else { 0 };

        let mut report = Report {
            included: acc.included * keep,
            suppressed: 1 - keep,
            male: acc.male * keep,
            affected: acc.affected * keep,
            age_at_least: [0u32; AGE_BINS],
            allele_sum: [0u32; MARKERS],
        };

        for bin in 0..AGE_BINS {
            report.age_at_least[bin] = acc.age_at_least[bin] * keep;
        }
        for marker in 0..MARKERS {
            report.allele_sum[marker] = acc.allele_sum[marker] * keep;
        }

        // Придушена когорта оголошує нуль. Це і є та відповідь, яку має чути
        // ланцюг: прогін нікого не включив, платити нема за що, повернути
        // депозит повністю (`FR-016`).
        let records_included = report.included.reveal();
        let unclosed: u32 = if acc.dataset_included > 0 { 1 } else { 0 };

        (
            Shared::new(buyer).from_arcis(Pack::new(report)),
            records_included,
            unclosed.reveal(),
        )
    }

    // ---------------------------------------------------------------------
    // Logistic regression (`T044`).
    //
    // # One pass, one Newton step
    //
    // A pass over the pool is the expensive thing here: 10 000 records are
    // 2 500 folds and 3.3-3.7 hours (`T033`), so an iterative fit that walks
    // the pool once per iteration multiplies that by the number of
    // iterations. The recipe walks it once. The folds accumulate the exact
    // integer sufficient statistics `Σx`, `Σxy`, `Σxxᵀ`, and the model is one
    // Newton step of the logistic log-likelihood from `β = 0`, where every
    // `p` is `1/2` and every Newton weight `p(1 − p)` is `1/4`:
    //
    // ```text
    // β = 4 · (Cov(x) + ridge)⁻¹ · Cov(x, y)
    // β₀ = 4 · (ȳ − 1/2) − β · x̄
    // ```
    //
    // The price is said out loud: this is the quadratic approximation of the
    // likelihood at zero, so the coefficients are shrunk compared with the
    // fully converged fit, and the direction is the one a linear probability
    // model would give. How much that costs in ranking quality is what the
    // `SC-002` measurement in `encrypted-ixs/tests/regression.rs` is for.
    //
    // # Why the circuit does not solve the system itself
    //
    // It was written to, and measured: Arcis `f64` is fixed point, and every
    // multiplication truncates 52 bits — a bit decomposition, ~100 M ACU — and
    // every division is a Chebyshev series, ~650 M ACU. The solve for ten
    // features is ~500 multiplications and ~21 divisions, ~64 G ACU against a
    // ceiling of 5 G per computation; three features already weighed 8.3 G.
    // Splitting it over several computations needs the half-solved matrix in
    // a callback, and 66 fixed-point values do not fit in one transaction.
    //
    // So the reveal checks the thresholds inside MPC — that is the part the
    // buyer must not be able to skip — and hands the buyer the moments under
    // the buyer's key; the Newton step runs in the buyer's browser
    // (`packages/shared/src/regression.ts`). Decision of 2026-10-21. The
    // buyer sees second moments of the chosen features over a cohort of at
    // least `EVENTS_PER_PARAMETER · (k + 1)` — aggregates of the same kind as
    // `Σg` in the frequencies report, and `FR-011` allows "a model or a
    // statistic".
    //
    // # What the buyer chooses
    //
    // Up to `FEATURES` features out of `sex`, `age` and the 64 markers; the
    // target is `affected`, the only binary phenotype a record has. That is
    // also why this recipe has no `affected` filter: it would make the
    // target constant. The choice travels as plain parameters, like the
    // frequencies filters, because the owner checks it against the consent
    // (`FR-006`) and the auditor against `Run` (`FR-025`).
    // ---------------------------------------------------------------------

    /// How many features one model takes, unused slots included.
    pub const FEATURES: usize = 10;

    /// `Σ xⱼxₖ` for `j ≤ k` — the upper triangle of `XᵀX`, row by row.
    pub const FEATURE_PAIRS: usize = FEATURES * (FEATURES + 1) / 2;

    /// Feature codes. A marker is `FEATURE_MARKER_BASE + index`.
    pub const FEATURE_SEX: u8 = 0;
    pub const FEATURE_AGE: u8 = 1;
    pub const FEATURE_MARKER_BASE: u8 = 2;
    /// An unused slot. It reads as a constant zero column, which the ridge in
    /// the buyer's solve turns into a zero coefficient rather than a singular
    /// system.
    pub const FEATURE_NONE: u8 = 255;

    /// Records per model parameter the recipe insists on before it says
    /// anything (`FR-012`).
    ///
    /// `MIN_COHORT` alone is not enough here. Eleven coefficients fitted on
    /// ten records reproduce the records, so the cohort has to grow with the
    /// model: `n ≥ EVENTS_PER_PARAMETER · (k + 1)` for `k` used features.
    pub const EVENTS_PER_PARAMETER: u32 = 10;

    /// The regression accumulator between folds. Lives on chain under the MXE
    /// key and is never revealed.
    ///
    /// `included` is `n`, and `XᵀX` with the intercept column is `n`, `Σx`
    /// and `Σxxᵀ` — so no separate count is kept for the intercept.
    pub struct Regression {
        /// Records that passed the filters — the number the settlement pays
        /// for (`FR-018a`), counted here for the same reason as in
        /// `Frequencies`.
        pub included: u32,
        /// Records of the **current** dataset; see `frequencies_close_dataset`.
        pub dataset_included: u32,
        /// `Σy` — affected records in the cohort.
        pub cases: u32,
        pub sum_x: [u32; FEATURES],
        pub sum_xy: [u32; FEATURES],
        /// `u64`, not `u32`: `age` reaches 200, so `Σ age²` would wrap a `u32`
        /// at 107 374 records, and the pool has no cap in records.
        pub sum_xx: [u64; FEATURE_PAIRS],
    }

    /// What the buyer sees: the moments the model is solved from.
    ///
    /// Every sum is a `u32` here, while the accumulator keeps `Σxxᵀ` in
    /// `u64`. The reveal goes back in one callback transaction, and 55 `u64`
    /// would make it ~23 ciphertexts against the 13 of the frequencies report,
    /// which already takes 1 013 of the 1 232 bytes. A sum that does not fit
    /// a `u32` suppresses the report under its own flag instead of wrapping.
    pub struct Moments {
        pub included: u32,
        pub cases: u32,
        /// 1 if the cohort is too small for this many features or one of the
        /// classes is too small. Everything else is zero then.
        pub suppressed: u32,
        /// 1 if a sum outgrew a `u32` — `Σ age²` past ~107 000 records.
        /// Everything else is zero then, `suppressed` included.
        pub oversized: u32,
        pub sum_x: [u32; FEATURES],
        pub sum_xy: [u32; FEATURES],
        pub sum_xx: [u32; FEATURE_PAIRS],
    }

    /// The value of feature `code` in `record`; zero for an unknown code.
    ///
    /// `code` is a plain parameter, so the comparisons are public and each
    /// selection is linear in the secret value.
    fn feature_value(record: &Record, code: u8) -> u8 {
        let mut value = 0u8;
        if code == FEATURE_SEX {
            value = record.sex;
        }
        if code == FEATURE_AGE {
            value = record.age;
        }
        for marker in 0..MARKERS {
            if code == FEATURE_MARKER_BASE + marker as u8 {
                value = record.genotypes[marker];
            }
        }
        value
    }

    /// An empty regression accumulator for a new run.
    #[instruction]
    pub fn regression_init() -> Enc<Mxe, Pack<Regression>> {
        let empty = Regression {
            included: 0,
            dataset_included: 0,
            cases: 0,
            sum_x: [0u32; FEATURES],
            sum_xy: [0u32; FEATURES],
            sum_xx: [0u64; FEATURE_PAIRS],
        };
        Mxe::get().from_arcis(Pack::new(empty))
    }

    /// Folds the next batch into the regression accumulator.
    ///
    /// The batch is the same `Record` as for frequencies — the buffer on chain
    /// does not know which recipe reads it. `live` means what it means in
    /// `frequencies_fold`.
    #[instruction]
    pub fn regression_fold(
        batch: [Enc<Shared, Record>; BATCH],
        accumulator: Enc<Mxe, Pack<Regression>>,
        live: u8,
        min_age: u8,
        max_age: u8,
        sex_filter: u8,
        features: [u8; FEATURES],
    ) -> Enc<Mxe, Pack<Regression>> {
        let mut acc = accumulator.to_arcis().unpack();

        for slot in 0..BATCH {
            let record = batch[slot].to_arcis();

            let present = (slot as u8) < live;
            let age_ok = record.age >= min_age && record.age <= max_age;
            let sex_ok = sex_filter == FILTER_ANY || record.sex == sex_filter;
            let counted = present && age_ok && sex_ok;

            acc.included += if counted { 1u32 } else { 0u32 };
            acc.dataset_included += if counted { 1u32 } else { 0u32 };
            let y = if counted { record.affected } else { 0u8 };
            acc.cases += y as u32;

            // A record outside the cohort contributes a zero row, so every
            // sum below is gated by `counted` once, here.
            let mut x = [0u8; FEATURES];
            for f in 0..FEATURES {
                let value = feature_value(&record, features[f]);
                x[f] = if counted { value } else { 0u8 };
            }

            let mut pair = 0;
            for j in 0..FEATURES {
                acc.sum_x[j] += x[j] as u32;
                acc.sum_xy[j] += (x[j] * y) as u32;
                for k in j..FEATURES {
                    acc.sum_xx[pair] += (x[j] as u64) * (x[k] as u64);
                    pair += 1;
                }
            }
        }

        Mxe::get().from_arcis(Pack::new(acc))
    }

    /// Closes the current dataset of the pool. Same rule and same reasons as
    /// `frequencies_close_dataset`; only the accumulator differs.
    #[instruction]
    pub fn regression_close_dataset(
        accumulator: Enc<Mxe, Pack<Regression>>,
    ) -> (Enc<Mxe, Pack<Regression>>, u32, u32) {
        let mut acc = accumulator.to_arcis().unpack();

        let payable = acc.dataset_included >= MIN_CONTRIBUTION;
        let keep: u32 = if payable { 1 } else { 0 };
        let contribution = acc.dataset_included * keep;
        let below_floor = 1 - keep;

        acc.dataset_included = 0;

        (
            Mxe::get().from_arcis(Pack::new(acc)),
            contribution.reveal(),
            below_floor.reveal(),
        )
    }

    /// Checks the cohort against the model and hands the moments to the buyer.
    ///
    /// `features` is the same array the folds got — the program passes it
    /// from `Run.recipe_params`, as it does for the filters. It decides how
    /// big the cohort has to be: the reveal counts the used slots.
    ///
    /// The outputs mirror `frequencies_reveal`: the report under the buyer's
    /// key, `records_included` in the open for the settlement, and the
    /// `unclosed` guard. A suppressed or oversized report declares zero
    /// records, so the deposit goes back in full (`FR-016`).
    #[instruction]
    pub fn regression_reveal(
        accumulator: Enc<Mxe, Pack<Regression>>,
        buyer: ArcisX25519Pubkey,
        features: [u8; FEATURES],
    ) -> (Enc<Shared, Pack<Moments>>, u32, u32) {
        let acc = accumulator.to_arcis().unpack();

        let mut used: u32 = 0;
        for f in 0..FEATURES {
            if features[f] != FEATURE_NONE {
                used += 1;
            }
        }
        let required = EVENTS_PER_PARAMETER * (used + 1);
        let required = if required > MIN_COHORT { required } else { MIN_COHORT };
        let controls = acc.included - acc.cases;
        let disclosable =
            acc.included >= required && acc.cases >= MIN_COHORT && controls >= MIN_COHORT;

        let mut fits = true;
        for pair in 0..FEATURE_PAIRS {
            fits = fits && acc.sum_xx[pair] <= u32::MAX as u64;
        }

        let keep: u32 = if disclosable && fits { 1 } else { 0 };

        let mut report = Moments {
            included: acc.included * keep,
            cases: acc.cases * keep,
            suppressed: if disclosable { 0 } else { 1 },
            oversized: if fits { 0 } else { 1 },
            sum_x: [0u32; FEATURES],
            sum_xy: [0u32; FEATURES],
            sum_xx: [0u32; FEATURE_PAIRS],
        };
        // An oversized cohort says only that: whether it was also too small
        // for the model is not the buyer's business.
        report.suppressed = report.suppressed * (1 - report.oversized);
        for j in 0..FEATURES {
            report.sum_x[j] = acc.sum_x[j] * keep;
            report.sum_xy[j] = acc.sum_xy[j] * keep;
        }
        for pair in 0..FEATURE_PAIRS {
            let narrowed = if fits { acc.sum_xx[pair] as u32 } else { 0u32 };
            report.sum_xx[pair] = narrowed * keep;
        }

        let records_included = report.included.reveal();
        let unclosed: u32 = if acc.dataset_included > 0 { 1 } else { 0 };

        (
            Shared::new(buyer).from_arcis(Pack::new(report)),
            records_included,
            unclosed.reveal(),
        )
    }
}
