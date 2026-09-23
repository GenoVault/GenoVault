// Згенеровано `scripts/sync-program-errors.mjs` — руками не правити.
//
// Таблиця помилок програми: код, ім'я варіанта, повідомлення `#[msg]`. Одне
// джерело — вендорений IDL (`packages/sdk/src/idl/genovault.ts`), звірка в
// гейті (`pnpm errors:check`).
//
// `as const` тут несе роботу: з нього `ProgramErrorName` стає об'єднанням
// літералів, і словник порушених обмежень у `program-errors.ts` перестає
// компілюватись, щойно варіант перейменували або прибрали в програмі.

/** Адреса програми — та сама, що в IDL і в `declare_id!`. */
export const PROGRAM_ADDRESS = '9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb'

export const PROGRAM_ERRORS = [
  {
    code: 6000,
    name: 'abortedComputation',
    msg: 'Обчислення перервано',
  },
  {
    code: 6001,
    name: 'feeBpsTooHigh',
    msg: 'Комісія платформи перевищує дозволену межу',
  },
  {
    code: 6002,
    name: 'datasetIdLength',
    msg: 'Ідентифікатор датасету порожній або довший за 32 байти',
  },
  {
    code: 6003,
    name: 'emptyDataset',
    msg: 'Датасет без записів не реєструється',
  },
  {
    code: 6004,
    name: 'emptyContentHash',
    msg: 'Відбиток вмісту порожній',
  },
  {
    code: 6005,
    name: 'notDatasetOwner',
    msg: 'Ви не власник цього датасету',
  },
  {
    code: 6006,
    name: 'datasetNotActive',
    msg: 'Датасет знято з каталогу',
  },
  {
    code: 6007,
    name: 'datasetContentUnchanged',
    msg: 'Вміст датасету не змінився — нова версія не потрібна',
  },
  {
    code: 6008,
    name: 'datasetVersionOverflow',
    msg: 'Лічильник версій датасету переповнився',
  },
  {
    code: 6009,
    name: 'consentAllowsNothing',
    msg: 'Згода, яка нічого не дозволяє, — це відкликання, а не згода',
  },
  {
    code: 6010,
    name: 'consentExpiryInPast',
    msg: 'Строк дії згоди вже минув на момент її запису',
  },
  {
    code: 6011,
    name: 'consentAlreadyRevoked',
    msg: 'Згоду вже відкликано',
  },
  {
    code: 6012,
    name: 'consentIsRevoked',
    msg: 'Згоду відкликано',
  },
  {
    code: 6013,
    name: 'consentExpired',
    msg: 'Строк дії згоди минув',
  },
  {
    code: 6014,
    name: 'unknownUseType',
    msg: 'Невідомий тип використання',
  },
  {
    code: 6015,
    name: 'unknownBuyerCategory',
    msg: 'Невідома категорія покупця',
  },
  {
    code: 6016,
    name: 'useTypeForbidden',
    msg: 'Цей тип використання прямо заборонений власником',
  },
  {
    code: 6017,
    name: 'useTypeNotAllowed',
    msg: 'Цей тип використання не дозволений згодою',
  },
  {
    code: 6018,
    name: 'buyerCategoryNotAllowed',
    msg: 'Ця категорія покупця не дозволена згодою',
  },
  {
    code: 6019,
    name: 'consentVersionOverflow',
    msg: 'Лічильник версій згоди переповнився',
  },
  {
    code: 6020,
    name: 'previousConsentMissing',
    msg: 'Не передано попередню версію згоди',
  },
  {
    code: 6021,
    name: 'runWithoutDatasets',
    msg: 'Прогін без жодного датасету',
  },
  {
    code: 6022,
    name: 'runTooManyDatasets',
    msg: 'У прогоні забагато датасетів',
  },
  {
    code: 6023,
    name: 'runDuplicateDataset',
    msg: 'Датасет повторюється у складі прогону',
  },
  {
    code: 6024,
    name: 'runNotAccepted',
    msg: 'Прогін не в статусі «прийнято»',
  },
  {
    code: 6025,
    name: 'runNotRunning',
    msg: 'Прогін не виконується',
  },
  {
    code: 6026,
    name: 'runIsFinal',
    msg: 'Прогін уже в кінцевому статусі',
  },
  {
    code: 6027,
    name: 'runResultAlreadyRecorded',
    msg: 'Результат прогону вже записано',
  },
  {
    code: 6028,
    name: 'runResultMissing',
    msg: 'Результату прогону ще немає',
  },
  {
    code: 6029,
    name: 'runAlreadySettled',
    msg: 'Усім датасетам прогону вже нараховано',
  },
  {
    code: 6030,
    name: 'runSettlementExceedsEscrow',
    msg: 'Нарахування перевищує заблоковане в депозиті',
  },
  {
    code: 6031,
    name: 'runSettlementOverflow',
    msg: 'Переповнення суми нарахувань',
  },
  {
    code: 6032,
    name: 'runSettlementIncomplete',
    msg: 'Нараховано не всім датасетам прогону',
  },
  {
    code: 6033,
    name: 'platformPaused',
    msg: 'Платформу поставлено на паузу — нові прогони не приймаються',
  },
  {
    code: 6034,
    name: 'unknownRecipe',
    msg: 'Такого рецепта немає в каталозі',
  },
  {
    code: 6035,
    name: 'runAccountsMalformed',
    msg: 'Склад прогону передано неповними парами «датасет + згода»',
  },
  {
    code: 6036,
    name: 'consentMissing',
    msg: 'Власник ще не задав згоди для цього датасету',
  },
  {
    code: 6037,
    name: 'consentDatasetMismatch',
    msg: 'Передана згода належить іншому датасету',
  },
  {
    code: 6038,
    name: 'consentVersionStale',
    msg: 'Передана згода не є чинною версією',
  },
  {
    code: 6039,
    name: 'runEscrowOverflow',
    msg: 'Вартість прогону не вміщається в u64',
  },
  {
    code: 6040,
    name: 'runEscrowAboveMax',
    msg: 'Вартість прогону перевищує названу покупцем межу',
  },
  {
    code: 6041,
    name: 'runNotDispatcher',
    msg: 'Цю дію може виконати лише диспетчер прогону',
  },
  {
    code: 6042,
    name: 'recipeParamsInvalid',
    msg: 'Параметри рецепта не проходять перевірку',
  },
  {
    code: 6043,
    name: 'accumulatorBusy',
    msg: 'Попереднє обчислення прогону ще не повернулось',
  },
  {
    code: 6044,
    name: 'accumulatorNotReady',
    msg: 'Накопичувач прогону ще не створено',
  },
  {
    code: 6045,
    name: 'accumulatorAlreadyReady',
    msg: 'Накопичувач прогону вже створено',
  },
  {
    code: 6046,
    name: 'accumulatorOffsetMismatch',
    msg: 'Callback належить іншому обчисленню',
  },
  {
    code: 6047,
    name: 'batchBufferMalformed',
    msg: 'Буферний акаунт не має заголовка',
  },
  {
    code: 6048,
    name: 'batchBufferForeignRun',
    msg: 'Буферний акаунт належить іншому прогону',
  },
  {
    code: 6049,
    name: 'batchBufferTooSmall',
    msg: 'Буферний акаунт ще не дорощено до розміру батча',
  },
  {
    code: 6050,
    name: 'batchBufferNotGrowing',
    msg: 'Буферний акаунт уже такого розміру або більший',
  },
  {
    code: 6051,
    name: 'batchWriteOutOfBounds',
    msg: 'Запис виходить за межі буферного акаунта',
  },
  {
    code: 6052,
    name: 'batchLiveOutOfRange',
    msg: 'У батчі має бути від 1 до 32 живих записів',
  },
  {
    code: 6053,
    name: 'runPoolExhausted',
    msg: 'Усі датасети прогону вже закриті',
  },
  {
    code: 6054,
    name: 'runPoolNotExhausted',
    msg: 'У прогоні лишились незакриті датасети',
  },
  {
    code: 6055,
    name: 'runFoldOverflow',
    msg: 'Лічильник згорнутих батчів переповнився',
  },
  {
    code: 6056,
    name: 'lamportsOverflow',
    msg: 'Переповнення балансу при поверненні rent',
  },
  {
    code: 6057,
    name: 'runRevealAlreadyDone',
    msg: 'Звіт прогону вже розкрито',
  },
  {
    code: 6058,
    name: 'runDatasetIndexOutOfRange',
    msg: 'У прогоні немає датасету під таким індексом',
  },
  {
    code: 6059,
    name: 'runDatasetMismatch',
    msg: 'Переданий датасет не той, що стоїть під цим індексом у прогоні',
  },
  {
    code: 6060,
    name: 'runRecordsBelowContributions',
    msg: 'Записів у звіті менше, ніж оголошено внесками датасетів',
  },
  {
    code: 6061,
    name: 'ownerBalanceOverflow',
    msg: 'Переповнення балансу нарахувань власника',
  },
  {
    code: 6062,
    name: 'runResultForeignRun',
    msg: 'Результат прогону належить іншому прогону',
  },
  {
    code: 6063,
    name: 'runNotFailed',
    msg: 'Повернення депозиту можливе лише з невдалого прогону',
  },
  {
    code: 6064,
    name: 'runAlreadyRefunded',
    msg: 'Депозит цього прогону вже повернуто покупцю',
  },
] as const
