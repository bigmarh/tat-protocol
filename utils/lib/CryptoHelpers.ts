import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';
import { KeyPair } from '@tat-protocol/types';

export function verifySignature(message: Uint8Array, signature: Uint8Array, pubkey: string): boolean {
  try {
    return schnorr.verify(
      signature, 
      message,
      hexToBytes(pubkey)
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

export function signMessage (message: Uint8Array, keys: KeyPair): Uint8Array {
    return schnorr.sign(message, hexToBytes(keys.secretKey));
}

export async function createHash(data: string) {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    return sha256(buffer);
}
export function addBase64Padding(str: string) {
    return str.padEnd(str.length + (4 - (str.length % 4)) % 4, '=');
}
export function removeBase64Padding(encoded: string) {
    return encoded.replace(/=*$/, '');
}
