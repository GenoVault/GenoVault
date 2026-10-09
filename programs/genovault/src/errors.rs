use anchor_lang::prelude::*;

/// Помилки програми.
///
/// `FR-008` вимагає, щоб відмова називала конкретне порушене обмеження, а не
/// «доступ заборонено». Тому варіанти тут дрібні й іменні: кожен відповідає
/// рівно одній перевірці, і повідомлення можна показати покупцю без здогадок.
#[error_code]
pub enum GenoVaultError {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("The platform fee exceeds the allowed limit")]
    FeeBpsTooHigh,
    #[msg("The dataset id is empty or longer than 32 bytes")]
    DatasetIdLength,
    #[msg("A dataset without records cannot be registered")]
    EmptyDataset,
    #[msg("The content hash is empty")]
    EmptyContentHash,
    #[msg("You are not the owner of this dataset")]
    NotDatasetOwner,
    #[msg("The dataset is retired")]
    DatasetNotActive,
    #[msg("The dataset content did not change — no new version is needed")]
    DatasetContentUnchanged,
    #[msg("The dataset version counter overflowed")]
    DatasetVersionOverflow,
    #[msg("Consent that allows nothing is a revocation, not a consent")]
    ConsentAllowsNothing,
    #[msg("The consent expiry had already passed when it was written")]
    ConsentExpiryInPast,
    #[msg("The consent is already revoked")]
    ConsentAlreadyRevoked,
    #[msg("The consent was revoked")]
    ConsentIsRevoked,
    #[msg("The consent has expired")]
    ConsentExpired,
    #[msg("Unknown use type")]
    UnknownUseType,
    #[msg("Unknown buyer category")]
    UnknownBuyerCategory,
    #[msg("The owner explicitly forbids this use type")]
    UseTypeForbidden,
    #[msg("This use type is not allowed by the consent")]
    UseTypeNotAllowed,
    #[msg("This buyer category is not allowed by the consent")]
    BuyerCategoryNotAllowed,
    #[msg("The consent version counter overflowed")]
    ConsentVersionOverflow,
    #[msg("The previous consent version was not passed")]
    PreviousConsentMissing,
    #[msg("A run without any dataset")]
    RunWithoutDatasets,
    #[msg("Too many datasets in the run")]
    RunTooManyDatasets,
    #[msg("A dataset repeats in the run")]
    RunDuplicateDataset,
    #[msg("The run is not in the accepted status")]
    RunNotAccepted,
    #[msg("The run is not running")]
    RunNotRunning,
    #[msg("The run is already in a final status")]
    RunIsFinal,
    #[msg("The run result is already written")]
    RunResultAlreadyRecorded,
    #[msg("The run has no result yet")]
    RunResultMissing,
    #[msg("Every dataset of the run is already settled")]
    RunAlreadySettled,
    #[msg("The payout exceeds what is locked in escrow")]
    RunSettlementExceedsEscrow,
    #[msg("The payout sum overflowed")]
    RunSettlementOverflow,
    #[msg("Not every dataset of the run is settled")]
    RunSettlementIncomplete,
    #[msg("The platform is paused — no new runs are accepted")]
    PlatformPaused,
    #[msg("No such recipe in the catalog")]
    UnknownRecipe,
    #[msg("The run pool was passed as incomplete dataset and consent pairs")]
    RunAccountsMalformed,
    #[msg("The owner has not set consent for this dataset yet")]
    ConsentMissing,
    #[msg("The passed consent belongs to another dataset")]
    ConsentDatasetMismatch,
    #[msg("The passed consent is not the current version")]
    ConsentVersionStale,
    #[msg("The run price does not fit in u64")]
    RunEscrowOverflow,
    #[msg("The run price exceeds the ceiling the buyer named")]
    RunEscrowAboveMax,
    #[msg("Only the dispatcher of the run can do this")]
    RunNotDispatcher,
    #[msg("The recipe parameters do not pass validation")]
    RecipeParamsInvalid,
    #[msg("The previous computation of the run has not returned yet")]
    AccumulatorBusy,
    #[msg("The run accumulator is not created yet")]
    AccumulatorNotReady,
    #[msg("The run accumulator is already created")]
    AccumulatorAlreadyReady,
    #[msg("The callback belongs to another computation")]
    AccumulatorOffsetMismatch,
    #[msg("The buffer account has no header")]
    BatchBufferMalformed,
    #[msg("The buffer account belongs to another run")]
    BatchBufferForeignRun,
    #[msg("The buffer account has not grown to the batch size yet")]
    BatchBufferTooSmall,
    #[msg("The buffer account is already this size or larger")]
    BatchBufferNotGrowing,
    #[msg("The write goes past the end of the buffer account")]
    BatchWriteOutOfBounds,
    #[msg("A batch must hold from 1 to RECIPE_BATCH live records")]
    BatchLiveOutOfRange,
    #[msg("Every dataset of the run is already closed")]
    RunPoolExhausted,
    #[msg("The run still has open datasets")]
    RunPoolNotExhausted,
    #[msg("The folded batch counter overflowed")]
    RunFoldOverflow,
    #[msg("Balance overflow while returning rent")]
    LamportsOverflow,
    #[msg("The run report is already revealed")]
    RunRevealAlreadyDone,
    #[msg("The run has no dataset at this index")]
    RunDatasetIndexOutOfRange,
    #[msg("The passed dataset is not the one at this index in the run")]
    RunDatasetMismatch,
    #[msg("The report holds fewer records than the dataset contributions declare")]
    RunRecordsBelowContributions,
    #[msg("The owner balance overflowed")]
    OwnerBalanceOverflow,
    #[msg("The run result belongs to another run")]
    RunResultForeignRun,
    #[msg("Escrow can only be refunded from a failed run")]
    RunNotFailed,
    #[msg("The escrow of this run is already refunded to the buyer")]
    RunAlreadyRefunded,
}
