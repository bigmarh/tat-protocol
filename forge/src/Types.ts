export type Recipient = {
  to: string;
  amount?: number;
  tokenID?: string;
  issuer?: string;
  timeLock?: number;
  htlc?: string;
  isLocked?: boolean;
};
