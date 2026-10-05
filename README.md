# LICENSEIT

This project stores training data on Shelby with a license attached to every file, captures a cryptographic receipt each time a file is served, logs that receipt on Aptos, and generates an audit report for any training run. The point is to be able to prove, after the fact, that every file a model trained on was lawfully acquired and covered by a valid license at the moment it was read.

Shelby is a verifiable object storage protocol, so a read can be checked rather than trusted. That property is what makes any of this possible. Ordinary storage records nothing about rights, so a compliance claim about a dataset is unfalsifiable. Attaching license terms per file and logging each read against those terms turns compliance into something you can query.

Everything here runs against live Shelbynet. There is no demo mode, no mock storage, and no fixture data behind the scenes. If a command prints a transaction hash, that transaction is on chain and you can resolve it yourself with the `curl` command in the audit report.

## How it fits together

There are three operations, and they happen in this order.

1. **Upload.** You give LICENSEIT a file and a license. It validates the license first, uploads the bytes to Shelby, and records the blob's merkle root next to the license in a local manifest.
2. **Read.** Training code asks LICENSEIT for a blob, declaring who is reading and for which run. LICENSEIT checks the license *before* downloading, verifies the served bytes against the root from upload, writes a receipt to Aptos, and only then hands back the content.
3. **Audit.** You ask for a report on a training run. LICENSEIT reads the receipts back off chain, judges each one against the license as it stood at that read's timestamp, and writes a Markdown report an auditor can verify line by line.

The rest of this README walks through each step as you would actually run it.

---

## Part 1: One-time setup

You need Node.js v22 or later, npm, and git. Check with `node --version`.

### Step 1. Install the two CLIs

```
npm install -g @shelby-protocol/cli
brew install aptos
```

The Shelby CLI creates and funds your storage account. The Aptos CLI compiles and publishes the Move module that records receipts. Confirm both: `shelby --version` and `aptos --version`.

### Step 2. Install project dependencies

```
npm install
```

### Step 3. Create a Shelbynet account

```
shelby init --setup-default
```

This writes network contexts and a fresh keypair to `~/.shelby/config.yaml` and makes shelbynet the default. It prints an account address and a private key. Keep that output; the next step needs it.

### Step 4. Fill in your `.env`

```
cp .env.example .env
```

Open `.env` and paste in the address and private key from step 3. `.env.example` documents every variable with a zero-filled placeholder, so you can see what is required without anything real being committed. `.env` itself is gitignored and is the only file in this repository allowed to hold a private key.

Leave `RECEIPT_LOG_MODULE_ADDRESS` for now. You will get that value in step 7.

### Step 5. Fund the account

Uploads cost ShelbyUSD and every transaction costs APT for gas, so you need both tokens.

```
./scripts/fundAccount.sh
```

The script reads your default address from `~/.shelby/config.yaml`, asks the Shelbynet faucet for APT and ShelbyUSD, then prints the balances. If the faucet API refuses, get a browser URL instead with `shelby faucet --network shelbynet --no-open`.

Check balances any time:

```
shelby account balance
```

**Both balances must be nonzero before anything will work.** If you later see `INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE`, your APT ran out. If you see `E_INSUFFICIENT_FUNDS`, your ShelbyUSD ran out. Rerun the script either way.

### Step 6. Create an Aptos profile for Shelbynet

The Aptos CLI needs to know about Shelbynet, and it should use the key you already have rather than a second account:

```
aptos init --profile shelbynet --network custom \
  --rest-url https://api.shelbynet.shelby.xyz/v1 --skip-faucet --private-key <your key>
```

### Step 7. Publish the receipt log module

From the `move/` directory, substituting your account address:

```
cd move
aptos move compile --named-addresses receipt_log=<address>
aptos move test --named-addresses receipt_log=<address>
aptos move publish --profile shelbynet --named-addresses receipt_log=<address>
cd ..
```

Publishing prints the address the module now lives at. Put it in `.env` as `RECEIPT_LOG_MODULE_ADDRESS`. It is the publisher's address, so it will match `SHELBY_ACCOUNT_ADDRESS` unless you published from somewhere else.

### Step 8. Confirm the setup

```
npx tsc --noEmit
npm test
shelby account balance
git status --ignored
```

Types clean, tests green, balances nonzero, and `.env` listed under ignored rather than tracked files. You are ready to use LICENSEIT.

