export enum TxCommand {
    TRANSFER = 'TRANSFER',
    FORGE = 'FORGE',
    BURN = 'BURN'
}

export interface TransactionInput {
    index: number;
    data: string;
}

export interface TransactionOutput {
    to: string;
    amount: number;
    assetIssuer?: string;
    P2PKlock?: string;
}

export interface Transaction {
    command: TxCommand;
    ins: TransactionInput[];
    outs: TransactionOutput[];
    memo?: string;
} 