export type { EncryptedDataset, SealedDataset } from './dataset.ts'
export { decryptDataset, encryptDataset, sealDataset } from './dataset.ts'
export type { EnvelopeHeader, Frame } from './envelope.ts'
export {
  DatasetEnvelopeError,
  FORMAT_VERSION,
  HEADER_BYTES,
  LIMB_BYTES,
  MAGIC,
  NONCE_BYTES,
  parse as parseEnvelope,
  X25519_KEY_BYTES,
} from './envelope.ts'
export type { DatasetRecord } from './record.ts'
export { datasetRecordSchema, SCALAR_FIELD_COUNT } from './record.ts'
