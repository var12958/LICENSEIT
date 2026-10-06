# Security

This project holds a funded key and serves licensed data, so the security work is
part of the feature rather than an afterthought. This document records what is
protected, how, and what is deliberately out of scope for a single-operator deployment.

## Threat model

LICENSEIT has four assets worth protecting, in descending order of damage if lost:

1. **The signing key.** It controls the shelbynet account that pays for storage
   and signs receipt transactions. A leak means someone else can spend the balance
   and, worse, write receipts that appear to come from this deployment.
2. **The integrity of the receipt log.** The whole claim of the project is that a
   read cannot happen without a permanent record. A forged or suppressed receipt
   breaks the claim.
3. **Licensed content.** Bytes must not be served for a use the license does not
   permit, or after the license has expired.
4. **The manifest.** It is the only mapping from blob to license, so corrupting it
   makes every read unverifiable.

The attackers considered are a curious user of the site, a malicious client
sending crafted requests to the local API, a dependency that has been tampered
with, and an auditor who is lied to by a doctored local log.

## Secret handling

- `SHELBY_ACCOUNT_PRIVATE_KEY` is read in exactly one place, `src/config/env.ts`,
  and passed only to the Aptos SDK account constructor in `src/shelby/client.ts`.
  Nothing else in the codebase reads it.
- `.env` and `.aptos/` are in `.gitignore`. `.env.example` carries zero-filled
  dummy values so the file shape is documented without a real key ever being the
  thing that gets committed. `git ls-files` shows neither is tracked.
- Errors from Shelby and Aptos calls are re-thrown with `cause.message` only, in
  `uploadPipeline.ts`, `receiptMiddleware.ts`, and `chainWriter.ts`. SDK errors
  can carry the full request configuration, and that configuration includes
  credentials, so the original error object is never surfaced or logged.
- The web API logs a status and a message, never a request body and never the
  environment. The browser bundle contains no secret because every signed
  operation happens in the Node process.
- Dependencies are kept small for the same reason. The `.env` parser is 30 lines
  of local code rather than a package, because any package in the process can read
  process memory that holds the key.

## Input validation

Every value that crosses a boundary is validated before it reaches the SDK or the
filesystem.

- **License metadata** goes through `validateLicenseMetadata`, which rejects
  non-objects, missing or empty strings, a `permittedUse` outside the allowed set,
  an unparseable `expiresAt`, a date with no time component, and an
  already-expired license. It returns a fresh object built only from the fields it
  validated, so extra keys in the input never reach the manifest. Uploads validate
  the whole batch before the first network call, so a dataset cannot end up half
  stored.
- **File paths** are resolved and confirmed to sit inside an explicit root before
  reading, which stops `../` from walking out of the dataset directory. In the web
  API, the uploaded file is written into a fresh temp directory whose name is a
  hash of the client-supplied name, so a crafted name cannot influence the path at
  all.
- **Blob names** in the API are restricted to letters, digits, dot, dash,
  underscore, and slash, and any `.` or `..` segment is rejected. Blob names
  become paths in the Shelby namespace, so a name is not free-form text.
- **Request bodies** are length-capped per field, uploads are capped at 1 MB, and
  `express.json` has its own body limit. The two routes that spend tokens are rate
  limited per client, because a held-down button can otherwise empty the
  account and take LICENSEIT offline.
- **Numbers** such as `expirationDays` are bounds-checked rather than passed
  through, since they translate directly into storage cost.
- **Report paths** are derived, not accepted. The training run ID becomes part of
  the report file name, so it must match `[A-Za-z0-9._-]+`, and an explicit
  `--out` path is rejected if it resolves outside the working directory. Table
  cells in the Markdown report escape pipes and backslashes so metadata cannot
  break the table structure or forge a row.

## On-chain integrity

`move/sources/receipt_log.move` is deliberately minimal, and the two decisions
that matter are both about making the log hard to lie to:

- The `reader` in the event is `signer::address_of(account)`, never an argument.
  A caller cannot log a read under another identity.
- The timestamp is `timestamp::now_microseconds()`, chain time, not the caller's
  clock. A machine with a wrong or dishonest clock cannot place a read inside a
  license window it missed.
- Nothing is stored mutably. The log is events only, so there is no resource an
  admin could later edit. Absence of an event is itself evidence.
- Empty `blob_hash`, `license_id`, or `training_run_id` abort with distinct codes,
  because a receipt that does not say what was read, under which license, for
  which run, cannot be audited.

The read path enforces the same integrity on the way back: the merkle root is
recomputed from the served bytes and compared to the root recorded at upload, and
a mismatch refuses the content instead of returning it. The chain write happens
before the bytes are returned to the caller, so a failed write means no data is
handed over.

## Dependency and supply chain posture

- `npm audit --omit=dev` reports zero vulnerabilities in both the root package and
  `web/`.
- `package-lock.json` is committed in both packages, so installs are reproducible.
- Direct dependencies are limited to the Aptos SDK, the Shelby SDK, Express, React,
  and Material Web. Everything else, including the `.env` parser, argument parsing,
  and the test runner, is either local code or built into Node.

## Known limitations

These are honest gaps, not oversights, and each is a consequence of this being a
single-operator deployment rather than a shared service.

- **The local API has no authentication.** It binds to localhost and assumes the
  person running it is the operator. Exposing it to a network would require real
  authentication and per-user keys, since every request currently signs with the
  one funded account.
- **The manifest is local and unsigned.** An attacker with write access to
  `data/manifest.json` could change which license a blob claims. The on-chain
  receipts still record what was read and under which license ID, so tampering is
  detectable in an audit, but it is not prevented. Anchoring a manifest hash on
  chain would close this.
- **One key does everything.** Uploading, reading, and logging all use the same
  account, so the receipt log proves LICENSEIT read a file, not which person did.
  Distinct reader keys would make attribution meaningful.
- **Rate limiting is in memory.** It resets when the process restarts and is per
  process, which is adequate for one operator and not for anything shared.
- **No content encryption at rest.** Shelby stores the bytes as uploaded, so the
  license is enforced by LICENSEIT's read path rather than by cryptography. A
  party who obtains a blob name and has direct Shelby access is outside the model.
