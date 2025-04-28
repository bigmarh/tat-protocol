# NWPC Protocol Examples

This directory contains example implementations of the NWPC protocol, demonstrating a simple calculator service.

## Setup

1. First, install the dependencies:
```bash
npm install
```

2. Build the NWPC package:
```bash
cd ..
npm run build
```

## Running the Examples

### Server

1. Start the server:
```bash
npm run start:server
```

2. Note down the server's public key that is printed in the console.

### Client

1. Open a new terminal window
2. Edit the `client.ts` file and replace `REPLACE_WITH_SERVER_PUBLIC_KEY` with the server's public key you noted earlier
3. Start the client:
```bash
npm run start:client
```

## Example Output

The client will perform several calculations and print the results:
- Addition: 5 + 3 = 8
- Subtraction: 10 - 4 = 6
- Multiplication: 6 * 7 = 42
- Division: 20 / 5 = 4
- Division by zero error

## Notes

- The examples use the Damus relay (`wss://relay.damus.io`) for communication
- You can modify the relay URL in both `server.ts` and `client.ts` if needed
- The server implements a simple calculator service with four operations: add, subtract, multiply, and divide
- The client demonstrates how to make requests to the server and handle responses 