---

## Part 2: Using LICENSEIT from the command line

### Uploading a licensed file

A license is a small JSON file that lives next to the data, so the exact approved rights text stays under version control. `samples/example.license.json` is a working template:

```json
{
  "licenseId": "LIC-EXAMPLE-001",
  "rightsHolder": "Example Archive Ltd",
  "permittedUse": "training",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "source": "Signed data license agreement, section 4"
}
```

`permittedUse` is one of `training`, `inference`, or `evaluation`. `expiresAt` must be a full ISO 8601 timestamp in the future. `source` is where you got the data lawfully, and it is required because "we have a license" is not auditable without saying which one.

Upload one file:

```
npm run upload:file -- \
  --file samples/example-dataset.txt \
  --license samples/example.license.json \
  --blob-name LICENSEIT/example-dataset.txt \
  --days 7
```

You will see the blob name, its merkle root, the license summary, and when the blob expires in storage.

Upload a whole directory, with a JSON object mapping each file name to its license:

```
npm run upload:dataset -- --dir samples --licenses samples/licenses.json --prefix LICENSEIT/ --days 7
```

`--days` is how long Shelby stores the blob, which is a separate question from how long the license permits use. A dataset upload validates *every* license before the first network call and aborts the whole batch if any file is unlicensed, expired, or missing. A half-uploaded dataset is worse than none, because a training run against it looks complete while quietly missing assets.

Confirm what is stored:

```
shelby account blobs
```

### What the manifest is

Every successful upload appends to `data/manifest.json`:

```json
{
  "blobName": "LICENSEIT/example-dataset.txt",
  "merkleRoot": "0x329a2fec6d645d1a85e9a47a5f2e8e94fb3fc7bfec207f2aa868ddb7e4580947",
  "license": { "licenseId": "LIC-EXAMPLE-001", "permittedUse": "training", "...": "..." },
  "uploadedAt": "2026-08-16T19:56:59.157Z",
  "blobExpiresAt": "2026-08-23T19:56:59.157Z",
  "sizeBytes": 99
}
```

That entry is real, and so is every hash and timestamp quoted in this README. They come from running these exact commands against Shelbynet.

Shelby stores bytes and commitments, not rights information, so the blob-to-license mapping has to live somewhere the read path can consult before serving anything. This file is that place. It resolves relative to the project directory rather than your shell's working directory, so the CLI and the website always see the same manifest. It is written by writing a temp file and renaming it over the target, so a crash cannot leave you with half-written JSON. It is gitignored because it describes one operator's uploads.

The `merkleRoot` is what Shelby computed from the file's commitments, and it matches what `shelby commitment <file> <out.json>` reports for the same bytes.

### Reading a file

```
npm run read:blob -- \
  --blob-name LICENSEIT/example-dataset.txt \
  --reader trainer-1 \
  --run run-final \
  --use training
```

Output from an actual run:

```
Read LICENSEIT/example-dataset.txt (99 bytes)
  served by account: 0x95a9e0179f40d0cea2642fe26786fe67fa16d21edbff267746262fdfb06c9be8
  merkle root: 0x329a2fec6d645d1a85e9a47a5f2e8e94fb3fc7bfec207f2aa868ddb7e4580947
  matches upload root: true
  content sha256: 0x1f283beecdc92fcccd539d71f9272b22001d7998a7a31b3582d3d5d7d5c91837
  served at: 2026-08-16T19:57:47.962Z
  license: LIC-EXAMPLE-001 (Example Archive Ltd) for training, expires 2027-01-01T00:00:00.000Z
  read event: reader trainer-1, run run-final
  receipt log txn: 0xfaa3f66987cc206f7cd2b7f4fc90d5523de78c88afb5441fe91e3925aba338ef
```

`--reader` and `--run` are required, because a read that cannot be attributed to a reader and a training run cannot be audited.

Try declaring a use the license does not permit:

```
npm run read:blob -- --blob-name LICENSEIT/example-dataset.txt --reader trainer-1 --run run-final --use inference
```

```
License LIC-EXAMPLE-001 permits training, not inference.
```

That refusal happens *before* the download. Checking first means an unauthorized read never fetches the bytes, so there is nothing to leak. Reads are also refused for any blob with no manifest entry, because an asset whose license is unknown is not an asset LICENSEIT will serve.

