import { createFungibleForgeWithKey } from "@tat-protocol/tdk";
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";
import { NodeStore } from "@tat-protocol/storage";
import { defaultConfig } from "./defaultConfig";

// Test keys
const secretKey =
  "051815aa8466771574e94fad8a87c27eaeb0c73da9d0a5b9dea4a4c12e9408ba";
const publicKey = getPublicKey(hexToBytes(secretKey));

console.log("\n\n-------------KEYS-------------------");
console.log("Secret Key:", secretKey);
console.log("Public Key:", publicKey);
console.log("-------------KEYS-------------------\n");

// Create and run the fungible token forge
async function runFungibleForge() {
  try {
    const forge = await createFungibleForgeWithKey({
      secretKey,
      owner: "aaa266a87d1c24a11b9509cc74e1eaf2db8ca2a563be0c1a429917acd4d1f37d",
      storage: new NodeStore(),
      relays: defaultConfig.relays,
      totalSupply: 100000000,
    });

    console.log("\n-------------FORGE-------------------");
    console.log("Asset Name: Example Fungible Token");
    console.log("Owner:", forge.owner);
    console.log("Authorized forgers:", forge.getAuthorizedForgers());
    console.log("-------------FORGE-------------------\n");

    console.log("\nForge is running. Press Ctrl+C to exit.\n");

    // Keep the process running
    process.on("SIGINT", () => {
      console.log("\nShutting down fungible forge...");
      process.exit(0);
    });

    // Keep the process alive
    setInterval(() => {
      // Keep the event loop running
    }, 1000);
  } catch (error) {
    console.error("Failed to initialize fungible forge:", error);
    process.exit(1);
  }
}

// Run the forge
runFungibleForge().catch(console.error);
