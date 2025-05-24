import { Forge } from "@tat-protocol/forge";
import { ForgeConfig } from "@tat-protocol/forge";
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";
import { Storage } from "@tat-protocol/storage";
import { TokenType } from "@tat-protocol/token";
import { defaultConfig } from "./defaultConfig";

// Test keys
const secretKey =
  "051815aa8466771574e94fad8a87c27eaeb0c73da9d0a5b9dea4a4c12e9408ba";
const publicKey = getPublicKey(hexToBytes(secretKey));

console.log("\n\n-------------KEYS-------------------");
console.log("Secret Key:", secretKey);
console.log("Public Key:", publicKey);
console.log("-------------KEYS-------------------\n");


// Create forge config for TATUSD fungible token
const config: ForgeConfig = {
  owner: "aaa266a87d1c24a11b9509cc74e1eaf2db8ca2a563be0c1a429917acd4d1f37d",
  keys: {
    secretKey,
    publicKey,
  },
  totalSupply: 100000000,
  authorizedForgers: [publicKey], // Authorize ourselves
  storage: new Storage(), // Use default storage
  tokenType: TokenType.FUNGIBLE, // Set token type to fungible
  relays: defaultConfig.relays,
};

// Create and run the fungible token forge
async function runFungibleForge() {
  try {
    const forge = new Forge(config);
    await forge.initialize(); // Wait for initialization to complete

    console.log("\n-------------FORGE-------------------");
    console.log("Asset Name: TATUSD");
    console.log("Owner:", forge.owner);
    console.log("Authorized forgers:", forge.getAuthorizedForgers());
    console.log("-------------FORGE-------------------\n");

    console.log("\nForge is running. Press Ctrl+C to exit.\n");

    // Keep the process running
    process.on("SIGINT", () => {
      console.log("\nShutting down TATUSD forge...");
      process.exit(0);
    });

    // Keep the process alive
    setInterval(() => {
      // Keep the event loop running
    }, 1000);
  } catch (error) {
    console.error("Failed to initialize TATUSD forge:", error);
    process.exit(1);
  }
}

// Run the forge
runFungibleForge().catch(console.error);
