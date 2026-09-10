use anchor_lang::prelude::*;

/// Помилки програми.
///
/// `FR-008` вимагає, щоб відмова називала конкретне порушене обмеження, а не
/// «доступ заборонено». Тому варіанти тут дрібні й іменні: кожен відповідає
/// рівно одній перевірці, і повідомлення можна показати покупцю без здогадок.
#[error_code]
pub enum GenoVaultError {
    #[msg("Обчислення перервано")]
    AbortedComputation,
    #[msg("Комісія платформи перевищує дозволену межу")]
    FeeBpsTooHigh,
    #[msg("Ідентифікатор датасету порожній або довший за 32 байти")]
    DatasetIdLength,
    #[msg("Датасет без записів не реєструється")]
    EmptyDataset,
    #[msg("Відбиток вмісту порожній")]
    EmptyContentHash,
    #[msg("Ви не власник цього датасету")]
    NotDatasetOwner,
    #[msg("Датасет знято з каталогу")]
    DatasetNotActive,
    #[msg("Вміст датасету не змінився — нова версія не потрібна")]
    DatasetContentUnchanged,
    #[msg("Лічильник версій датасету переповнився")]
    DatasetVersionOverflow,
    #[msg("Згода, яка нічого не дозволяє, — це відкликання, а не згода")]
    ConsentAllowsNothing,
    #[msg("Строк дії згоди вже минув на момент її запису")]
    ConsentExpiryInPast,
    #[msg("Згоду вже відкликано")]
    ConsentAlreadyRevoked,
    #[msg("Згоду відкликано")]
    ConsentIsRevoked,
    #[msg("Строк дії згоди минув")]
    ConsentExpired,
    #[msg("Невідомий тип використання")]
    UnknownUseType,
    #[msg("Невідома категорія покупця")]
    UnknownBuyerCategory,
    #[msg("Цей тип використання прямо заборонений власником")]
    UseTypeForbidden,
    #[msg("Цей тип використання не дозволений згодою")]
    UseTypeNotAllowed,
    #[msg("Ця категорія покупця не дозволена згодою")]
    BuyerCategoryNotAllowed,
    #[msg("Лічильник версій згоди переповнився")]
    ConsentVersionOverflow,
    #[msg("Не передано попередню версію згоди")]
    PreviousConsentMissing,
    #[msg("Прогін без жодного датасету")]
    RunWithoutDatasets,
    #[msg("У прогоні забагато датасетів")]
    RunTooManyDatasets,
    #[msg("Датасет повторюється у складі прогону")]
    RunDuplicateDataset,
    #[msg("Прогін не в статусі «прийнято»")]
    RunNotAccepted,
    #[msg("Прогін не виконується")]
    RunNotRunning,
    #[msg("Прогін уже в кінцевому статусі")]
    RunIsFinal,
    #[msg("Результат прогону вже записано")]
    RunResultAlreadyRecorded,
    #[msg("Результату прогону ще немає")]
    RunResultMissing,
    #[msg("Усім датасетам прогону вже нараховано")]
    RunAlreadySettled,
    #[msg("Нарахування перевищує заблоковане в депозиті")]
    RunSettlementExceedsEscrow,
    #[msg("Переповнення суми нарахувань")]
    RunSettlementOverflow,
    #[msg("Нараховано не всім датасетам прогону")]
    RunSettlementIncomplete,
    #[msg("Платформу поставлено на паузу — нові прогони не приймаються")]
    PlatformPaused,
    #[msg("Такого рецепта немає в каталозі")]
    UnknownRecipe,
    #[msg("Склад прогону передано неповними парами «датасет + згода»")]
    RunAccountsMalformed,
    #[msg("Власник ще не задав згоди для цього датасету")]
    ConsentMissing,
    #[msg("Передана згода належить іншому датасету")]
    ConsentDatasetMismatch,
    #[msg("Передана згода не є чинною версією")]
    ConsentVersionStale,
    #[msg("Вартість прогону не вміщається в u64")]
    RunEscrowOverflow,
    #[msg("Вартість прогону перевищує названу покупцем межу")]
    RunEscrowAboveMax,
    #[msg("Цю дію може виконати лише диспетчер прогону")]
    RunNotDispatcher,
    #[msg("Параметри рецепта не проходять перевірку")]
    RecipeParamsInvalid,
    #[msg("Попереднє обчислення прогону ще не повернулось")]
    AccumulatorBusy,
    #[msg("Накопичувач прогону ще не створено")]
    AccumulatorNotReady,
    #[msg("Накопичувач прогону вже створено")]
    AccumulatorAlreadyReady,
    #[msg("Callback належить іншому обчисленню")]
    AccumulatorOffsetMismatch,
    #[msg("Буферний акаунт не має заголовка")]
    BatchBufferMalformed,
    #[msg("Буферний акаунт належить іншому прогону")]
    BatchBufferForeignRun,
    #[msg("Буферний акаунт ще не дорощено до розміру батча")]
    BatchBufferTooSmall,
    #[msg("Буферний акаунт уже такого розміру або більший")]
    BatchBufferNotGrowing,
    #[msg("Запис виходить за межі буферного акаунта")]
    BatchWriteOutOfBounds,
    #[msg("У батчі має бути від 1 до 32 живих записів")]
    BatchLiveOutOfRange,
    #[msg("Усі датасети прогону вже закриті")]
    RunPoolExhausted,
    #[msg("У прогоні лишились незакриті датасети")]
    RunPoolNotExhausted,
    #[msg("Лічильник згорнутих батчів переповнився")]
    RunFoldOverflow,
    #[msg("Переповнення балансу при поверненні rent")]
    LamportsOverflow,
    #[msg("Звіт прогону вже розкрито")]
    RunRevealAlreadyDone,
    #[msg("У прогоні немає датасету під таким індексом")]
    RunDatasetIndexOutOfRange,
    #[msg("Переданий датасет не той, що стоїть під цим індексом у прогоні")]
    RunDatasetMismatch,
    #[msg("Записів у звіті менше, ніж оголошено внесками датасетів")]
    RunRecordsBelowContributions,
    #[msg("Переповнення балансу нарахувань власника")]
    OwnerBalanceOverflow,
    #[msg("Результат прогону належить іншому прогону")]
    RunResultForeignRun,
    #[msg("Повернення депозиту можливе лише з невдалого прогону")]
    RunNotFailed,
    #[msg("Депозит цього прогону вже повернуто покупцю")]
    RunAlreadyRefunded,
}
