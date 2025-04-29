import { KeyPair } from "./KeyPair";
import { TokenType } from "./TokenType";
import { TokenHeader } from "./TokenHeader";
import { TokenPayload } from "./TokenPayload";

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type { KeyPair };
export { TokenType };
export type { TokenHeader, TokenPayload };
