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
}
