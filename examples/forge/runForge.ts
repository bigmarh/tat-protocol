import { createTATForgeWithKey } from "@tat-protocol/tdk";
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";
import { NodeStore } from "@tat-protocol/storage";
import { defaultConfig } from "./defaultConfig";

// Test keys
const secretKey =
  "f4c438fe22a763b9f9d70eaa4f91ef6e5806e3ac6f1afa79da6ce258649f4f2c";
const publicKey = getPublicKey(hexToBytes(secretKey));

console.log("\n-------------KEYS-------------------");
console.log("Secret Key:", secretKey);
console.log("Public Key:", publicKey);
console.log("-------------KEYS-------------------\n");

// Create and run the forge
async function runForge() {
  try {
    const forge = await createTATForgeWithKey({
      secretKey,
      owner: "aaa266a87d1c24a11b9509cc74e1eaf2db8ca2a563be0c1a429917acd4d1f37d",
      storage: new NodeStore(),
      relays: defaultConfig.relays,
    });

    console.log("\n-------------FORGE-------------------");
    console.log("Owner:", forge.owner);
    console.log("Authorized forgers:", forge.getAuthorizedForgers());
    console.log("-------------FORGE-------------------\n");

    console.log("\nForge is running. Press Ctrl+C to exit.\n");

    // Keep the process running
    process.on("SIGINT", () => {
      console.log("\nShutting down forge...");
      process.exit(0);
    });

    // Keep the process alive
    setInterval(() => {
      // Keep the event loop running
    }, 1000);
  } catch (error) {
    console.error("Failed to initialize forge:", error);
    process.exit(1);
  }
}

runForge().catch(console.error);
