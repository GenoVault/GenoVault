import { z } from 'zod'
import { buyerCategorySchema, useTypeSchema } from './consent.ts'
import {
  contentHashSchema,
  datasetIdSchema,
  recordCountSchema,
  solanaAddressSchema,
  u64StringSchema,
} from './primitives.ts'
import { unsignedInstructionSchema } from './run.ts'

/**
 * What the owner's side of the API answers (`FR-001`, `FR-004`, `FR-005`,
 * `FR-007`).
 *
 * Every write here ends in an **unsigned** instruction. The API assembles it and
 * the owner signs it; the API never holds a key that could sign on the owner's
 * behalf (`FR-022`). That is why each response names the accounts the owner is
 * about to touch: the screen shows them before the wallet does.
 */

/** Where a registered dataset is on the way from declaration to a run. */
export const DATASET_RECORD_STATUSES = ['pending', 'stored'] as const

export type DatasetRecordStatus = (typeof DATASET_RECORD_STATUSES)[number]

/**
 * `POST /datasets`.
 *
 * `signAfter` is a literal, not a hint. The instruction is handed out on the
 * first step but only makes sense after the bytes are stored: signed earlier,
 * it would put a `content_hash` on chain that nothing in storage answers to.
 */
export const registerDatasetResponseSchema = z.strictObject({
  datasetId: datasetIdSchema,
  owner: solanaAddressSchema,
  datasetAddress: solanaAddressSchema,
  contentHash: contentHashSchema,
  status: z.enum(DATASET_RECORD_STATUSES),
  uploadUrl: z.url(),
  registration: z.strictObject({
    instruction: unsignedInstructionSchema,
    signAfter: z.literal('ciphertext-upload'),
  }),
})

export type RegisterDatasetResponse = z.infer<typeof registerDatasetResponseSchema>

/** `PUT /datasets/:id/ciphertext`. */
export const ciphertextUploadResponseSchema = z.strictObject({
  storedHash: contentHashSchema,
  recordCount: recordCountSchema,
  markerCount: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  status: z.literal('stored'),
})

export type CiphertextUploadResponse = z.infer<typeof ciphertextUploadResponseSchema>

/** `expires_at` is an `i64` in the program; anything above does not serialise. */
const I64_MAX = (1n << 63n) - 1n

/**
 * `POST /datasets/:id/consent` — the owner's terms, **by name**.
 *
 * Names rather than bit masks (decision 2026-10-07): a client that
 * gets the bit layout wrong does not fail anywhere, it silently grants a
 * different use than the owner chose. A name that is not in the dictionary is a
 * 400 naming the field.
 *
 * The rules below mirror `set_consent` so the owner hears about them before
 * signing, not from a program error in the wallet. The program still decides:
 * an expiry that is in the future by our clock but not by the chain's is
 * refused there, and that is correct.
 *
 * There is no owner and no version in the body. The owner is the address the
 * session is bound to, and the version is read from the chain at `confirmed`
 * (`T041`) — a version supplied by the client would build a consent at an
 * address the program never looks at.
 */
export const setConsentRequestSchema = z
  .strictObject({
    allowedUses: z.array(useTypeSchema).min(1),
    forbiddenUses: z.array(useTypeSchema),
    buyerCategories: z.array(buyerCategorySchema).min(1),
    /** Unix seconds as a string; `null` — no expiry. */
    expiresAt: u64StringSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    // Zod 4 runs this even after a field failed, so every read is guarded.
    const allowed = Array.isArray(value.allowedUses) ? value.allowedUses : []
    const forbidden = Array.isArray(value.forbiddenUses) ? value.forbiddenUses : []
    const categories = Array.isArray(value.buyerCategories) ? value.buyerCategories : []

    for (const [field, list] of [
      ['allowedUses', allowed],
      ['forbiddenUses', forbidden],
      ['buyerCategories', categories],
    ] as const) {
      if (new Set(list).size !== list.length) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'a name is repeated' })
      }
    }

    // `ConsentAllowsNothing`: a consent that forbids everything it allows is
    // a revocation dressed as a consent, and the program refuses it as such.
    if (allowed.length > 0 && allowed.every((use) => forbidden.includes(use))) {
      ctx.addIssue({
        code: 'custom',
        path: ['forbiddenUses'],
        message: 'every allowed use is also forbidden — nothing would be allowed',
      })
    }

    if (typeof value.expiresAt === 'string' && /^\d+$/.test(value.expiresAt)) {
      const seconds = BigInt(value.expiresAt)
      if (seconds === 0n || seconds > I64_MAX) {
        ctx.addIssue({
          code: 'custom',
          path: ['expiresAt'],
          message: 'expiry must be a positive i64 of Unix seconds',
        })
      }
    }
  })

export type SetConsentRequest = z.infer<typeof setConsentRequestSchema>

/**
 * Answer of `POST` and `DELETE /datasets/:id/consent`.
 *
 * `version` is the consent the instruction acts on: the new one for `set`
 * (current + 1), the current one for `revoke`. The screen shows it so the
 * owner can tell, after signing, which version the chain now holds.
 */
export const consentTransactionSchema = z.strictObject({
  action: z.enum(['set', 'revoke']),
  datasetId: datasetIdSchema,
  owner: solanaAddressSchema,
  datasetAddress: solanaAddressSchema,
  consentAddress: solanaAddressSchema,
  version: z.number().int().positive(),
  instruction: unsignedInstructionSchema,
})

export type ConsentTransaction = z.infer<typeof consentTransactionSchema>
