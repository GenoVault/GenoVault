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
    msg: 'The computation was aborted',
  },
  {
    code: 6001,
    name: 'feeBpsTooHigh',
    msg: 'The platform fee exceeds the allowed limit',
  },
  {
    code: 6002,
    name: 'datasetIdLength',
    msg: 'The dataset id is empty or longer than 32 bytes',
  },
  {
    code: 6003,
    name: 'emptyDataset',
    msg: 'A dataset without records cannot be registered',
  },
  {
    code: 6004,
    name: 'emptyContentHash',
    msg: 'The content hash is empty',
  },
  {
    code: 6005,
    name: 'notDatasetOwner',
    msg: 'You are not the owner of this dataset',
  },
  {
    code: 6006,
    name: 'datasetNotActive',
    msg: 'The dataset is retired',
  },
  {
    code: 6007,
    name: 'datasetContentUnchanged',
    msg: 'The dataset content did not change — no new version is needed',
  },
  {
    code: 6008,
    name: 'datasetVersionOverflow',
    msg: 'The dataset version counter overflowed',
  },
  {
    code: 6009,
    name: 'consentAllowsNothing',
    msg: 'Consent that allows nothing is a revocation, not a consent',
  },
  {
    code: 6010,
    name: 'consentExpiryInPast',
    msg: 'The consent expiry had already passed when it was written',
  },
  {
    code: 6011,
    name: 'consentAlreadyRevoked',
    msg: 'The consent is already revoked',
  },
  {
    code: 6012,
    name: 'consentIsRevoked',
    msg: 'The consent was revoked',
  },
  {
    code: 6013,
    name: 'consentExpired',
    msg: 'The consent has expired',
  },
  {
    code: 6014,
    name: 'unknownUseType',
    msg: 'Unknown use type',
  },
  {
    code: 6015,
    name: 'unknownBuyerCategory',
    msg: 'Unknown buyer category',
  },
  {
    code: 6016,
    name: 'useTypeForbidden',
    msg: 'The owner explicitly forbids this use type',
  },
  {
    code: 6017,
    name: 'useTypeNotAllowed',
    msg: 'This use type is not allowed by the consent',
  },
  {
    code: 6018,
    name: 'buyerCategoryNotAllowed',
    msg: 'This buyer category is not allowed by the consent',
  },
  {
    code: 6019,
    name: 'consentVersionOverflow',
    msg: 'The consent version counter overflowed',
  },
  {
    code: 6020,
    name: 'previousConsentMissing',
    msg: 'The previous consent version was not passed',
  },
  {
    code: 6021,
    name: 'runWithoutDatasets',
    msg: 'A run without any dataset',
  },
  {
    code: 6022,
    name: 'runTooManyDatasets',
    msg: 'Too many datasets in the run',
  },
  {
    code: 6023,
    name: 'runDuplicateDataset',
    msg: 'A dataset repeats in the run',
  },
  {
    code: 6024,
    name: 'runNotAccepted',
    msg: 'The run is not in the accepted status',
  },
  {
    code: 6025,
    name: 'runNotRunning',
    msg: 'The run is not running',
  },
  {
    code: 6026,
    name: 'runIsFinal',
    msg: 'The run is already in a final status',
  },
  {
    code: 6027,
    name: 'runResultAlreadyRecorded',
    msg: 'The run result is already written',
  },
  {
    code: 6028,
    name: 'runResultMissing',
    msg: 'The run has no result yet',
  },
  {
    code: 6029,
    name: 'runAlreadySettled',
    msg: 'Every dataset of the run is already settled',
  },
  {
    code: 6030,
    name: 'runSettlementExceedsEscrow',
    msg: 'The payout exceeds what is locked in escrow',
  },
  {
    code: 6031,
    name: 'runSettlementOverflow',
    msg: 'The payout sum overflowed',
  },
  {
    code: 6032,
    name: 'runSettlementIncomplete',
    msg: 'Not every dataset of the run is settled',
  },
  {
    code: 6033,
    name: 'platformPaused',
    msg: 'The platform is paused — no new runs are accepted',
  },
  {
    code: 6034,
    name: 'unknownRecipe',
    msg: 'No such recipe in the catalog',
  },
  {
    code: 6035,
    name: 'runAccountsMalformed',
    msg: 'The run pool was passed as incomplete dataset and consent pairs',
  },
  {
    code: 6036,
    name: 'consentMissing',
    msg: 'The owner has not set consent for this dataset yet',
  },
  {
    code: 6037,
    name: 'consentDatasetMismatch',
    msg: 'The passed consent belongs to another dataset',
  },
  {
    code: 6038,
    name: 'consentVersionStale',
    msg: 'The passed consent is not the current version',
  },
  {
    code: 6039,
    name: 'runEscrowOverflow',
    msg: 'The run price does not fit in u64',
  },
  {
    code: 6040,
    name: 'runEscrowAboveMax',
    msg: 'The run price exceeds the ceiling the buyer named',
  },
  {
    code: 6041,
    name: 'runNotDispatcher',
    msg: 'Only the dispatcher of the run can do this',
  },
  {
    code: 6042,
    name: 'recipeParamsInvalid',
    msg: 'The recipe parameters do not pass validation',
  },
  {
    code: 6043,
    name: 'accumulatorBusy',
    msg: 'The previous computation of the run has not returned yet',
  },
  {
    code: 6044,
    name: 'accumulatorNotReady',
    msg: 'The run accumulator is not created yet',
  },
  {
    code: 6045,
    name: 'accumulatorAlreadyReady',
    msg: 'The run accumulator is already created',
  },
  {
    code: 6046,
    name: 'accumulatorOffsetMismatch',
    msg: 'The callback belongs to another computation',
  },
  {
    code: 6047,
    name: 'batchBufferMalformed',
    msg: 'The buffer account has no header',
  },
  {
    code: 6048,
    name: 'batchBufferForeignRun',
    msg: 'The buffer account belongs to another run',
  },
  {
    code: 6049,
    name: 'batchBufferTooSmall',
    msg: 'The buffer account has not grown to the batch size yet',
  },
  {
    code: 6050,
    name: 'batchBufferNotGrowing',
    msg: 'The buffer account is already this size or larger',
  },
  {
    code: 6051,
    name: 'batchWriteOutOfBounds',
    msg: 'The write goes past the end of the buffer account',
  },
  {
    code: 6052,
    name: 'batchLiveOutOfRange',
    msg: 'A batch must hold from 1 to RECIPE_BATCH live records',
  },
  {
    code: 6053,
    name: 'runPoolExhausted',
    msg: 'Every dataset of the run is already closed',
  },
  {
    code: 6054,
    name: 'runPoolNotExhausted',
    msg: 'The run still has open datasets',
  },
  {
    code: 6055,
    name: 'runFoldOverflow',
    msg: 'The folded batch counter overflowed',
  },
  {
    code: 6056,
    name: 'lamportsOverflow',
    msg: 'Balance overflow while returning rent',
  },
  {
    code: 6057,
    name: 'runRevealAlreadyDone',
    msg: 'The run report is already revealed',
  },
  {
    code: 6058,
    name: 'runDatasetIndexOutOfRange',
    msg: 'The run has no dataset at this index',
  },
  {
    code: 6059,
    name: 'runDatasetMismatch',
    msg: 'The passed dataset is not the one at this index in the run',
  },
  {
    code: 6060,
    name: 'runRecordsBelowContributions',
    msg: 'The report holds fewer records than the dataset contributions declare',
  },
  {
    code: 6061,
    name: 'ownerBalanceOverflow',
    msg: 'The owner balance overflowed',
  },
  {
    code: 6062,
    name: 'runResultForeignRun',
    msg: 'The run result belongs to another run',
  },
  {
    code: 6063,
    name: 'runNotFailed',
    msg: 'Escrow can only be refunded from a failed run',
  },
  {
    code: 6064,
    name: 'runAlreadyRefunded',
    msg: 'The escrow of this run is already refunded to the buyer',
  },
] as const
