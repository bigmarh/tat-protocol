import { bytesToHex } from "@noble/hashes/utils";
import { HDKey } from "@tat-protocol/hdkeys";
console.log("Hello World");
async function main() {
  console.log("TAT Protocol HD Keys Example\n");

  // Generate a new mnemonic
  const mnemonic = HDKey.generateMnemonic();
  console.log("Generated mnemonic:");
  console.log(mnemonic);
  console.log();

  // Convert mnemonic to seed
  const seed = await HDKey.mnemonicToSeed(mnemonic);
  console.log("Seed (hex):", bytesToHex(seed));
  console.log();

  // Create master HD key from seed
  const masterKey = HDKey.fromMasterSeed(seed);
  console.log("Master Key:");
  console.log("Private Key:", masterKey.privateKey);
  console.log("Public Key:", masterKey.publicKey);
  console.log();

  // Derive 5 child keys using different derivation paths
  console.log("Derived Keys:");

  // Account 0, first 5 receiving addresses (BIP44-like)
  for (let i = 0; i < 5; i++) {
    const path = `m/44'/1237'/${i}'/0/0`;
    const childKey = masterKey.derive(path);

    console.log(`Key ${i + 1} (${path}):`);
    console.log("  Private Key:", childKey.privateKey);
    console.log("  Public Key:", childKey.publicKey);
    console.log();
  }
}

main().catch((error) => {
  console.error("Error:", error);
});
