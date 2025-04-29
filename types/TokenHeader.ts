import { TokenType } from "./TokenType";

/**
 * JWT Header for TAT tokens
 */
export interface TokenHeader {
  /**
   * Token type (FUNGIBLE, NON_FUNGIBLE, etc.)
   */
  typ: TokenType;

  /**
   * Token hash for verification
   */
  token_hash: string;

  /**
   * Token expiration timestamp (optional)
   */
  exp?: number;
}
