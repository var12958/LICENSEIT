import { evaluateAccessRequest } from "./policyEngine.js";
import { AccessDeniedError } from "./policyEngine.js";

function parseFlags(argv: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Flag --${key} requires a value.`);
        }
        flags[key] = value;
        index += 1;
    }
    return flags;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    const blobName = flags.blob ?? flags["blob-name"];
    const readerId = flags.reader ?? "Varun.v1";
    const organizationId = flags.org ?? flags.organization ?? "Example AI Labs";
    const trainingRunId = flags.run ?? "sentiment.v1";
    const operation = flags.op ?? flags.operation ?? "TRAINING";

    if (!blobName) {
        console.error("Usage: tsx src/access/cli.ts --blob <name> [--reader <id>] [--org <orgId>] [--run <runId>] [--op <TRAINING|INFERENCE>]");
        process.exitCode = 1;
        return;
    }

    console.log(`\nEvaluating access for dataset '${blobName}' [Operation: ${operation}, Reader: ${readerId}]...`);

    try {
        const result = await evaluateAccessRequest({
            blobName,
            readerId,
            organizationId,
            trainingRunId,
            operation,
        });

        console.log("\n=======================================================");
        console.log("✔ ACCESS GRANTED // LICENSE VERIFIED & DATASET SERVED");
        console.log("=======================================================");
        console.log(`Dataset:        ${result.receipt.blobName}`);
        console.log(`Bytes:          ${result.receipt.servedBytes}`);
        console.log(`Merkle Root:    ${result.receipt.merkleRoot} (Verified: ${result.merkleVerified})`);
        console.log(`License ID:     ${result.license.licenseId} (${result.license.rightsHolder})`);
        console.log(`Permitted:      ${result.license.permittedOperations?.join(", ") ?? result.license.permittedUse}`);
        console.log(`Aptos Txn:      ${result.receiptLogTransactionHash}`);
        console.log(`Explorer:       ${result.explorerUrl}`);
        if (result.contentString) {
            console.log("\nPreview (First 3 lines):");
            const preview = result.contentString.split("\n").slice(0, 3).join("\n");
            console.log(preview);
        }
        console.log("=======================================================\n");
    } catch (err: unknown) {
        if (err instanceof AccessDeniedError) {
            console.error("\n=======================================================");
            console.error("✖ ACCESS DENIED // POLICY ENFORCEMENT REFUSAL");
            console.error("=======================================================");
            console.error(`Violation:      ${err.eventType}`);
            console.error(`Reason:         ${err.message}`);
            console.error(`Action Taken:   ${err.violation.action}`);
            console.error(`Account Status: ${err.accountStatus} (violations: ${err.violationCount})`);
            console.error("Data was NOT served. Fail-closed protection triggered.");
            console.error("=======================================================\n");
        } else {
            console.error(`\nRequest failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