All reads go through one function, `readLicensedBlob` in `src/read/receiptMiddleware.ts`. It is the only code in the project that downloads from Shelby, so training code has no path around the license check.

### What is in a receipt

The installed SDK, version 0.7.1, returns `Promise<ShelbyBlob>` from `client.download(...)`, and `ShelbyBlob` is `{ account, name, readable, contentLength }`. There is no receipt, signature, or proof field anywhere in its public types. So the middleware assembles a receipt from what a read verifiably produces:

| Field | Where it comes from |
| --- | --- |
| `blobName` | the blob that was requested |
| `servedByAccount` | the account the RPC served it from |
| `merkleRoot` | recomputed from the bytes that arrived |
| `contentSha256` | SHA-256 of the bytes that arrived |
| `servedBytes` | `contentLength` reported by the RPC |
| `servedAt` | when the read completed |
| `merkleRootMatchesManifest` | whether the recomputed root equals the root from upload |

Recomputing the root with the same `generateCommitments` the upload used is the verification step. It only matches if the bytes served are the bytes that were stored, so a mismatch means the content changed and the middleware refuses to return it rather than handing back unverified data. No receipt field comes from caller input, so a caller cannot fabricate what was served.

If you get `429 Too Many Requests`, you have hit the anonymous rate limit on the shared Shelbynet RPC. The Shelby CLI fails the same way under the same conditions, so it is a throttle and not a bug. Wait out the window, or set `SHELBY_API_KEY` in `.env`.

### The on-chain receipt log

`move/sources/receipt_log.move` is the audit chain of record. It emits one `ReadLogged` event per read with `blob_hash`, `license_id`, `reader`, `training_run_id`, and `timestamp_us`. Nothing is stored mutably, because an audit log that can be edited proves nothing, while events are permanent in transaction history.

Two fields are deliberately *not* function arguments. `reader` comes from `signer::address_of(account)`, so nobody can log a read under someone else's identity. `timestamp_us` comes from `timestamp::now_microseconds()`, so a caller with a wrong or dishonest clock cannot place a read outside its license window. The entry function also rejects an empty blob hash, license ID, or run ID, since none of those can be audited.

Resolve any receipt yourself:

```
curl -s https://api.shelbynet.shelby.xyz/v1/transactions/by_hash/<txnHash> | jq '.events'
```

`src/audit/chainWriter.ts` submits `log_read` and waits for the transaction to commit before returning. Waiting matters: a submitted transaction can still fail during execution, and an unconfirmed receipt is not a logged receipt. If the chain write fails, the read fails too and the caller gets nothing, even though the bytes were already fetched. That is deliberate. The guarantee is that every served read is logged, so a read the audit trail does not contain must not look like a success.

### The audit report

```
npm run audit:run -- --run run-final
```

```
Audit report for training run run-final
  generated at: 2026-08-16T19:59:22.546Z
  verdict: COMPLIANT
  reads logged on chain: 1 (1 compliant, 1 distinct blobs)

  OK   LICENSEIT/example-dataset.txt
       read at 2026-08-16T19:57:50.270Z by 0x95a9e017...
       license LIC-EXAMPLE-001 (Example Archive Ltd, training, expires 2027-01-01T00:00:00.000Z)
       txn 0xfaa3f66987cc206f7cd2b7f4fc90d5523de78c88afb5441fe91e3925aba338ef
```

Each run also writes `reports/audit-<runId>-<date>.md`, which is the artifact you actually hand an auditor. It has the verdict, a table of every read with status, license, rights holder, permitted use, reader, and time, a findings section when something is flagged, and a verification section repeating every blob hash and transaction hash with the exact `curl` that resolves it. That last section is the point of the format: a report the reader cannot independently check is a claim, not evidence.

`--out` picks a different destination, where a `.json` extension writes JSON instead of Markdown, and `--json` prints JSON to stdout. Generated reports are gitignored since they describe one operator's reads; `reports/.gitkeep` keeps the directory on a fresh clone. The run ID becomes part of a file name, so it is restricted to letters, digits, dot, dash, and underscore, and an `--out` path that resolves outside the project is refused.

**The command exits non-zero when a run is not compliant**, so a CI job or release gate can block a model whose training data cannot be shown to have been licensed.

Each read is judged against the license as it stood at that read's chain timestamp, not against the current time. This is the heart of the design. A license that has since expired does not invalidate a read that happened while it was live, and comparing against "now" would both condemn lawful reads and clear reads that happened after expiry. Four verdicts are possible:

