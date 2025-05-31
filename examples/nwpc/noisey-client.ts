import { NWPCPeer } from "@tat-protocol/nwpc";
import readline from "readline";
import { getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey } from "nostr-tools";
import { defaultConfig } from "./defaultConfig";
import { NodeStore } from "@tat-protocol/storage/dist/DiskStorage";

//send forge 1000 04133dbe9039a986f9342ff2c2d287f1b184a6c385b3c72d9b1829b1d6b9bdfc
interface KeyPair {
  name: string;
  secretKey: string;
  publicKey: string;
}

class NoiseyClient {
  private peer!: NWPCPeer;
  private rl: readline.Interface;
  private servers: Map<string, string> = new Map();
  private currentServer: string | null = null;
  private keys: Map<string, KeyPair> = new Map();
  private currentKey: string | null = null;

  constructor() {
    this.servers.set(
      "default",
      "1dd47426e7518119dcca1688cc3c3ae976f8c5690b4e2160e66dab47833f0876",
    );
    this.servers.set(
      "forge",
      "5bae0f9ff8aae5670b84e74f64893aa3a51384da1e922634427373415c4b8f90",
    );

    this.servers.set(
      "fungi",
      "249bdbc2d3c94fec4732bbe9df76300ca7ef1d1fe84546752e6ea7770f32bf00",
    );

    this.currentServer = "fungi";

    const setName = "admin";
    const secretKey =
      "7a3b427a07be6719f337c4683bc4b48ca4603e00e1057688e7b73c0c7ad69c78";
    const keyPair = {
      name: setName,
      secretKey,
      publicKey: getPublicKey(hexToBytes(secretKey)),
    };
    this.keys.set(setName, keyPair);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private generateKeys(name: string): KeyPair {
    const secretKey = bytesToHex(generateSecretKey());
    const publicKey = getPublicKey(hexToBytes(secretKey));
    return { name, secretKey, publicKey };
  }

  private validatePubkey(pubkey: string): string {
    const cleanPubkey = pubkey.replace(/\s+/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cleanPubkey)) {
      throw new Error("Invalid public key format. Must be 64 hex characters.");
    }
    return cleanPubkey;
  }

  private async initialize() {
    if (!this.currentKey) {
      throw new Error("No key pair selected");
    }
    const keyPair = this.keys.get(this.currentKey);
    if (!keyPair) {
      throw new Error("Selected key pair not found");
    }

    this.peer = new NWPCPeer({
      keys: {
        secretKey: keyPair.secretKey,
        publicKey: keyPair.publicKey,
      },
      type: "client",
      relays: defaultConfig.relays,
      storage: new NodeStore(),
    });
    await this.peer.init();

    console.log("\n🔑 Current Key Pair:");
    console.log("Name:", keyPair.name);
    console.log("Secret Key:", keyPair.secretKey);
    console.log("Public Key:", keyPair.publicKey);
  }

  private printWelcome() {
    console.log("\n🔊 Noisey Client");
    console.log("Available servers:\n");
    this.servers.forEach((pubkey, name) => {
      console.log(`${name}: ${pubkey}`);
    });
    console.log("\n--------------------------------");
    console.log("Available commands:");
    console.log("  add <name> <pubkey>               - Add a new server");
    console.log("  use <server>                      - Switch to a server");
    console.log("  list                              - List available servers");
    console.log("  newkey <name>                     - Generate new key pair");
    console.log("  setkey <name>                     - Set your own key pair");
    console.log("  usekey <name>                     - Switch to a key pair");
    console.log(
      "  listkeys                          - List available key pairs",
    );
    console.log(
      "  send <method> <JSON params>       - Send a message to current server",
    );
    console.log("  exit                              - Quit the client\n");
  }

