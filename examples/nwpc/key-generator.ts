import { getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey } from "nostr-tools";
import readline from "readline";

// Create interface for readline
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Generate 10 key pairs
const keyPairs = Array.from({ length: 10 }, () => {
  const secretKey = bytesToHex(generateSecretKey());
  const publicKey = getPublicKey(hexToBytes(secretKey));
  return { secretKey, publicKey };
});

// Display key pairs
console.log("\nGenerated Key Pairs:");
keyPairs.forEach((pair, index) => {
  console.log(`\n[${index + 1}]`);
  console.log("Secret Key:", pair.secretKey);
  console.log("Public Key:", pair.publicKey);
});

// Ask user to choose a key pair
rl.question("\nChoose a key pair (1-10): ", (answer) => {
  const choice = parseInt(answer);
  if (choice >= 1 && choice <= 10) {
    const selectedPair = keyPairs[choice - 1];
    console.log("\nSelected Key Pair:");
    console.log("Secret Key:", selectedPair.secretKey);
    console.log("Public Key:", selectedPair.publicKey);

    // Create client configuration
    const clientConfig = `const CLIENT_KEYS = {
    secretKey: "${selectedPair.secretKey}",
    publicKey: "${selectedPair.publicKey}"
};`;

    console.log("\nCopy this configuration to your noisey-client.ts:");
    console.log(clientConfig);
  } else {
    console.log("Invalid choice. Please select a number between 1 and 10.");
  }
  rl.close();
});
