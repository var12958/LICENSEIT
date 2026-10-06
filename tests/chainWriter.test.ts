import assert from "node:assert/strict";
import test from "node:test";
import {
    decodeHexToBytes,
    logReadOnChain,
    type ReceiptLogSubmitter,
} from "../src/audit/chainWriter.js";
import type { ReadEvent } from "../src/read/receiptMiddleware.js";

/**
 * logReadOnChain reads RECEIPT_LOG_MODULE_ADDRESS through loadLICENSEITEnv, so these
 * tests set the variables in the process environment rather than relying on a .env
 * file. Process variables take precedence, which keeps the tests independent of
 * whatever the local .env holds.
 */
process.env.SHELBY_ACCOUNT_ADDRESS = "0x1";
process.env.SHELBY_ACCOUNT_PRIVATE_KEY = "ed25519-priv-0x1";
process.env.APTOS_NETWORK = "shelbynet";
process.env.SHELBY_RPC_ENDPOINT = "https://api.shelbynet.shelby.xyz/shelby";
process.env.APTOS_FULLNODE = "https://api.shelbynet.shelby.xyz/v1";
process.env.APTOS_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
process.env.RECEIPT_LOG_MODULE_ADDRESS = "0xfeed";

const MERKLE_ROOT = "0x329a2fec6d645d1a85e9a47a5f2e8e94fb3fc7bfec207f2aa868ddb7e4580947";

function readEvent(overrides: Partial<ReadEvent> = {}): ReadEvent {
    return {
        blobHash: MERKLE_ROOT,
        licenseId: "LIC-EXAMPLE-001",
        readerId: "trainer-1",
        trainingRunId: "run-sprint4",
        timestamp: "2026-08-16T15:24:00.589Z",
        receiptPayload: {
            blobName: "LICENSEIT/example-dataset.txt",
            servedByAccount: "0xabc",
            merkleRoot: MERKLE_ROOT,
            contentSha256: "0xdeadbeef",
            servedBytes: 99,
            servedAt: "2026-08-16T15:24:00.589Z",
            merkleRootMatchesManifest: true,
        },
        ...overrides,
    };
}

function createRecordingSubmitter(hash = "0xtxn"): ReceiptLogSubmitter & {
    payloads: unknown[];
} {
    const payloads: unknown[] = [];
    return {
        payloads,
        async submit(payload) {
            payloads.push(payload);
            return hash;
        },
    };
}

test("decodeHexToBytes converts a merkle root to the bytes the module stores", () => {
    assert.deepEqual(Array.from(decodeHexToBytes("0x00ff10")), [0, 255, 16]);
    assert.deepEqual(Array.from(decodeHexToBytes("ab")), [171]);
    assert.equal(decodeHexToBytes(MERKLE_ROOT).length, 32);
});

test("decodeHexToBytes rejects malformed hashes before a transaction is paid for", () => {
    assert.throws(() => decodeHexToBytes("0x"), /not an even-length hex string/);
    assert.throws(() => decodeHexToBytes("0xabc"), /not an even-length hex string/);
    assert.throws(() => decodeHexToBytes("0xzz"), /not an even-length hex string/);
});

test("logReadOnChain builds the entry function payload the published module expects", async () => {
    const submitter = createRecordingSubmitter("0xabc123");

    const hash = await logReadOnChain({ event: readEvent(), submitter });

    assert.equal(hash, "0xabc123");
    assert.equal(submitter.payloads.length, 1);
    const payload = submitter.payloads[0] as {
        function: string;
        functionArguments: unknown[];
    };
    assert.equal(payload.function, "0xfeed::receipt_log::log_read");
    // Three arguments, not five. The reader address and timestamp are absent
    // because the module derives them from the signer and from chain time.
    assert.equal(payload.functionArguments.length, 3);
    assert.deepEqual(
        Array.from(payload.functionArguments[0] as Uint8Array),
        Array.from(decodeHexToBytes(MERKLE_ROOT)),
    );
    assert.equal(payload.functionArguments[1], "LIC-EXAMPLE-001");
    assert.equal(payload.functionArguments[2], "run-sprint4");
});

test("logReadOnChain refuses an event with no license id", async () => {
    const submitter = createRecordingSubmitter();

    await assert.rejects(
        logReadOnChain({ event: readEvent({ licenseId: "  " }), submitter }),
        /licenseId is required/,
    );
    assert.deepEqual(submitter.payloads, []);
});

test("logReadOnChain refuses an event with no training run id", async () => {
    const submitter = createRecordingSubmitter();

    await assert.rejects(
        logReadOnChain({ event: readEvent({ trainingRunId: "" }), submitter }),
        /trainingRunId is required/,
    );
    assert.deepEqual(submitter.payloads, []);
});

test("logReadOnChain propagates a submission failure with context and no cause chain", async () => {
    const failingSubmitter: ReceiptLogSubmitter = {
        async submit() {
            throw new Error("SEQUENCE_NUMBER_TOO_OLD at https://api.shelbynet.shelby.xyz/v1");
        },
    };

    await assert.rejects(
        logReadOnChain({ event: readEvent(), submitter: failingSubmitter }),
        (error: unknown) =>
            error instanceof Error &&
            error.message.startsWith(`Failed to log read of blob ${MERKLE_ROOT} for run run-sprint4 on chain:`) &&
            error.cause === undefined,
    );
});
