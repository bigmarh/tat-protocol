import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1";

export interface Payload {
  iss?: string;
  iat?: number;
  exp?: number;
  amount?: number;
  tokenID?: string;
  [key: string]: unknown;
}

export interface Header {
  alg?: string;
  typ?: string;
  token_hash?: string;
  ver?: string;
}

export enum TokenType {
  FUNGIBLE = "FUNGIBLE",
  TAT = "TAT",
}

export interface TokenBuildParams {
  token_type: TokenType;
  payload: Payload;
}

export interface KeyPair {
  secretKey: string;
  publicKey: string;
}

// Base64 utilities
function base64Encode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

function base64Decode(str: string): Uint8Array {
  return Buffer.from(str, "base64url");
}

export class Token {
  public payload!: Payload;
  public header!: Header;
  public signature!: string;

  async build(opts: TokenBuildParams): Promise<Token> {
    this.header = {
      alg: "Schnorr",
      typ: opts.token_type,
      token_hash: "",
      ver: "1.0.0",
    };
    this.payload = opts.payload;
    await this.create_token_hash();
    return this;
  }

  async create_token_hash(): Promise<string> {
    const payloadStr = JSON.stringify(this.payload);
    const hash = sha256(new TextEncoder().encode(payloadStr));
    this.header.token_hash = bytesToHex(hash);
    return this.header.token_hash;
  }

  async computeTokenHashBase(): Promise<string> {
    const payloadStr = JSON.stringify(this.payload);
    const hash = sha256(new TextEncoder().encode(payloadStr));
    return bytesToHex(hash);
  }

  async verifyTokenHash(): Promise<boolean> {
    if (!this.header?.token_hash) return false;
    const expected = await this.computeTokenHashBase();
    return expected === this.header.token_hash;
  }

  async verifyTokenSignature(): Promise<boolean> {
    if (!this.signature || !this.header?.token_hash || !this.payload?.iss) {
      return false;
    }
    try {
      const dataToVerify = new TextEncoder().encode(this.header.token_hash);
      return schnorr.verify(
        hexToBytes(this.signature),
        dataToVerify,
        this.payload.iss as string
      );
    } catch {
      return false;
    }
  }

  async data_to_sign(): Promise<Uint8Array> {
    if (!this.header.token_hash) {
      await this.create_token_hash();
    }
    return new TextEncoder().encode(this.header.token_hash);
  }

  async sign(data: Uint8Array, keys: KeyPair): Promise<Uint8Array> {
    return schnorr.sign(data, keys.secretKey);
  }

  async toJWT(signature: string): Promise<string> {
    const headerStr = JSON.stringify(this.header);
    const payloadStr = JSON.stringify(this.payload);
    const headerB64 = base64Encode(new TextEncoder().encode(headerStr));
    const payloadB64 = base64Encode(new TextEncoder().encode(payloadStr));
    this.signature = signature;
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  async restore(tokenString: string): Promise<Token> {
    const parts = tokenString.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const [headerB64, payloadB64, signature] = parts;
    const headerBytes = base64Decode(headerB64);
    const payloadBytes = base64Decode(payloadB64);

    this.header = JSON.parse(new TextDecoder().decode(headerBytes));
    this.payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    this.signature = signature;

    return this;
  }

  async validate(): Promise<boolean> {
    if (!this.header || !this.payload) {
      throw new Error("Token must have header and payload");
    }
    if (!this.payload.iss) {
      throw new Error("Token must have an issuer");
    }
    if (!this.header.token_hash) {
      throw new Error("Token must have a token hash");
    }
    if (!(await this.verifyTokenHash())) {
      throw new Error("Token hash does not match payload");
    }
    if (!this.signature) {
      throw new Error("Token must have a signature");
    }
    if (!(await this.verifyTokenSignature())) {
      throw new Error("Invalid token signature");
    }
    return true;
  }
}

export default Token;
