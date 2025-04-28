/**
 * Types of tokens in the TAT Protocol
 */
export enum TokenType {
    /**
     * Fungible tokens - interchangeable and identical
     * Example: Credit tokens
     */
    FUNGIBLE = "FUNGIBLE",

    /**
     * Non-fungible tokens - unique and non-interchangeable
     * Example: Digital art, collectibles
     */
    NON_FUNGIBLE = "NON_FUNGIBLE",

    /**
     * Semi-fungible tokens - partially interchangeable
     * Example: Trading cards with different rarities
     */
    SEMI_FUNGIBLE = "SEMI_FUNGIBLE"
} 