# GenoVault

A marketplace for medical and genomic data where the data never leaves
encryption. A clinic, a biobank or an individual puts a dataset to work
without handing over the records; the owner's consent is a condition of
execution, not a clause in a contract; and the fee for a run is split among
those whose data actually went into it.

- **Computation over ciphertext.** A run is a multi-party computation: the
  data is secret-shared across nodes so that no node sees a record, and the
  platform operator has no key by construction rather than by policy.
- **Consent that cannot be bypassed.** Allowed uses, forbidden purposes,
  expiry and revocation live on-chain. A run outside the consent is not
  blocked by the UI — it does not execute, because the compute layer is never
  granted access.
- **Settlement by contribution.** How many records really entered a run is
  counted inside the computation, not declared by the owner; the payout equals
  what the owner asked for the volume actually used.
- **Verifiability.** Runs, consents and payouts are checked against the chain
  by an independent verifier that does not use the platform's own code.

## What has been measured

Every success criterion is measured by a command on a live local cluster
(one Solana validator, two Arcium ARX nodes), never by eye. The numbers below
come from the chain, and every check is proven with a negative control on
live data — a deliberately planted defect the check must catch.

| Criterion | Budget | Measured | Check |
|---|---|---|---|
| No raw record in the clear, anywhere | 0 hits on 10 runs | **0 on 11 runs** | `audit-verify no-plaintext` |
| Quality gap vs. the same recipe on plaintext | ≤ 2 pp | **0.0 pp** (150 numbers, 0 mismatches) | `audit-verify parity` |
| Run over 10 000 records | ≤ 4.5 h | **3.31 h and 3.71 h** (two corpora) | `audit-verify timing` |
| Buyer's path, catalogue → result | ≤ 3 min | **0.1 s** active time | `audit-verify e2e-buyer` |

The "no raw record" check is three checks, not one: a canary dataset whose
records are searched for in every account, transaction, log and storage
object; word-by-word identity of everything written to the batch buffer with
the public ciphertext; and the cohort and contribution floors that keep an
aggregate from becoming a single person's record.

The time criterion was originally "≤ 5 minutes". It was rewritten after the
measurement, not before it — see the limits below.

## Measured limits

These are properties of the toolchain and the cluster, found by running into
them. They bound the product, not just the implementation.

- **The cluster saturates at four concurrent computations.** Speed-up from
  parallel accumulators: ×1.81 on two, ×3.42 on four, ×3.56 on eight, ×4.08 on
  sixteen. Doubling from 8 to 16 buys 15 %. At the ceiling, 10 000 records take
  about 55 minutes *even with unbounded parallelism* — a 5-minute budget would
  need 33 records/s against a measured 3.
- **One fold costs ~4.8 s and 73 % of it is the MPC round trip**, not the
  driver. Polishing the driver cannot rescue the original budget: with zero
  overhead on our side the miss would still be ×32.
- **Circuit weight is capped at 5 000 000 000 ACU per definition.** The fold
  circuit weighs `0.861 + 0.522 × BATCH` billion, so a batch cannot exceed 7
  records; it is 4, with 41 % headroom.
- **An MPC output must fit in one transaction.** The reveal callback allows at
  most 19 ciphertexts; the report uses 13.
- **Ciphering in the browser costs ~1.2 ms per field element.** Encrypting a
  10 000-record dataset client-side is minutes, not seconds, and it runs in a
  Web Worker with progress for that reason.

All of the above was measured on two ARX nodes on a single machine. A
production Arcium cluster is a different measurement and has not been made.

## What the demo does not have yet

Said out loud so the demo does not suggest more than it proves:

- one dataset in the pool, and its consent allows everything — consent
  enforcement on real runs is the next milestone;
- payment amounts are public on-chain; confidential amounts come later;
- nobody independently reconciles the exported journal yet;
- parts of the web UI still run on fixtures rather than the API;
- **all data is synthetic.** The system has not been through regulatory or
  legal review and is not intended for real patient data.

## Repository layout

```
apps/api               Hono API: catalogue, runs, platform config
apps/web               React + Vite UI, Privy sign-in
packages/shared        Zod contracts shared by API, UI and tools
packages/crypto        Dataset encryption; the key never leaves the browser
packages/sdk           Anchor client with the vendored IDL
programs/genovault     Solana program (Anchor 1.0.2): datasets, consent, runs, settlement
encrypted-ixs          Arcis circuits: the "frequencies & distributions" recipe
tools/audit-verify     Independent verifier — does not depend on packages/sdk on purpose
tools/run-dispatcher   Drives a run end to end: feeds ciphertext, awaits MPC callbacks
tools/gen-dataset      Synthetic cohorts with known causal markers
scripts/               WSL build, test and local-network scripts
```

The verifier's independence is held by a test, not a convention: nothing under
`tools/audit-verify/src` may import a GenoVault package. It decodes accounts
from the public IDL layout byte by byte, and it derives how much it must
inspect from the chain (`Run.folded_batches`), so that an incomplete review
is reported as a discrepancy rather than mistaken for a clean one.

