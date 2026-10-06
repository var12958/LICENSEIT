import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import {
    NetworkToDefaultLocationHint,
    ShelbyNodeClient,
} from "@shelby-protocol/sdk/node";
import { loadLICENSEITEnv, type LICENSEITEnv } from "../config/env.js";

/**
 * Client construction follows the official Node SDK setup at
 * https://docs.shelby.xyz/sdks/typescript/node, which takes
 * { network: Network.SHELBYNET, apiKey } and nothing else. The RPC and indexer
 * URLs in .env are recorded for operators and for CLI parity, and are passed
 * through here only when they differ from the SDK defaults for the network.
 */
export interface LICENSEITShelbyContext {
    client: ShelbyNodeClient;
    signer: Account;
    env: LICENSEITEnv;
}

let cachedContext: LICENSEITShelbyContext | undefined;

/**
 * Returns one shared client and signer for the whole process. A single instance
 * matters because each ShelbyClient lazily builds an erasure coding provider,
 * which is expensive to create per call.
 */
export function getShelbyContext(): LICENSEITShelbyContext {
    if (cachedContext) {
        return cachedContext;
    }

    const env = loadLICENSEITEnv();
    if (env.aptosNetwork !== Network.SHELBYNET) {
        throw new Error(
            `APTOS_NETWORK must be '${Network.SHELBYNET}' for this project, got '${env.aptosNetwork}'.`,
        );
    }

    let signer: Account;
    try {
        signer = Account.fromPrivateKey({
            privateKey: new Ed25519PrivateKey(env.accountPrivateKey),
        });
    } catch (cause) {
        // The cause is dropped deliberately. Key parsing errors from the Aptos SDK
        // can echo the key material back in the message.
        throw new Error(
            "SHELBY_ACCOUNT_PRIVATE_KEY is not a valid ed25519 private key. Re-copy it from 'shelby account list'.",
        );
    }

    if (signer.accountAddress.toString() !== env.accountAddress) {
        throw new Error(
            `SHELBY_ACCOUNT_ADDRESS does not match the address derived from SHELBY_ACCOUNT_PRIVATE_KEY (${signer.accountAddress.toString()}).`,
        );
    }

    const client = new ShelbyNodeClient({
        network: Network.SHELBYNET,
        apiKey: env.shelbyApiKey,
        rpc: { baseUrl: env.shelbyRpcEndpoint, apiKey: env.shelbyApiKey },
        indexer: { baseUrl: env.aptosIndexer, apiKey: env.shelbyApiKey },
        // Writes abort on chain with "No write location could be resolved" unless
        // the account has a location preference or the client sends a hint. The
        // CLI sets context.location_hint for the same reason, and
        // NetworkToDefaultLocationHint maps shelbynet to this region.
        locationHint: NetworkToDefaultLocationHint[Network.SHELBYNET],
    });

    cachedContext = { client, signer, env };
    return cachedContext;
}
