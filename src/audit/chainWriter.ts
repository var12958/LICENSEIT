import {
    Account,
    Aptos,
    AptosConfig,
    Ed25519PrivateKey,
    Network,
    type InputGenerateTransactionPayloadData,
} from "@aptos-labs/ts-sdk";
import { loadLICENSEITEnv } from "../config/env.js";
import type { ReadEvent } from "../read/receiptMiddleware.js";

/**
 * Writes read receipts to the receipt_log Move module published in Sprint 4.
 *
 * Argument encoding follows the entry function signature the published module
 * reports at
 * /v1/accounts/<address>/module/receipt_log:
 *   log_read(&signer, vector<u8>, 0x1::string::String, 0x1::string::String)
 * The signer is supplied by the transaction sender and is not an argument, so
 * functionArguments carries exactly three values in that order. Confirmed against
 * https://aptos.dev/build/sdks/ts-sdk for transaction building and submission.
 */
const RECEIPT_LOG_MODULE_NAME = "receipt_log";
const LOG_READ_FUNCTION_NAME = "log_read";

/** Narrow slice of the Aptos SDK the writer needs, so tests can stub it. */
export interface ReceiptLogSubmitter {
    submit(payload: InputGenerateTransactionPayloadData): Promise<string>;
}

export interface LogReadOnChainParams {
    event: ReadEvent;
    submitter?: ReceiptLogSubmitter;
}

/**
 * A hex merkle root becomes the on-chain vector<u8> by decoding it to bytes,
 * because the module stores the hash itself rather than its text form. Decoding
 * here also rejects a malformed root before a transaction is paid for.
 */
export function decodeHexToBytes(hex: string): Uint8Array {
    const body = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (body.length === 0 || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
        throw new Error(
            `Blob hash '${hex}' is not an even-length hex string, so it cannot be logged on chain.`,
        );
    }
    const bytes = new Uint8Array(body.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

/** Built once per process. Each Aptos instance opens its own connection pool. */
let cachedSubmitter: ReceiptLogSubmitter | undefined;

export function createAptosReceiptLogSubmitter(): ReceiptLogSubmitter {
    if (cachedSubmitter) {
        return cachedSubmitter;
    }

    const env = loadLICENSEITEnv();
    const aptos = new Aptos(
        new AptosConfig({
            network: Network.CUSTOM,
            fullnode: env.aptosFullnode,
            indexer: env.aptosIndexer,
        }),
    );

    let signer: Account;
    try {
        signer = Account.fromPrivateKey({
            privateKey: new Ed25519PrivateKey(env.accountPrivateKey),
        });
    } catch {
        // The cause is dropped on purpose. Aptos key parsing errors can echo the
        // key material back in the message.
        throw new Error(
            "SHELBY_ACCOUNT_PRIVATE_KEY is not a valid ed25519 private key, so receipts cannot be signed.",
        );
    }

    cachedSubmitter = {
        async submit(payload) {
            const transaction = await aptos.transaction.build.simple({
                sender: signer.accountAddress,
                data: payload,
            });
            const pending = await aptos.signAndSubmitTransaction({
                signer,
                transaction,
            });
            // Waiting matters: a submitted transaction can still fail during
            // execution, and an unconfirmed receipt is not a logged receipt.
            const committed = await aptos.waitForTransaction({
                transactionHash: pending.hash,
            });
            if (!committed.success) {
                throw new Error(
                    `Receipt log transaction ${pending.hash} failed on chain: ${committed.vm_status}`,
                );
            }
            return pending.hash;
        },
    };
    return cachedSubmitter;
}

/**
 * Anchors one read on chain and returns the transaction hash. The reader address
 * and timestamp are deliberately absent from the arguments: the module derives
 * the reader from the transaction signer and the timestamp from chain time, so
 * neither can be forged by this code or its callers.
 */
export async function logReadOnChain(params: LogReadOnChainParams): Promise<string> {
    const { event } = params;
    if (event.licenseId.trim() === "") {
        throw new Error("licenseId is required to log a read on chain.");
    }
    if (event.trainingRunId.trim() === "") {
        throw new Error("trainingRunId is required to log a read on chain.");
    }

    const env = loadLICENSEITEnv();
    const submitter = params.submitter ?? createAptosReceiptLogSubmitter();

    try {
        return await submitter.submit({
            function: `${env.receiptLogModuleAddress}::${RECEIPT_LOG_MODULE_NAME}::${LOG_READ_FUNCTION_NAME}`,
            functionArguments: [
                decodeHexToBytes(event.blobHash),
                event.licenseId,
                event.trainingRunId,
            ],
        });
    } catch (cause) {
        // Only the message is forwarded. Aptos client errors can carry the request
        // config, and config carries credentials.
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
            `Failed to log read of blob ${event.blobHash} for run ${event.trainingRunId} on chain: ${detail}`,
        );
    }
}