- `compliant` — the license covered this read at the time it happened
- `expired-at-read` — the read postdates the license expiry
- `unlicensed` — the license on chain disagrees with the manifest, or its expiry is unreadable
- `unknown-blob` — no manifest entry matches the logged blob hash

A run with **no** logged reads is reported as not compliant, because an empty audit trail is an absence of evidence rather than evidence of compliance.

Reads are matched to licenses by merkle root, not by blob name. The hash identifies the exact bytes served, whereas a name could later be pointed at different content.

One implementation note: the Shelbynet indexer's GraphQL schema exposes no `events` root field, confirmed by introspecting `query_root`, so the usual indexer event query is unavailable on this network. `src/audit/chainQuery.ts` uses the fullnode's account transactions endpoint instead, which returns each transaction with its events inline. That scopes the audit to the logging account's own transactions, which is correct for LICENSEIT, where one operator account writes every receipt. A malformed event is skipped rather than thrown on, because one unparseable transaction must not make an entire audit unavailable.

---

## Part 3: Using the website

`web/` is a Material Design 3 site over the exact same functions the CLI uses.

```
cd web
npm install
npm run dev
```

That starts two processes: the API on `http://localhost:8787` and the UI on `http://localhost:5173`. Open the UI and you get three destinations matching the three operations.

- **Upload** takes a file and its license fields, and shows you the blob name, merkle root, and size that came back from Shelby.
- **Read** takes a blob name, reader ID, run ID, and declared use, then shows the receipt with a link to the transaction on the Aptos explorer.
- **Audit** takes a run ID and shows the verdict with every logged read.

The API in `web/server/index.ts` holds no business logic. Uploads call `uploadLicensedFile`, reads call `readLicensedBlob`, audits call `generateAuditReport`. The license rules and receipt handling are the ones already covered by tests, not a second implementation that could drift. The server exists for exactly one reason: the signing key must stay in a Node process. Signing in a browser would ship the key to every visitor, so the browser sends a request and the server does anything that costs money or touches the key.

A refused read shows up as a normal result rather than an error, because a refused read is the system working correctly. A license permitting `evaluation` will decline a `training` read and tell you why, using the reason the middleware produced.

Theme values all come from `web/src/theme/m3Tokens.ts`, one generated stylesheet of M3 tokens. Both the Material components and the layout CSS read those tokens, so there is no second palette to keep in sync and no raw hex anywhere else. Uploads are capped at 1 MB and the two routes that spend tokens are rate limited, because anyone who can reach the port can otherwise spend your balance. Build the production bundle with `npm run build`, which type checks first and fails on any type error.

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| `Missing required environment variables: ...` | `.env` is incomplete. Every name listed is required. |
| `INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE` | Out of APT for gas. Rerun `./scripts/fundAccount.sh`. |
| `E_INSUFFICIENT_FUNDS` | Out of ShelbyUSD for storage. Rerun the fund script. |
| `429 ... Per anonymous IP rate limit exceeded` | Shared RPC throttle. Wait out the window or set `SHELBY_API_KEY`. |
| `Blob '...' has no manifest entry` | Nothing was uploaded under that name from this project directory. |
| `License ... permits training, not inference` | Working as intended. The declared use is not what the license allows. |
| `Blob '...' failed verification` | Served bytes do not match the root recorded at upload. Content changed. |

## Layout

`src/config` loads environment configuration. `src/licenses` holds the license type and its validation. `src/upload` holds the upload pipeline and the manifest. `src/read` holds the receipt middleware, the single door to Shelby downloads. `src/audit` holds the chain writer, the chain queries, and the report generator. `src/shelby` holds the shared client. `move` holds the Aptos module that records receipts. `scripts` holds operational shell scripts. `tests` holds the test suite. `web` holds the site, with `web/server` for the API, `web/src/views` for the three screens, and `web/src/theme` for design tokens.

## Security

`SECURITY.md` documents the threat model, where the private key is read and why nowhere else, the validation at every boundary, the two Move decisions that make the receipt log hard to forge, and the known limitations. The gaps are listed there on purpose: the local API has no authentication, the manifest is unsigned, and one key performs every role. Each is acceptable for a single-operator deployment and would need addressing before this ran as a shared service.
