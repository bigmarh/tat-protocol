import { Forge } from "@tat-protocol/forge";
import { ForgeConfig } from "@tat-protocol/forge";
import { generateSecretKey, getPublicKey } from "@tat-protocol/utils";
import { bytesToHex } from "@noble/hashes/utils";
import { Storage } from "@tat-protocol/storage";
import { TokenType } from "@tat-protocol/token";
import { defaultConfig } from "./defaultConfig";

// Test keys
const secretKey = generateSecretKey();
const publicKey = getPublicKey(secretKey);

console.log("Secret Key:", secretKey);
console.log("Public Key:", publicKey);

// Create forge config for TATUSD fungible token
const config: ForgeConfig = {
  owner: "aaa266a87d1c24a11b9509cc74e1eaf2db8ca2a563be0c1a429917acd4d1f37d",
  keys: {secretKey: bytesToHex(secretKey), publicKey: publicKey},
  totalSupply: 100000000,
  authorizedForgers: [publicKey], // Authorize ourselves
  storage: new Storage(), // Use default storage
  tokenType: TokenType.FUNGIBLE, // Set token type to fungible
  relays: defaultConfig.relays
};

// Create and run the fungible token forge
async function runFungibleForge() {
  try {
    const forge = new Forge(config);
    await forge.initialize(); // Wait for initialization to complete
    console.log("Forge public key", forge.getPublicKey());

    console.log("TATUSD Fungible Token Forge initialized successfully!");
    console.log("Asset Name: TATUSD");
    console.log("Owner:", forge.owner);
    console.log("Authorized forgers:", forge.getAuthorizedForgers());
    console.log("\nForge is running. Press Ctrl+C to exit.");

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
