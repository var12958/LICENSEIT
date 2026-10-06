import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { loadLICENSEITEnv } from "../config/env.js";

/**
 * Reads ReadLogged events back off Shelbynet.
 *
 * The Shelbynet indexer's GraphQL schema exposes no `events` root field, checked by
 * introspecting query_root at https://api.shelbynet.shelby.xyz/v1/graphql, so the
 * usual indexer event query is unavailable here. Account transactions are used
 * instead: the fullnode REST endpoint
 * /v1/accounts/<address>/transactions returns each transaction with its events
 * inline, which is exactly what the audit needs and does not depend on the indexer
 * being deployed with event tables.
 *
 * The consequence is that this queries the logging account's own transactions. That
 * is the correct scope for LICENSEIT, where one operator account writes the
 * receipts. A multi-writer deployment would need an indexer with event support.
 */
const READ_LOGGED_EVENT_SUFFIX = "::receipt_log::ReadLogged";

/** One ReadLogged event, decoded into the shape the report generator consumes. */
export interface OnChainReadReceipt {
    blobHash: string;
    licenseId: string;
    /** Address the module derived from the transaction signer. */
    reader: string;
    trainingRunId: string;
    /** Chain time in microseconds, as emitted by the module. */
    timestampUs: number;
    /** ISO form of timestampUs, for reports. */
    timestamp: string;
    transactionHash: string;
    transactionVersion: string;
}

/** Injected so tests can supply transactions without a network or a chain. */
export interface ReceiptTransactionSource {
    fetchTransactions(offset: number, limit: number): Promise<unknown[]>;
}

const PAGE_SIZE = 100;

export function createAptosTransactionSource(): ReceiptTransactionSource {
    const env = loadLICENSEITEnv();
    const aptos = new Aptos(
        new AptosConfig({
            network: Network.CUSTOM,
            fullnode: env.aptosFullnode,
            indexer: env.aptosIndexer,
        }),
    );
    return {
        async fetchTransactions(offset, limit) {
            return aptos.getAccountTransactions({
                accountAddress: env.accountAddress,
                options: { offset, limit },
            });
        },
    };
}

/**
 * Event payload fields arrive as JSON, so every one is validated before it reaches
 * a report. A malformed event is skipped rather than throwing, because one unparseable
 * transaction in the account's history must not make the whole audit unavailable.
 */
function decodeEvent(
    data: unknown,
    transactionHash: string,
    transactionVersion: string,
): OnChainReadReceipt | undefined {
    if (typeof data !== "object" || data === null) {
        return undefined;
    }
    const record = data as Record<string, unknown>;
    const blobHash = record.blob_hash;
    const licenseId = record.license_id;
    const reader = record.reader;
    const trainingRunId = record.training_run_id;
    const timestampUsRaw = record.timestamp_us;

    if (
        typeof blobHash !== "string" ||
        typeof licenseId !== "string" ||
        typeof reader !== "string" ||
        typeof trainingRunId !== "string" ||
        (typeof timestampUsRaw !== "string" && typeof timestampUsRaw !== "number")
    ) {
        return undefined;
    }

    // u64 microseconds arrive as a string. Number is exact for values this size,
    // since epoch microseconds stay well under Number.MAX_SAFE_INTEGER until year 287396.
    const timestampUs = Number(timestampUsRaw);
    if (!Number.isFinite(timestampUs)) {
        return undefined;
    }

    return {
        blobHash,
        licenseId,
        reader,
        trainingRunId,
        timestampUs,
        timestamp: new Date(timestampUs / 1000).toISOString(),
        transactionHash,
        transactionVersion,
    };
}

export interface FetchReadReceiptsParams {
    source?: ReceiptTransactionSource;
    /** Module address whose ReadLogged events count. Defaults to the configured one. */
    moduleAddress?: string;
    /** Safety bound so a long account history cannot page forever. */
    maxTransactions?: number;
}

/**
 * Returns every ReadLogged event the logging account has emitted, oldest first.
 * Ordering is by chain timestamp rather than by the order the RPC returned them,
 * so a report reads as a chronological trail regardless of paging behaviour.
 */
export async function fetchReadReceipts(
    params: FetchReadReceiptsParams = {},
): Promise<OnChainReadReceipt[]> {
    const source = params.source ?? createAptosTransactionSource();
    const moduleAddress = params.moduleAddress ?? loadLICENSEITEnv().receiptLogModuleAddress;
    const maxTransactions = params.maxTransactions ?? 1000;
    const expectedTypeSuffix = READ_LOGGED_EVENT_SUFFIX;

    const receipts: OnChainReadReceipt[] = [];
    let offset = 0;

    while (offset < maxTransactions) {
        const limit = Math.min(PAGE_SIZE, maxTransactions - offset);
        let page: unknown[];
        try {
            page = await source.fetchTransactions(offset, limit);
        } catch (cause) {
            // Only the message is forwarded. Aptos client errors can carry request
            // configuration, and configuration carries credentials.
            const detail = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Failed to read the on-chain receipt log: ${detail}`);
        }
        if (page.length === 0) {
            break;
        }

        for (const transaction of page) {
            const record = transaction as {
                hash?: unknown;
                version?: unknown;
                events?: unknown;
            };
            if (!Array.isArray(record.events)) {
                continue;
            }
            const transactionHash = typeof record.hash === "string" ? record.hash : "";
            const transactionVersion = String(record.version ?? "");

            for (const event of record.events) {
                const eventRecord = event as { type?: unknown; data?: unknown };
                if (typeof eventRecord.type !== "string") {
                    continue;
                }
                // Matching the full type, address included, keeps events emitted by a
                // different deployment of the same module out of LICENSEIT's audit.
                if (eventRecord.type !== `${moduleAddress}${expectedTypeSuffix}`) {
                    continue;
                }
                const decoded = decodeEvent(eventRecord.data, transactionHash, transactionVersion);
                if (decoded) {
                    receipts.push(decoded);
                }
            }
        }

        if (page.length < limit) {
            break;
        }
        offset += page.length;
    }

    return receipts.sort((left, right) => left.timestampUs - right.timestampUs);
}

/** Filters to one training run. Kept here so callers do not re-implement matching. */
export function selectRunReceipts(
    receipts: OnChainReadReceipt[],
    trainingRunId: string,
): OnChainReadReceipt[] {
    return receipts.filter((receipt) => receipt.trainingRunId === trainingRunId);
}
