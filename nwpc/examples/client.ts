import NDK, { NDKRelay } from "@nostr-dev-kit/ndk";
import { NWPCPeer } from "../lib";
import readline from 'readline';
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";


/*  Private Key: f4c438fe22a763b9f9d70eaa4f91ef6e5806e3ac6f1afa79da6ce258649f4f2c
  Public Key: 035bae0f9ff8aae5670b84e74f64893aa3a51384da1e922634427373415c4b8f90 */
// Client configuration
const secretKey = "f4c438fe22a763b9f9d70eaa4f91ef6e5806e3ac6f1afa79da6ce258649f4f2c";
const CLIENT_KEYS = {
    secretKey: secretKey,
    publicKey: getPublicKey(hexToBytes(secretKey))
};

const DEFAULT_SERVER_KEY = "1dd47426e7518119dcca1688cc3c3ae976f8c5690b4e2160e66dab47833f0876";

const AVAILABLE_COMMANDS = ['add', 'subtract', 'multiply', 'divide'] as const;
type Command = typeof AVAILABLE_COMMANDS[number];

const netDebug = (msg: string, relay: NDKRelay, direction?: "send" | "recv") => {
    const hostname = new URL(relay.url).hostname;
    netDebug(hostname + ":" + msg, relay, direction);
}

class CalculatorClient {
    private peer: NWPCPeer;
    private rl: readline.Interface;
    private serverKey: string;

    constructor(serverKey?: string) {


        this.peer = new NWPCPeer({
            keys: CLIENT_KEYS,
            type: 'client',
            relays: ['ws://localhost:8080'],
            netDebug: netDebug
        });

        this.serverKey = serverKey || DEFAULT_SERVER_KEY;
        /*    const result = this.peer.request("ping", [], this.serverKey);
           console.log(result); */

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    private printWelcome() {
        console.log('\n🔢 NWPC Calculator Client\n');
        console.log('------------------------');
        console.log('Client Public Key:', CLIENT_KEYS.publicKey);
        console.log('Server Public Key:', this.serverKey);
        console.log('Relay URLs:', ['ws://localhost:8080']);
        console.log('------------------------\n');

        console.log('Available commands:');
        console.log('  add <num1> <num2>      Add two numbers');
        console.log('  subtract <num1> <num2>  Subtract second number from first');
        console.log('  multiply <num1> <num2>  Multiply two numbers');
        console.log('  divide <num1> <num2>    Divide first number by second');
        console.log('  exit                    Quit the calculator\n');
    }

    private async executeCommand(command: Command, args: number[]) {
        try {
            console.log(`\nCalculating: ${args[0]} ${command} ${args[1]}`);
            const result = await this.peer.request(command, args, this.serverKey);
            console.log(`Result: ${result.result}\n`);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
        }
    }

    private parseInput(input: string): [Command, number[]] | null {
        const [command, ...args] = input.trim().split(' ');

        // Check if command is valid
        if (!AVAILABLE_COMMANDS.includes(command as Command)) {
            console.log('Invalid command. Available commands:', AVAILABLE_COMMANDS.join(', '));
            return null;
        }

        // Check number of arguments
        if (args.length !== 2) {
            console.log('Please provide exactly two numbers as arguments');
            return null;
        }

        // Parse and validate numbers
        const numbers = args.map(arg => {
            const num = parseFloat(arg);
            if (isNaN(num)) {
                throw new Error(`Invalid number: ${arg}`);
            }
            return num;
        });

        return [command as Command, numbers];
    }

    async start() {



        try {
            this.printWelcome();
            console.log('Enter a command:');

            this.rl.on('line', async (input) => {
                if (input.trim() === 'exit') {
                    console.log('Goodbye! 👋');
                    this.rl.close();
                    process.exit(0);
                }

                try {
                    const parsed = this.parseInput(input);
                    if (parsed) {
                        const [command, args] = parsed;
                        await this.executeCommand(command, args);
                    }
                } catch (error) {
                    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
                }

                console.log('Enter another command:');
            });

        } catch (error) {
            console.error('Failed to start client:', error);
            process.exit(1);
        }
    }
}

// Get server key from command line or use default
const serverKey = process.argv[2];

// Start the client
new CalculatorClient(serverKey).start().catch(console.error);