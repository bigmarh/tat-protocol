import readline from "readline";
import { Pocket } from "@tat-protocol/pocket";
import { Token } from "@tat-protocol/token";
import { NWPCPeer } from "@tat-protocol/nwpc";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  try {

    // Create and initialize the Pocket
    const pocket = await Pocket.create({keys: {secretKey: '', publicKey: ''}, keyID:"4dcbdcca9df14def031b5c56bef07b58e6ed94d29a2d4c08b7ec38860a9b5861", relays: ['ws://localhost:8080']});
    console.log("Pocket initialized!");
    // @ts-ignore: Accessing private property
    console.log("Public Key:", pocket["idKey"].publicKey);

    // Main command loop
    while (true) {
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "\nAvailable commands:\n" +
          "1. Show balance\n" +
          "2. List tokens\n" +
          "3. Transfer tokens\n" +
          "4. Show single-use keys\n" +
          "5. Generate new single-use key\n" +
          "6. Exit\n" +
          "7. View Current State\n" +
          "Enter command number: ",
          resolve
        );
      });

      switch (answer.trim()) {
        case "1":
          // @ts-ignore: Accessing private property
          const balances = pocket["Pocket"].balances;
          if (balances.size === 0) {
            console.log("No balances found");
          } else {
            console.log("\nCurrent balances:");
            for (const [issuer, balance] of balances.entries()) {
              console.log(`Issuer: ${issuer}, Balance: ${balance}`);
            }
          }
          break;

        case "2":
          // @ts-ignore: Accessing private property
          const tokens = pocket["Pocket"].tokens;
          if (tokens.size === 0) {
            console.log("No tokens found");
          } else {
            console.log("\nCurrent tokens:");
            for (const [issuer, issuerTokens] of tokens.entries()) {
              console.log(`\nIssuer: ${issuer}`);
              console.log(`Total: ${issuerTokens.size}`);
              console.log("================================================ \n");
              for (const [tokenHash, tokenJWT] of issuerTokens.entries()) {
                const token = new Token();
                await token.fromJWT(tokenJWT);
                const payload = token.getPayload();
                console.log(`  Token Hash: ${tokenHash}`);
                payload.tokenID !== undefined ? console.log(`  TokenID: ${payload.tokenID}`) : console.log(`  Amount: ${payload.amount}`);
                console.log(`  Lock: ${payload.P2PKlock}`);
                console.log("  ---");
              }
            }
          }
          break;

        case "3":
          const tokenJWT = await new Promise<string>((resolve) => {
            rl.question("Enter token JWT to transfer: ", resolve);
          });
          const recipient = await new Promise<string>((resolve) => {
            rl.question("Enter recipient public key: ", resolve);
          });
          
          try {
            // @ts-ignore: Accessing private property
            const nwpcClient = pocket["nwpcClient"] as NWPCPeer;
            
            // Parse the token to get the issuer
            const token = new Token();
            await token.fromJWT(tokenJWT);
            const issuer = token.getIssuer();

            // Send transfer request to the forge
            const response = await nwpcClient.request(
              "transfer",
              {
                tokenJWT,
                to: recipient,
              },
              issuer, // Send to the forge's public key
              30000 // 30 second timeout
            );

            if (response.result) {
              console.log("Transfer successful!");
              console.log("New token received:", response.result.token);
            } else {
              console.error("Transfer failed:", response.error);
            }
          } catch (err) {
            console.error("Transfer failed:", err);
          }
          break;

        case "4":
          // @ts-ignore: Accessing private property
          const singleUseKeys = pocket["Pocket"].singleUseKeys;
          if (singleUseKeys.size === 0) {
            console.log("No single-use keys found");
          } else {
            console.log("\nSingle-use keys:");
            for (const [pubkey, key] of singleUseKeys.entries()) {
              console.log(`Public Key: ${pubkey}`);
              console.log(`Created: ${new Date(key.createdAt).toLocaleString()}`);
              console.log(`Used: ${key.used ? "Yes" : "No"}`);
              console.log("---");
            }
          }
          break;

        case "5":
          try {
            // @ts-ignore: Accessing private method
            const newKey = await pocket["deriveSingleUseKey"]();
            console.log("\nNew single-use key generated:");
            console.log("Public Key:", newKey.publicKey);
            console.log("Created:", new Date(newKey.createdAt).toLocaleString());
          } catch (err) {
            console.error("Failed to generate key:", err);
          }
          break;

        case "6":
          console.log("Exiting...");
          rl.close();
          process.exit(0);
          break;
        case "7":
          // View Current State
          console.log("Current State:");
          console.log(pocket["Pocket"]);
          break;

        default:
          console.log("Invalid command. Please try again.");
      }
    }
  } catch (err) {
    console.error("Failed to initialize Pocket:", err);
    rl.close();
  }
}

// Only run main if this file is being run directly
if (require.main === module) {
    main();
}