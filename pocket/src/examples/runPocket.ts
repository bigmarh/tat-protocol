import readline from "readline";
import { Pocket } from "@tat-protocol/pocket";
import { Token } from "@tat-protocol/token";


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  try {

    let pStart: any = {
      keys: { secretKey: '', publicKey: '' },
      relays: ['ws://localhost:8080']
    }

    // Pass in KeyID form process.argv
    if (process.argv.length > 2) {
      pStart.keyID = process.argv[2];
    }

    // Create and initialize the Pocket
    const pocket = await Pocket.create(pStart);
    // Check idKey format
    // @ts-ignore: Accessing private property
    const idKey = pocket["keys"];
    function isValidHexKey(key: any) {
      return typeof key === "string" && /^[0-9a-fA-F]{64}$/.test(key);
    }
    if (!isValidHexKey(idKey?.secretKey) || !isValidHexKey(idKey?.publicKey)) {
      console.error("Error: idKey.secretKey and idKey.publicKey must be 32-byte hex strings.");
      rl.close();
      process.exit(1);
    }
    console.log("Pocket initialized!");
    // @ts-ignore: Accessing private property
    console.log("Public Key:", idKey.publicKey);

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
          "Enter command number: \n",
          resolve
        );
      });

      switch (answer.trim()) {
        case "1":
          // @ts-ignore: Accessing private property
          const balances = pocket.getState().balances;
          if (balances.size === 0) {
            console.log("No balances found");
          } else {
            console.log("\nCurrent balances:");
            for (const [issuer, balance] of balances.entries()) {
              console.log(`Issuer: ${issuer}, Balance: ${balance.get('-')}`);
            }
          }
          break;

        case "2":
          // @ts-ignore: Accessing private property
          const tokens = pocket.getState().tokens;
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
          // Prompt for transfer type first
          const type = await new Promise<string>((resolve) => {
            rl.question(
              "Transfer type (fungible/tat): \n\n" +
              "1. fungible \n" +
              "2. tat \n" +
              "Enter type number: \n",
              resolve);
          });

          const transferType = type === "1" ? "fungible" : "tat";

          // Gather all unique issuers from tokens
          // @ts-ignore: Accessing private property
          const tokensMap = pocket.getState().tokens;
          const allIssuers = Array.from(tokensMap.keys());
          if (allIssuers.length === 0) {
            console.log("No issuers available for transfer.");
            break;
          }
          console.log("Available issuers:");
          allIssuers.forEach((issuer, idx) => {
            console.log(`${idx + 1}. ${issuer}`);
          });
          const issuerIdx = parseInt(await new Promise<string>((resolve) => {
            rl.question("Select issuer number: ", resolve);
          }));
          if (isNaN(issuerIdx) || issuerIdx < 1 || issuerIdx > allIssuers.length) {
            console.log("Invalid selection.");
            break;
          }
          const issuer: string = allIssuers[issuerIdx - 1];
          if (!issuer) {
            console.log("Invalid issuer selection.");
            break;
          }

          if (transferType === "fungible") {
            const recipient = await new Promise<string>((resolve) => {
              rl.question("Enter recipient public key: ", resolve);
            });
            if (!recipient) {
              console.log("Invalid recipient.");
              break;
            }
            const amount = parseInt(await new Promise<string>((resolve) => {
              rl.question("Enter amount to transfer: ", resolve);
            }));
            if (isNaN(amount) || amount <= 0) {
              console.log("Invalid amount.");
              break;
            }
            try {
              const response = await pocket.transfer(issuer, recipient, amount);
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
          }

          if (transferType === "tat") {
            // @ts-ignore: Accessing private property
            const tatIndex = pocket.getState().tatIndex;
            const availableTokenIDs = Array.from(tatIndex.get(issuer)?.keys() || []);
            if (availableTokenIDs.length === 0) {
              console.log("No TAT tokenIDs available for this issuer.");
              break;
            }
            console.log("Available tokenIDs:");
            availableTokenIDs.forEach((tid, idx) => {
              console.log(`${idx + 1}. ${tid}`);
            });
            const tokenIDIdx = parseInt(await new Promise<string>((resolve) => {
              rl.question("Select tokenID number: ", resolve);
            }));
            if (isNaN(tokenIDIdx) || tokenIDIdx < 1 || tokenIDIdx > availableTokenIDs.length) {
              console.log("Invalid selection.");
              break;
            }
            const tokenID: string = availableTokenIDs[tokenIDIdx - 1];
            const recipient = await new Promise<string>((resolve) => {
              rl.question("Enter recipient public key: ", resolve);
            });
            if (!recipient) {
              console.log("Invalid recipient.");
              break;
            }
            // @ts-ignore: Accessing private property
            const tokenHash = tatIndex.get(issuer)?.get(tokenID);
            if (!tokenHash) {
              console.log("Selected tokenID does not have a valid token hash in your wallet. It may have been spent or is missing.");
              break;
            }
            const tokenJWT = tokensMap.get(issuer)?.get(tokenHash);
            if (!tokenJWT || !tokenID) {
              console.log("Selected tokenID does not have a valid token in your wallet. It may have been spent or is missing.");
              break;
            }
            try {
              let response;
              if (typeof pocket.sendTAT === 'function') {
                response = await pocket.sendTAT(issuer, recipient, tokenID);
              } else if (typeof pocket["createTATTransferTx"] === 'function' && typeof pocket["sendTx"] === 'function') {
                // fallback if sendTAT is not available
                const tx = pocket["createTATTransferTx"](issuer, recipient, tokenID);
                response = await pocket["sendTx"]('transfer', issuer, tx);
              } else {
                throw new Error("sendTAT method not available on Pocket instance");
              }
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
          }

          console.log("Unknown transfer type.");
          break;

        case "4":
          // @ts-ignore: Accessing private property
          const singleUseKeys = pocket.getState().singleUseKeys;
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
          console.log(pocket.getState());
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