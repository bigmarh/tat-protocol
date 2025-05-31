import { StorageInterface } from '@tat-protocol/storage';
import { KeyPair } from '@tat-protocol/hdkeys';
import { DebugLogger } from '@tat-protocol/utils';

const Debug = DebugLogger.getInstance();

export interface BoxofficeConfig {
    storage?: StorageInterface;
    keys?: KeyPair;
}

export class Boxoffice {
    private config: BoxofficeConfig;
    private isInitialized: boolean;

    constructor(config?: BoxofficeConfig) {
        this.config = config || {};
        this.isInitialized = false;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Initialize storage if provided
            if (this.config.storage) {
                Debug.log('Storage initialized', 'Boxoffice');
            }

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`Failed to initialize Boxoffice: ${error}`);
        }
    }
} 