## Stack

pnpm workspaces · TypeScript strict · Node ≥ 22 · Hono · React 18 + Vite 7 ·
Privy · Zod · Biome · Vitest 3

On-chain: Anchor 1.0.2 · Arcium 0.14.1 · Arcis 0.10.4 · Rust 1.97.1 ·
Solana CLI 4.2.0 — all inside WSL.

Dataset metadata and ciphertext storage sit behind driver interfaces
(`memory`/`fs` for metadata, `fs`/`supabase` for ciphertext). A Postgres
backend is planned; nothing in the routes changes when it lands.

## Commands

```bash
pnpm install
pnpm dev          # all apps in parallel
pnpm test         # vitest, all packages
pnpm lint         # biome
pnpm typecheck    # tsc --noEmit, all packages
pnpm gate         # idl:check + strip:check + lint + typecheck + test — before every commit
```

`idl:check` fails if the vendored IDL drifted from `anchor build`; `strip:check`
fails if any file needs more than type stripping to run under `node`.

The on-chain part builds and tests in WSL (`scripts/wsl-build.sh`,
`scripts/wsl-test-program.sh`, `scripts/wsl-build-circuits.sh`). Program tests
run under `mollusk-svm` against the built `.so`.

## Local stand

```bash
wsl -d Ubuntu-24.04 -e bash /mnt/<path>/GenoVault/scripts/localnet.sh
```

Brings up a validator with the program in genesis plus the Arcium MPC cluster
(six Docker containers). Port 8899 is fixed by Arcium and cannot be changed;
while the stand is up, no other local Solana network on the machine will
start. The script stays in the foreground on purpose — background validators
outlive the session and then silently fight over ports.

Then seed conditions and verify, each criterion in two steps — the dispatcher
creates the conditions and proves nothing, the verifier measures without our
code at runtime:

```bash
# buyer's path end to end
node --experimental-strip-types tools/run-dispatcher/src/cli.ts e2e --out artifacts/e2e/run.json
node --experimental-strip-types tools/audit-verify/src/cli.ts e2e-buyer --report artifacts/e2e/run.json

# no raw record in the clear (11 runs)
node --experimental-strip-types tools/run-dispatcher/src/cli.ts sc001 --out artifacts/no-plaintext/corpus.json
node --experimental-strip-types tools/audit-verify/src/cli.ts no-plaintext --corpus artifacts/no-plaintext/corpus.json

# quality parity against plaintext
node --experimental-strip-types tools/run-dispatcher/src/cli.ts sc002 --out artifacts/parity/corpus.json
node --experimental-strip-types tools/audit-verify/src/cli.ts parity --corpus artifacts/parity/corpus.json

# run time: fold-cycle breakdown, linearity ladder, parallelism waves
node --experimental-strip-types tools/run-dispatcher/src/cli.ts sc003 --out artifacts/timing/corpus.json
node --experimental-strip-types tools/audit-verify/src/cli.ts timing --corpus artifacts/timing/corpus.json
```

Each verifier command exits non-zero when the criterion is not met, and each
was proven against a negative control on live data that had to turn the
verdict red: a plaintext record planted into a copy of storage, one genotype
corrupted in the owner's records, and a known 2 000 ms stall inserted into
the fold cycle (`sc003 --stall-ms 2000`) that the timing check had to find
to within 1 % and attribute to the driver, not to MPC.

## Deploying the web app to GitHub Pages

`.github/workflows/pages.yml` builds `apps/web` on every push to `main` that
touches it and publishes the bundle to GitHub Pages. Only the web app goes
there — the API, the program and the MPC cluster do not run on Pages. Without
`VITE_API_URL` the app runs on its built-in fixtures and says so on every
screen; that is the M0 prototype, and it is an honest thing to publish.

One-time setup by the repository owner:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Optionally, **Settings → Secrets and variables → Actions → Variables**:
   `VITE_API_URL` (a live API), `VITE_PRIVY_APP_ID`, `VITE_RPC_URL`. They are
   baked into the public bundle, so they are variables, not secrets. For Privy,
   also add the Pages origin to the app's allowed domains in the Privy
   dashboard.
3. On a custom domain set `PAGES_BASE_PATH=/`; by default the site lives under
   `/<repository name>/`, and both the bundle and the router read that path
   from the build (`BASE_PATH` → `import.meta.env.BASE_URL`).

Deep links work: Pages has no SPA fallback, so the workflow serves the app
itself as `404.html` and the router picks the path up. The HTTP status of a
deep link stays 404 — fine for an app, irrelevant for a demo.

To reproduce the Pages build locally:

```bash
BASE_PATH=/GenoVault/ pnpm --filter @genovault/web build
```

## Status

Milestone 0 (visual prototype) and the four confidential-core measurements
above are done. Consent enforcement, multi-owner settlement and withdrawals,
confidential amounts and journal export are the next milestones, in that
order. Product truth lives in the spec; this file only says what is
measured.
