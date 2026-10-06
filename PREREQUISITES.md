# What is needed from you to run this yourself

All eight sprints are complete, so nothing here blocks development. This file is
now a checklist for a fresh machine: the steps that need a browser, a human
decision, or a globally installed tool, collected in one place so they can be done
in a single pass rather than discovered one failure at a time.

## Required

### Node.js v22 or later

Everything in `src/` and `web/` targets Node 22. Check with `node --version`.

### The Shelby CLI, and an account

```
npm install -g @shelby-protocol/cli
shelby init --setup-default
```

`shelby init` creates the account and writes `~/.shelby/config.yaml` with
shelbynet as the default context. Copy the printed address and private key into
`.env`, using `.env.example` as the template. That key is the one LICENSEIT signs
with, so it stays in `.env` and nowhere else.

### Faucet funds

Uploads cost ShelbyUSD and every transaction costs APT for gas, so the account
needs both before anything will work:

```
./scripts/fundAccount.sh
shelby account balance
```

If the faucet service rejects the scripted request, the browser page is the
fallback and the only step that genuinely needs a human:

```
shelby faucet --network shelbynet --no-open
```

Open the printed URL and complete the request there. The faucet has per-window
limits, so top up when a balance is actually low rather than in advance. The
website spends ShelbyUSD faster than the CLI does, because a browser form invites repeated
uploads, which is why uploads through the site are capped at 1 MB.

### The Aptos CLI, to publish the Move module

```
brew install aptos
aptos --version
```

The module has to be published before any read can be logged, since
`readLicensedBlob` writes the receipt on chain before returning content. Create a
profile from the key already in `.env`, so no second account exists:

```
aptos init --profile shelbynet --network custom \
  --rest-url https://api.shelbynet.shelby.xyz/v1 --skip-faucet --private-key <key>
```

Then from `move/`:

```
aptos move test --named-addresses receipt_log=<address>
aptos move publish --profile shelbynet --named-addresses receipt_log=<address>
```

Record the published address in `.env` as `RECEIPT_LOG_MODULE_ADDRESS`. It is the
publisher's address, so it equals `SHELBY_ACCOUNT_ADDRESS` unless the module was
published from somewhere else.

## Optional

### A Shelby API key

Reads against the shared Shelbynet RPC without a key are rate limited, and the RPC
answers `429 Too Many Requests` when the limit is hit. That is a throttle rather
than a defect, and the Shelby CLI fails the same way under the same conditions.
Setting `SHELBY_API_KEY` in `.env` raises the limit. Without it, wait and retry.

## Confirming everything is in place

```
npm install
npx tsc --noEmit
npm test
(cd web && npm install && npm run build)
shelby account balance
git status --ignored
```

The type check, tests, and web build should pass, both balances should be nonzero,
and `.env` should appear under ignored files rather than tracked ones. If the last
point is not true, stop and fix it before committing anything.