  private async handleCommand(input: string) {
    const [command, ...args] = input.trim().split(" ");

    switch (command.toLowerCase()) {
      case "add": {
        if (args.length >= 2) {
          const [name, ...pubkeyParts] = args;
          const pubkey = pubkeyParts.join(" ");
          try {
            const validPubkey = this.validatePubkey(pubkey);
            this.servers.set(name, validPubkey);
            console.log(`Added server ${name} with pubkey ${validPubkey}`);
          } catch (error: any) {
            console.error("Error adding server:", error.message);
          }
        } else {
          console.log("Please specify server name and pubkey");
        }
        break;
      }
      case "use": {
        if (args.length > 0) {
          const serverName = args[0];
          if (!this.servers.has(serverName)) {
            console.log(`Server ${serverName} not found`);
            return;
          }
          this.currentServer = serverName;
          console.log(`Current server set to ${serverName}`);
        } else {
          console.log("Please specify a server name");
        }
        break;
      }
      case "list": {
        console.log("\nAvailable servers:");
        this.servers.forEach((pubkey, name) => {
          console.log(`${name}: ${pubkey}`);
        });
        if (this.currentServer) {
          console.log(`\nCurrent server: ${this.currentServer}`);
        }
        break;
      }
      case "newkey": {
        if (args.length === 0) {
          console.log("Please specify a name for the new key pair");
          return;
        }
        const newKeyName = args[0];
        if (this.keys.has(newKeyName)) {
          console.log(`Key pair with name '${newKeyName}' already exists`);
          return;
        }
        const newKeyPair = this.generateKeys(newKeyName);
        this.keys.set(newKeyName, newKeyPair);
        this.currentKey = newKeyName;
        await this.initialize();
        console.log(`New key pair '${newKeyName}' generated and selected`);
        break;
      }
      case "setkey": {
        if (args.length === 0) {
          console.log("Please specify a name for the key pair");
          return;
        }
        const setName = args[0];
        try {
          const secretKey = await new Promise<string>((resolve) => {
            this.rl.question("Enter your secret key: ", resolve);
          });

          if (!/^[0-9a-f]{64}$/.test(secretKey)) {
            console.log(
              "Invalid secret key format. Must be 64 hex characters.",
            );
            return;
          }

          const keyPair = {
            name: setName,
            secretKey,
            publicKey: getPublicKey(hexToBytes(secretKey)),
          };
          this.keys.set(setName, keyPair);
          this.currentKey = setName;
          await this.initialize();
          console.log(`Key pair '${setName}' set and selected`);
        } catch (error) {
          console.error("Error setting key pair:", error);
        }
        break;
      }
      case "usekey": {
        if (args.length === 0) {
          console.log("Please specify a key pair name");
          return;
        }
        const useName = args[0];
        if (!this.keys.has(useName)) {
          console.log(`Key pair '${useName}' not found`);
          return;
        }
        this.currentKey = useName;
        await this.initialize();
        console.log(`Switched to key pair '${useName}'`);
        break;
      }
      case "listkeys": {
        console.log("\nAvailable key pairs:");
        this.keys.forEach((keyPair, name) => {
          console.log(`\n${name}:`);
          console.log("  Public Key:", keyPair.publicKey);
          if (name === this.currentKey) {
            console.log("  (Currently selected)");
          }
        });
        break;
      }
      case "send": {
        if (!this.currentServer) {
          console.log("No server selected. Use 'use <server>' first.");
          return;
        }
        if (!this.currentKey) {
          console.log("No key pair selected. Use 'usekey <name>' first.");
          return;
        }
        if (args.length === 0) {
          console.log("Please provide a message to send");
          return;
        }
        try {
          const action = args.shift();
          const serverPubkey = this.servers.get(this.currentServer);
          if (!serverPubkey) {
            console.log("Server pubkey not found");
            return;
          }

          // Join remaining args back into a single string for JSON parsing
          const jsonString = args.join(" ");

          let parsedParam;
          try {
            parsedParam = JSON.parse(jsonString);
          } catch (e) {
            console.log(
              "Invalid JSON format. Please provide valid JSON after the action.",
            );
            return;
          }

          const result = await this.peer.request(
            String(action),
            parsedParam,
            serverPubkey,
          );
          console.log("Server response:", result);
        } catch (error) {
          console.error("Error sending message:", error);
        }
        break;
      }
      case "help": {
        this.printWelcome();
        break;
      }
      case "exit":
        console.log("Goodbye! 👋");
        this.rl.close();
        process.exit(0);
        break;
      default:
        console.log("Unknown command. Type 'help' for available commands.");
    }
  }

  async start() {
    // Generate initial key pair
    const initialKeyPair = this.generateKeys("default");
    this.keys.set("default", initialKeyPair);
    this.currentKey = "admin";

    await this.initialize();
    this.printWelcome();

    this.rl.on("line", async (input) => {
      await this.handleCommand(input);
      console.log("\nEnter a command:");
    });
  }
}

// Start the client
new NoiseyClient().start().catch(console.error);
