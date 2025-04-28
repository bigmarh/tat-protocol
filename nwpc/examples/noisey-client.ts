import { NWPCPeer } from "../lib";
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";
import readline from 'readline';

// Example keys - DO NOT USE IN PRODUCTION
const secretKey = "57ab9f5fba3283bddcb5dfc652cf13ea010a1788be9fd7e5a764e207b59a5877";
const CLIENT_KEYS = {
    secretKey: secretKey,
    publicKey: getPublicKey(hexToBytes(secretKey))
};

class NoisyClient {
    private client: NWPCPeer;
    private servers: Map<string, string> = new Map();
    private currentServer: string | null = null;

    constructor() {
        this.client = new NWPCPeer({
            keys: CLIENT_KEYS,
            type: 'client',
            relays: ['ws://localhost:8080']
        });
    }

    private validatePubkey(pubkey: string): string {
        // Remove any spaces and ensure it's lowercase
        const cleanPubkey = pubkey.replace(/\s+/g, '').toLowerCase();
        
        // Check if it's a valid hex string of correct length
        if (!/^[0-9a-f]{64}$/.test(cleanPubkey)) {
            throw new Error('Invalid public key format. Must be 64 hex characters.');
        }
        
        return cleanPubkey;
    }

    public addServer(name: string, pubkey: string) {
        try {
            const validPubkey = this.validatePubkey(pubkey);
            this.servers.set(name, validPubkey);
            console.log(`Added server ${name} with pubkey ${validPubkey}`);
        } catch (error: any) {
            console.error('Error adding server:', error.message);
        }
    }

    public setCurrentServer(name: string) {
        if (!this.servers.has(name)) {
            console.log(`Server ${name} not found`);
            return;
        }
        this.currentServer = name;
        console.log(`Current server set to ${name}`);
    }

    public async sendCommand(method: string, params: any[]) {
        if (!this.currentServer) {
            console.log('No server selected. Use setCurrentServer first.');
            return;
        }

        const serverPubkey = this.servers.get(this.currentServer);
        if (!serverPubkey) {
            console.log('Server pubkey not found');
            return;
        }

        try {
            console.log(`Sending ${method} to ${this.currentServer}...`);
            const response = await this.client.request(method, params, serverPubkey);
            console.log('Response:', response);
        } catch (error) {
            console.error('Error sending command:', error);
        }
    }

    public listServers() {
        console.log('\nAvailable servers:');
        this.servers.forEach((pubkey, name) => {
            console.log(`${name}: ${pubkey}`);
        });
        if (this.currentServer) {
            console.log(`\nCurrent server: ${this.currentServer}`);
        }
    }
}

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Helper function to parse command line input
function parseInput(input: string): { command: string, args: string[] } {
    const parts = input.trim().split(' ');
    return {
        command: parts[0],
        args: parts.slice(1)
    };
}

// Main function
async function main() {
    const client = new NoisyClient();

    // Add some example servers
    client.addServer('admin', 'afc7050384c6eddd3642eb3cbba8e74f1c83554dc03e927e6130561ea89b61a9');
    client.addServer('user', 'afc7050384c6eddd3642eb3cbba8e74f1c83554dc03e927e6130561ea89b61a9');
    client.addServer('public', 'afc7050384c6eddd3642eb3cbba8e74f1c83554dc03e927e6130561ea89b61a9');
    client.addServer('calc', '1dd47426e7518119dcca1688cc3c3ae976f8c5690b4e2160e66dab47833f0876');

    console.log('\n🔊 Noisy Client');
    console.log('------------------------');
    console.log('Available commands:');
    console.log('- list: List available servers');
    console.log('- add <name> <pubkey>: Add a new server');
    console.log('- use <server>: Switch to a server');
    console.log('- send <method> [params...]: Send a command to current server');
    console.log('- exit: Quit the client');
    console.log('------------------------\n');

    const prompt = () => {
        rl.question('> ', async (input) => {
            const { command, args } = parseInput(input);

            switch (command) {
                case 'list':
                    client.listServers();
                    break;
                case 'add':
                    if (args.length >= 2) {
                        const [name, ...pubkeyParts] = args;
                        const pubkey = pubkeyParts.join(' ');
                        client.addServer(name, pubkey);
                    } else {
                        console.log('Please specify server name and pubkey');
                    }
                    break;
                case 'use':
                    if (args.length > 0) {
                        client.setCurrentServer(args[0]);
                    } else {
                        console.log('Please specify a server name');
                    }
                    break;
                case 'send':
                    if (args.length > 0) {
                        const method = args[0];
                        const params = args.slice(1).map(param => {
                            // Try to parse numbers
                            const num = Number(param);
                            return isNaN(num) ? param : num;
                        });
                        await client.sendCommand(method, params);
                    } else {
                        console.log('Please specify a method');
                    }
                    break;
                case 'exit':
                    rl.close();
                    process.exit(0);
                    break;
                default:
                    console.log('Unknown command. Type "help" for available commands.');
            }

            prompt();
        });
    };

    prompt();
}

main().catch(console.error);






