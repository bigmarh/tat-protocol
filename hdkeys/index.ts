import { HDKey as HDKeyLib } from "@scure/bip32";
import { bytesToHex } from "@noble/hashes/utils";
import { generateMnemonic, mnemonicToSeed } from "bip39";

export class HDKey {
  private hdKey: HDKeyLib;

  constructor(seed: Uint8Array) {
    this.hdKey = HDKeyLib.fromMasterSeed(seed);
  }

  static generateMnemonic(): string {
    return generateMnemonic(256);
  }

  static async mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
    return await mnemonicToSeed(mnemonic);
  }
  static fromMasterSeed(seed: Uint8Array): HDKey {
    return new HDKey(seed);
  }

  derive(path: string): HDKey {
    const derived = this.hdKey.derive(path);
    if (!derived.privateKey) {
      throw new Error("Failed to derive private key");
    }
    return new HDKey(derived.privateKey);
  }

  get privateKey(): string {
    return bytesToHex(this.hdKey.privateKey!);
  }

  get publicKey(): string {
    return bytesToHex(this.hdKey.publicKey!);
  }

  get privateExtendedKey(): string {
    return this.hdKey.privateExtendedKey;
  }
}

export interface SingleUseKey {
  secretKey: string;
  publicKey: string;
  createdAt: number;
  used?: boolean;
}

export interface KeyPair {
  secretKey: string;
  publicKey: string;
}
