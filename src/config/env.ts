import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Environment variables this project needs. The names match .env.example, which
 * documents each one with a zero-filled placeholder. The private key is read
 * here and nowhere else, and is never included in error messages or logs.
 */
export interface LICENSEITEnv {
    accountAddress: string;
    accountPrivateKey: string;
    aptosNetwork: string;
    shelbyRpcEndpoint: string;
    aptosFullnode: string;
    aptosIndexer: string;
    /** Account the receipt_log Move module is published under. */
    receiptLogModuleAddress: string;
    /** Optional. Requests are rate limited harder without one. */
    shelbyApiKey?: string;
}

const REQUIRED_KEYS = [
    "SHELBY_ACCOUNT_ADDRESS",
    "SHELBY_ACCOUNT_PRIVATE_KEY",
    "APTOS_NETWORK",
    "SHELBY_RPC_ENDPOINT",
    "APTOS_FULLNODE",
    "APTOS_INDEXER",
    "RECEIPT_LOG_MODULE_ADDRESS",
] as const;

const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * The .env lives beside the project, not beside whoever happens to be calling.
 * The web API's working directory is web/, so a cwd-relative default made the
 * same install look unconfigured depending on which entry point you used. Real
 * process environment variables still win, which is how deployments should
 * supply these.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_ENV_FILE_PATH = resolve(PROJECT_ROOT, ".env");

/**
 * Minimal .env reader. A dependency is avoided because the format used here is
 * only KEY=value lines, and fewer dependencies means fewer packages that can
 * read process memory holding the private key.
 */
function readEnvFile(envFilePath: string): Record<string, string> {
    let raw: string;
    try {
        raw = readFileSync(envFilePath, "utf8");
    } catch (cause) {
        // A missing .env is normal when variables come from the real environment,
        // so this is not fatal on its own. Missing keys are reported below.
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
            return {};
        }
        throw new Error(`Could not read ${envFilePath}`, { cause });
    }

    const parsed: Record<string, string> = {};
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        parsed[key] = value.replace(/^["']|["']$/g, "");
    }
    return parsed;
}

/**
 * Loads configuration and fails immediately with every missing variable listed,
 * so a misconfigured setup is fixed in one pass instead of one error at a time.
 */
export function loadLICENSEITEnv(envFilePath = DEFAULT_ENV_FILE_PATH): LICENSEITEnv {
    const fileValues = readEnvFile(envFilePath);
    const resolveValue = (key: string): string | undefined => {
        const value = process.env[key] ?? fileValues[key];
        return value && value.trim() !== "" ? value.trim() : undefined;
    };

    const missing = REQUIRED_KEYS.filter((key) => resolveValue(key) === undefined);
    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(", ")}. ` +
            `Copy .env.example to .env and fill in the values printed by 'shelby init --setup-default'.`,
        );
    }

    const accountAddress = resolveValue("SHELBY_ACCOUNT_ADDRESS") as string;
    if (!HEX_ADDRESS.test(accountAddress)) {
        throw new Error(
            "SHELBY_ACCOUNT_ADDRESS must be a hex account address starting with 0x.",
        );
    }

    const receiptLogModuleAddress = resolveValue("RECEIPT_LOG_MODULE_ADDRESS") as string;
    if (!HEX_ADDRESS.test(receiptLogModuleAddress)) {
        throw new Error(
            "RECEIPT_LOG_MODULE_ADDRESS must be a hex account address starting with 0x. " +
            "It is the address printed by 'aptos move publish' for the receipt_log module.",
        );
    }

    return {
        accountAddress,
        accountPrivateKey: resolveValue("SHELBY_ACCOUNT_PRIVATE_KEY") as string,
        aptosNetwork: resolveValue("APTOS_NETWORK") as string,
        shelbyRpcEndpoint: resolveValue("SHELBY_RPC_ENDPOINT") as string,
        aptosFullnode: resolveValue("APTOS_FULLNODE") as string,
        aptosIndexer: resolveValue("APTOS_INDEXER") as string,
        receiptLogModuleAddress,
        shelbyApiKey: resolveValue("SHELBY_API_KEY"),
    };
}
