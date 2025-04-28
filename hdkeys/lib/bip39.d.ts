declare module 'bip39' {
    export function generateMnemonic(strength?: number): string;
    export function mnemonicToSeed(mnemonic: string, password?: string): Buffer;
    export function mnemonicToSeedSync(mnemonic: string, password?: string): Buffer;
    export function mnemonicToEntropy(mnemonic: string): string;
    export function entropyToMnemonic(entropy: string): string;
    export function validateMnemonic(mnemonic: string): boolean;
    export const wordlists: { [key: string]: string[] };
} 