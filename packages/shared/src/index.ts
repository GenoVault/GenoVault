export { decodeBase58 } from './base58.ts'
export { contentHash } from './content-hash.ts'
export type {
  DatasetField,
  DatasetMetadata,
  DatasetProvenance,
  DatasetStatistics,
  RegisterDatasetRequest,
} from './dataset-metadata.ts'
export {
  DATASET_SOURCES,
  datasetFieldSchema,
  datasetMetadataSchema,
  datasetProvenanceSchema,
  datasetStatisticsSchema,
  MAX_MARKERS,
  MIN_COHORT,
  registerDatasetRequestSchema,
} from './dataset-metadata.ts'
export type { EnvelopeHeader, Frame } from './envelope.ts'
export {
  DatasetEnvelopeError,
  envelopeBytes,
  FORMAT_VERSION,
  frameBytes,
  HEADER_BYTES,
  inspectEnvelope,
  LIMB_BYTES,
  MAGIC,
  NONCE_BYTES,
  parseEnvelope,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  X25519_KEY_BYTES,
} from './envelope.ts'
export type { ApiError, ApiErrorCode } from './errors.ts'
export { API_ERROR_CODES, apiError, apiErrorSchema } from './errors.ts'
export type {
  Bps,
  ContentHash,
  DatasetId,
  PricePer1k,
  RecordCount,
  RunId,
  SolanaAddress,
  TokenAmount,
} from './primitives.ts'
export {
  BPS_DENOMINATOR,
  bpsSchema,
  contentHashSchema,
  DATASET_ID_MAX_LENGTH,
  datasetIdSchema,
  pricePer1kSchema,
  recordCountSchema,
  runIdSchema,
  SOLANA_ADDRESS_BYTES,
  solanaAddressSchema,
  tokenAmountSchema,
} from './primitives.ts'
