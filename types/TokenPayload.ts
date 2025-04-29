/**
 * Payload for TAT tokens
 */
export interface TokenPayload {
  /**
   * Amount of tokens (for fungible tokens)
   */
  amount?: number;

  /**
   * Asset ID (for non-fungible tokens)
   */
  assetId?: string;

  /**
   * Token issuer's public key
   */
  iss: string;

  /**
   * P2PK lock (public key that can spend the token)
   */
  P2PKlock?: string;

  /**
   * Time lock (timestamp when token becomes spendable)
   */
  timeLock?: number;

  /**
   * Data URI for token metadata
   */
  data_uri?: string;
}
