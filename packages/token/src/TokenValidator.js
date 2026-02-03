import { createHash } from "@tat-protocol/utils";
import { bytesToHex } from "@noble/hashes/utils";
/**
 * Enhanced HTLC handler with proper security validation
 */
export class HTLCHandler {
    /**
     * Validates HTLC structure and timing constraints
     */
    static validateHTLC(htlc, currentTime = Date.now()) {
        // Input validation
        if (!htlc) {
            return {
                isValid: false,
                error: "HTLC is null or undefined",
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        if (!htlc.hashlock || typeof htlc.hashlock !== "string") {
            return {
                isValid: false,
                error: "Invalid or missing hashlock",
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        if (!htlc.timelock ||
            typeof htlc.timelock !== "number" ||
            htlc.timelock <= 0) {
            return {
                isValid: false,
                error: "Invalid or missing timelock",
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        // Validate hash format (should be hex string)
        if (!/^[a-fA-F0-9]+$/.test(htlc.hashlock)) {
            return {
                isValid: false,
                error: "Hashlock must be a valid hexadecimal string",
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        // Check hash length based on algorithm
        const hashFunction = htlc.hashFunction || "sha256";
        const expectedLength = this.getExpectedHashLength(hashFunction);
        if (htlc.hashlock.length !== expectedLength) {
            return {
                isValid: false,
                error: `Invalid hash length for ${hashFunction}: expected ${expectedLength}, got ${htlc.hashlock.length}`,
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        // Validate timelock is reasonable (not too far in past or future)
        const minValidTime = currentTime - 30 * 24 * 60 * 60 * 1000; // 30 days ago
        const maxValidTime = currentTime + 365 * 24 * 60 * 60 * 1000; // 1 year from now
        if (htlc.timelock < minValidTime) {
            return {
                isValid: false,
                error: "Timelock is too far in the past",
                canRedeem: false,
                canRefund: false,
                isExpired: true,
            };
        }
        if (htlc.timelock > maxValidTime) {
            return {
                isValid: false,
                error: "Timelock is too far in the future",
                canRedeem: false,
                canRefund: false,
                isExpired: false,
            };
        }
        const isExpired = htlc.timelock <= currentTime;
        return {
            isValid: true,
            canRedeem: !isExpired, // Can only redeem with secret before expiry
            canRefund: isExpired, // Can only refund after expiry
            isExpired,
        };
    }
    /**
     * Attempts to redeem HTLC with provided secret
     */
    static async redeemHTLC(htlc, secret, currentTime = Date.now()) {
        // First validate the HTLC
        const validation = this.validateHTLC(htlc, currentTime);
        if (!validation.isValid) {
            return {
                success: false,
                error: validation.error,
            };
        }
        // Check if redemption is allowed (before timelock expiry)
        if (!validation.canRedeem) {
            return {
                success: false,
                error: validation.isExpired
                    ? "Cannot redeem: HTLC has expired, only refund is possible"
                    : "Cannot redeem: HTLC validation failed",
            };
        }
        // Validate secret input
        if (!secret || typeof secret !== "string") {
            return {
                success: false,
                error: "Invalid secret provided",
            };
        }
        // Prevent timing attacks by always computing hash
        try {
            const hashFunction = htlc.hashFunction || "sha256";
            const secretHash = await this.computeHash(secret, hashFunction);
            // Use constant-time comparison to prevent timing attacks
            const isValidSecret = this.constantTimeEqual(secretHash, htlc.hashlock.toLowerCase());
            if (isValidSecret) {
                return {
                    success: true,
                    secretRevealed: secret,
                };
            }
            else {
                return {
                    success: false,
                    error: "Invalid secret: hash does not match hashlock",
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to verify secret: ${error}`,
            };
        }
    }
    /**
     * Checks if HTLC can be refunded (after timelock expiry)
     */
    static canRefund(htlc, currentTime = Date.now()) {
        const validation = this.validateHTLC(htlc, currentTime);
        if (!validation.isValid) {
            return { canRefund: false, error: validation.error };
        }
        return {
            canRefund: validation.canRefund,
            error: validation.canRefund
                ? undefined
                : "Cannot refund: HTLC has not yet expired",
        };
    }
    /**
     * Creates a new HTLC with proper validation
     */
    static async createHTLC(secret, timelockDuration, hashFunction = "sha256") {
        if (!secret || typeof secret !== "string" || secret.length < 16) {
            return { error: "Secret must be at least 16 characters long" };
        }
        if (!timelockDuration || timelockDuration <= 0) {
            return { error: "Timelock duration must be positive" };
        }
        // Validate hash function
        if (!["sha256"].includes(hashFunction)) {
            return { error: `Unsupported hash function: ${hashFunction}` };
        }
        try {
            const hashlock = await this.computeHash(secret, hashFunction);
            const timelock = Date.now() + timelockDuration;
            const htlc = {
                hashlock,
                timelock,
                hashFunction,
            };
            return { htlc, secret };
        }
        catch (error) {
            return { error: `Failed to create HTLC: ${error}` };
        }
    }
    /**
     * Computes hash using specified algorithm
     */
    static async computeHash(data, algorithm = "sha256") {
        switch (algorithm.toLowerCase()) {
            case "sha256":
                const hash = await createHash(data);
                return bytesToHex(hash);
            default:
                throw new Error(`Unsupported hash algorithm: ${algorithm}`);
        }
    }
    /**
     * Constant-time string comparison to prevent timing attacks
     */
    static constantTimeEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }
    /**
     * Gets expected hash length for given algorithm
     */
    static getExpectedHashLength(algorithm) {
        switch (algorithm.toLowerCase()) {
            case "sha256":
                return 64; // 32 bytes * 2 hex chars per byte
            default:
                throw new Error(`Unknown hash algorithm: ${algorithm}`);
        }
    }
}
/**
 * Example usage in token validation
 */
export class TokenValidator {
    /**
     * Validates a token with HTLC constraints
     */
    static async validateTokenHTLC(token, secret, currentTime = Date.now()) {
        if (!token.payload.HTLC) {
            return { valid: true }; // No HTLC, validation passes
        }
        const validation = HTLCHandler.validateHTLC(token.payload.HTLC, currentTime);
        if (!validation.isValid) {
            return {
                valid: false,
                error: validation.error,
                canRedeem: false,
                canRefund: false,
            };
        }
        // If secret is provided, attempt redemption
        if (secret) {
            const redemption = await HTLCHandler.redeemHTLC(token.payload.HTLC, secret, currentTime);
            return {
                valid: redemption.success,
                error: redemption.error,
                canRedeem: validation.canRedeem,
                canRefund: validation.canRefund,
            };
        }
        // No secret provided, just return validation state
        return {
            valid: true, // Structure is valid, but may not be redeemable
            canRedeem: validation.canRedeem,
            canRefund: validation.canRefund,
        };
    }
}
// Example usage:
/*
// Creating an HTLC
const result = await HTLCHandler.createHTLC("my-secret-preimage", 3600000); // 1 hour
if ('htlc' in result) {
  console.log('HTLC created:', result.htlc);
}

// Validating HTLC
const validation = HTLCHandler.validateHTLC(htlc);
console.log('Can redeem:', validation.canRedeem);
console.log('Can refund:', validation.canRefund);

// Attempting redemption
const redemption = await HTLCHandler.redeemHTLC(htlc, "my-secret-preimage");
if (redemption.success) {
  console.log('Redemption successful!');
}
*/
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVG9rZW5WYWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJUb2tlblZhbGlkYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0scUJBQXFCLENBQUM7QUFDakQsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBK0JqRDs7R0FFRztBQUNILE1BQU0sT0FBTyxXQUFXO0lBQ3RCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFlBQVksQ0FDakIsSUFBVSxFQUNWLGNBQXNCLElBQUksQ0FBQyxHQUFHLEVBQUU7UUFFaEMsbUJBQW1CO1FBQ25CLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNWLE9BQU87Z0JBQ0wsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLDJCQUEyQjtnQkFDbEMsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixTQUFTLEVBQUUsS0FBSzthQUNqQixDQUFDO1FBQ0osQ0FBQztRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLE9BQU8sSUFBSSxDQUFDLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN4RCxPQUFPO2dCQUNMLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSw2QkFBNkI7Z0JBQ3BDLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixTQUFTLEVBQUUsS0FBSztnQkFDaEIsU0FBUyxFQUFFLEtBQUs7YUFDakIsQ0FBQztRQUNKLENBQUM7UUFFRCxJQUNFLENBQUMsSUFBSSxDQUFDLFFBQVE7WUFDZCxPQUFPLElBQUksQ0FBQyxRQUFRLEtBQUssUUFBUTtZQUNqQyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsRUFDbEIsQ0FBQztZQUNELE9BQU87Z0JBQ0wsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLDZCQUE2QjtnQkFDcEMsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLFNBQVMs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LENBQUMsT0FBTztnQkFDekIsS0FBSyxFQUFFLFVBQVUsQ0FBQyxLQUFLO2dCQUN2QixTQUFTLEVBQUUsVUFBVSxDQUFDLFNBQVM7Z0JBQy9CLFNBQVMsRUFBRSxVQUFVLENBQUMsU0FBUzthQUNoQyxDQUFDO1FBQ0osQ0FBQztRQUVELG1EQUFtRDtRQUNuRCxPQUFPO1lBQ0wsS0FBSyxFQUFFLElBQUksRUFBRSxnREFBZ0Q7WUFDN0QsU0FBUyxFQUFFLFVBQVUsQ0FBQyxTQUFTO1lBQy9CLFNBQVMsRUFBRSxVQUFVLENBQUMsU0FBUztTQUNoQyxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBRUQsaUJBQWlCO0FBQ2pCOzs7Ozs7Ozs7Ozs7Ozs7OztFQWlCRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiQHRhdC1wcm90b2NvbC91dGlsc1wiO1xuaW1wb3J0IHsgYnl0ZXNUb0hleCB9IGZyb20gXCJAbm9ibGUvaGFzaGVzL3V0aWxzXCI7XG5cbi8qKlxuICogSFRMQyAoSGFzaCBUaW1lIExvY2tlZCBDb250cmFjdCkgc3RydWN0dXJlXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSFRMQyB7XG4gIGhhc2hsb2NrOiBzdHJpbmc7IC8vIEhhc2ggb2YgdGhlIHNlY3JldCBwcmVpbWFnZVxuICB0aW1lbG9jazogbnVtYmVyOyAvLyBVbml4IHRpbWVzdGFtcCB3aGVuIHRpbWVsb2NrIGV4cGlyZXNcbiAgaGFzaEZ1bmN0aW9uPzogc3RyaW5nOyAvLyBIYXNoIGFsZ29yaXRobSB1c2VkIChkZWZhdWx0OiAnc2hhMjU2Jylcbn1cblxuLyoqXG4gKiBIVExDIHZhbGlkYXRpb24gcmVzdWx0XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSFRMQ1ZhbGlkYXRpb25SZXN1bHQge1xuICBpc1ZhbGlkOiBib29sZWFuO1xuICBlcnJvcj86IHN0cmluZztcbiAgY2FuUmVkZWVtOiBib29sZWFuOyAvLyBDYW4gYmUgcmVkZWVtZWQgd2l0aCBzZWNyZXRcbiAgY2FuUmVmdW5kOiBib29sZWFuOyAvLyBDYW4gYmUgcmVmdW5kZWQgYWZ0ZXIgdGltZWxvY2tcbiAgaXNFeHBpcmVkOiBib29sZWFuOyAvLyBXaGV0aGVyIHRpbWVsb2NrIGhhcyBwYXNzZWRcbn1cblxuLyoqXG4gKiBIVExDIHJlZGVtcHRpb24gYXR0ZW1wdCByZXN1bHRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBIVExDUmVkZW1wdGlvblJlc3VsdCB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIGVycm9yPzogc3RyaW5nO1xuICBzZWNyZXRSZXZlYWxlZD86IHN0cmluZzsgLy8gVGhlIHNlY3JldCB0aGF0IHdhcyB1c2VkIChpZiBzdWNjZXNzZnVsKVxufVxuXG4vKipcbiAqIEVuaGFuY2VkIEhUTEMgaGFuZGxlciB3aXRoIHByb3BlciBzZWN1cml0eSB2YWxpZGF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBIVExDSGFuZGxlciB7XG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgSFRMQyBzdHJ1Y3R1cmUgYW5kIHRpbWluZyBjb25zdHJhaW50c1xuICAgKi9cbiAgc3RhdGljIHZhbGlkYXRlSFRMQyhcbiAgICBodGxjOiBIVExDLFxuICAgIGN1cnJlbnRUaW1lOiBudW1iZXIgPSBEYXRlLm5vdygpLFxuICApOiBIVExDVmFsaWRhdGlvblJlc3VsdCB7XG4gICAgLy8gSW5wdXQgdmFsaWRhdGlvblxuICAgIGlmICghaHRsYykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICAgIGVycm9yOiBcIkhUTEMgaXMgbnVsbCBvciB1bmRlZmluZWRcIixcbiAgICAgICAgY2FuUmVkZWVtOiBmYWxzZSxcbiAgICAgICAgY2FuUmVmdW5kOiBmYWxzZSxcbiAgICAgICAgaXNFeHBpcmVkOiBmYWxzZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgaWYgKCFodGxjLmhhc2hsb2NrIHx8IHR5cGVvZiBodGxjLmhhc2hsb2NrICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IFwiSW52YWxpZCBvciBtaXNzaW5nIGhhc2hsb2NrXCIsXG4gICAgICAgIGNhblJlZGVlbTogZmFsc2UsXG4gICAgICAgIGNhblJlZnVuZDogZmFsc2UsXG4gICAgICAgIGlzRXhwaXJlZDogZmFsc2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChcbiAgICAgICFodGxjLnRpbWVsb2NrIHx8XG4gICAgICB0eXBlb2YgaHRsYy50aW1lbG9jayAhPT0gXCJudW1iZXJcIiB8fFxuICAgICAgaHRsYy50aW1lbG9jayA8PSAwXG4gICAgKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IFwiSW52YWxpZCBvciBtaXNzaW5nIHRpbWVsb2NrXCIsXG4gICAgICAgIGNhblJlZGVlbTogZmFsc2UsXG4gICAgICAgIGNhblJlZnVuZDogZmFsc2UsXG4gICAgICAgIGlzRXhwaXJlZDogZmFsc2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIGhhc2ggZm9ybWF0IChzaG91bGQgYmUgaGV4IHN0cmluZylcbiAgICBpZiAoIS9eW2EtZkEtRjAtOV0rJC8udGVzdChodGxjLmhhc2hsb2NrKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICAgIGVycm9yOiBcIkhhc2hsb2NrIG11c3QgYmUgYSB2YWxpZCBoZXhhZGVjaW1hbCBzdHJpbmdcIixcbiAgICAgICAgY2FuUmVkZWVtOiBmYWxzZSxcbiAgICAgICAgY2FuUmVmdW5kOiBmYWxzZSxcbiAgICAgICAgaXNFeHBpcmVkOiBmYWxzZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaGFzaCBsZW5ndGggYmFzZWQgb24gYWxnb3JpdGhtXG4gICAgY29uc3QgaGFzaEZ1bmN0aW9uID0gaHRsYy5oYXNoRnVuY3Rpb24gfHwgXCJzaGEyNTZcIjtcbiAgICBjb25zdCBleHBlY3RlZExlbmd0aCA9IHRoaXMuZ2V0RXhwZWN0ZWRIYXNoTGVuZ3RoKGhhc2hGdW5jdGlvbik7XG4gICAgaWYgKGh0bGMuaGFzaGxvY2subGVuZ3RoICE9PSBleHBlY3RlZExlbmd0aCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICAgIGVycm9yOiBgSW52YWxpZCBoYXNoIGxlbmd0aCBmb3IgJHtoYXNoRnVuY3Rpb259OiBleHBlY3RlZCAke2V4cGVjdGVkTGVuZ3RofSwgZ290ICR7aHRsYy5oYXNobG9jay5sZW5ndGh9YCxcbiAgICAgICAgY2FuUmVkZWVtOiBmYWxzZSxcbiAgICAgICAgY2FuUmVmdW5kOiBmYWxzZSxcbiAgICAgICAgaXNFeHBpcmVkOiBmYWxzZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgdGltZWxvY2sgaXMgcmVhc29uYWJsZSAobm90IHRvbyBmYXIgaW4gcGFzdCBvciBmdXR1cmUpXG4gICAgY29uc3QgbWluVmFsaWRUaW1lID0gY3VycmVudFRpbWUgLSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7IC8vIDMwIGRheXMgYWdvXG4gICAgY29uc3QgbWF4VmFsaWRUaW1lID0gY3VycmVudFRpbWUgKyAzNjUgKiAyNCAqIDYwICogNjAgKiAxMDAwOyAvLyAxIHllYXIgZnJvbSBub3dcblxuICAgIGlmIChodGxjLnRpbWVsb2NrIDwgbWluVmFsaWRUaW1lKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IFwiVGltZWxvY2sgaXMgdG9vIGZhciBpbiB0aGUgcGFzdFwiLFxuICAgICAgICBjYW5SZWRlZW06IGZhbHNlLFxuICAgICAgICBjYW5SZWZ1bmQ6IGZhbHNlLFxuICAgICAgICBpc0V4cGlyZWQ6IHRydWUsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChodGxjLnRpbWVsb2NrID4gbWF4VmFsaWRUaW1lKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IFwiVGltZWxvY2sgaXMgdG9vIGZhciBpbiB0aGUgZnV0dXJlXCIsXG4gICAgICAgIGNhblJlZGVlbTogZmFsc2UsXG4gICAgICAgIGNhblJlZnVuZDogZmFsc2UsXG4gICAgICAgIGlzRXhwaXJlZDogZmFsc2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGlzRXhwaXJlZCA9IGh0bGMudGltZWxvY2sgPD0gY3VycmVudFRpbWU7XG5cbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogdHJ1ZSxcbiAgICAgIGNhblJlZGVlbTogIWlzRXhwaXJlZCwgLy8gQ2FuIG9ubHkgcmVkZWVtIHdpdGggc2VjcmV0IGJlZm9yZSBleHBpcnlcbiAgICAgIGNhblJlZnVuZDogaXNFeHBpcmVkLCAvLyBDYW4gb25seSByZWZ1bmQgYWZ0ZXIgZXhwaXJ5XG4gICAgICBpc0V4cGlyZWQsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byByZWRlZW0gSFRMQyB3aXRoIHByb3ZpZGVkIHNlY3JldFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlZGVlbUhUTEMoXG4gICAgaHRsYzogSFRMQyxcbiAgICBzZWNyZXQ6IHN0cmluZyxcbiAgICBjdXJyZW50VGltZTogbnVtYmVyID0gRGF0ZS5ub3coKSxcbiAgKTogUHJvbWlzZTxIVExDUmVkZW1wdGlvblJlc3VsdD4ge1xuICAgIC8vIEZpcnN0IHZhbGlkYXRlIHRoZSBIVExDXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHRoaXMudmFsaWRhdGVIVExDKGh0bGMsIGN1cnJlbnRUaW1lKTtcbiAgICBpZiAoIXZhbGlkYXRpb24uaXNWYWxpZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiB2YWxpZGF0aW9uLmVycm9yLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiByZWRlbXB0aW9uIGlzIGFsbG93ZWQgKGJlZm9yZSB0aW1lbG9jayBleHBpcnkpXG4gICAgaWYgKCF2YWxpZGF0aW9uLmNhblJlZGVlbSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiB2YWxpZGF0aW9uLmlzRXhwaXJlZFxuICAgICAgICAgID8gXCJDYW5ub3QgcmVkZWVtOiBIVExDIGhhcyBleHBpcmVkLCBvbmx5IHJlZnVuZCBpcyBwb3NzaWJsZVwiXG4gICAgICAgICAgOiBcIkNhbm5vdCByZWRlZW06IEhUTEMgdmFsaWRhdGlvbiBmYWlsZWRcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgc2VjcmV0IGlucHV0XG4gICAgaWYgKCFzZWNyZXQgfHwgdHlwZW9mIHNlY3JldCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiBcIkludmFsaWQgc2VjcmV0IHByb3ZpZGVkXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFByZXZlbnQgdGltaW5nIGF0dGFja3MgYnkgYWx3YXlzIGNvbXB1dGluZyBoYXNoXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhc2hGdW5jdGlvbiA9IGh0bGMuaGFzaEZ1bmN0aW9uIHx8IFwic2hhMjU2XCI7XG4gICAgICBjb25zdCBzZWNyZXRIYXNoID0gYXdhaXQgdGhpcy5jb21wdXRlSGFzaChzZWNyZXQsIGhhc2hGdW5jdGlvbik7XG5cbiAgICAgIC8vIFVzZSBjb25zdGFudC10aW1lIGNvbXBhcmlzb24gdG8gcHJldmVudCB0aW1pbmcgYXR0YWNrc1xuICAgICAgY29uc3QgaXNWYWxpZFNlY3JldCA9IHRoaXMuY29uc3RhbnRUaW1lRXF1YWwoXG4gICAgICAgIHNlY3JldEhhc2gsXG4gICAgICAgIGh0bGMuaGFzaGxvY2sudG9Mb3dlckNhc2UoKSxcbiAgICAgICk7XG5cbiAgICAgIGlmIChpc1ZhbGlkU2VjcmV0KSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBzZWNyZXRSZXZlYWxlZDogc2VjcmV0LFxuICAgICAgICB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvcjogXCJJbnZhbGlkIHNlY3JldDogaGFzaCBkb2VzIG5vdCBtYXRjaCBoYXNobG9ja1wiLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gdmVyaWZ5IHNlY3JldDogJHtlcnJvcn1gLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIEhUTEMgY2FuIGJlIHJlZnVuZGVkIChhZnRlciB0aW1lbG9jayBleHBpcnkpXG4gICAqL1xuICBzdGF0aWMgY2FuUmVmdW5kKFxuICAgIGh0bGM6IEhUTEMsXG4gICAgY3VycmVudFRpbWU6IG51bWJlciA9IERhdGUubm93KCksXG4gICk6IHsgY2FuUmVmdW5kOiBib29sZWFuOyBlcnJvcj86IHN0cmluZyB9IHtcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gdGhpcy52YWxpZGF0ZUhUTEMoaHRsYywgY3VycmVudFRpbWUpO1xuICAgIGlmICghdmFsaWRhdGlvbi5pc1ZhbGlkKSB7XG4gICAgICByZXR1cm4geyBjYW5SZWZ1bmQ6IGZhbHNlLCBlcnJvcjogdmFsaWRhdGlvbi5lcnJvciB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjYW5SZWZ1bmQ6IHZhbGlkYXRpb24uY2FuUmVmdW5kLFxuICAgICAgZXJyb3I6IHZhbGlkYXRpb24uY2FuUmVmdW5kXG4gICAgICAgID8gdW5kZWZpbmVkXG4gICAgICAgIDogXCJDYW5ub3QgcmVmdW5kOiBIVExDIGhhcyBub3QgeWV0IGV4cGlyZWRcIixcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgSFRMQyB3aXRoIHByb3BlciB2YWxpZGF0aW9uXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlSFRMQyhcbiAgICBzZWNyZXQ6IHN0cmluZyxcbiAgICB0aW1lbG9ja0R1cmF0aW9uOiBudW1iZXIsXG4gICAgaGFzaEZ1bmN0aW9uOiBzdHJpbmcgPSBcInNoYTI1NlwiLFxuICApOiBQcm9taXNlPHsgaHRsYzogSFRMQzsgc2VjcmV0OiBzdHJpbmcgfSB8IHsgZXJyb3I6IHN0cmluZyB9PiB7XG4gICAgaWYgKCFzZWNyZXQgfHwgdHlwZW9mIHNlY3JldCAhPT0gXCJzdHJpbmdcIiB8fCBzZWNyZXQubGVuZ3RoIDwgMTYpIHtcbiAgICAgIHJldHVybiB7IGVycm9yOiBcIlNlY3JldCBtdXN0IGJlIGF0IGxlYXN0IDE2IGNoYXJhY3RlcnMgbG9uZ1wiIH07XG4gICAgfVxuXG4gICAgaWYgKCF0aW1lbG9ja0R1cmF0aW9uIHx8IHRpbWVsb2NrRHVyYXRpb24gPD0gMCkge1xuICAgICAgcmV0dXJuIHsgZXJyb3I6IFwiVGltZWxvY2sgZHVyYXRpb24gbXVzdCBiZSBwb3NpdGl2ZVwiIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgaGFzaCBmdW5jdGlvblxuICAgIGlmICghW1wic2hhMjU2XCJdLmluY2x1ZGVzKGhhc2hGdW5jdGlvbikpIHtcbiAgICAgIHJldHVybiB7IGVycm9yOiBgVW5zdXBwb3J0ZWQgaGFzaCBmdW5jdGlvbjogJHtoYXNoRnVuY3Rpb259YCB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBoYXNobG9jayA9IGF3YWl0IHRoaXMuY29tcHV0ZUhhc2goc2VjcmV0LCBoYXNoRnVuY3Rpb24pO1xuICAgICAgY29uc3QgdGltZWxvY2sgPSBEYXRlLm5vdygpICsgdGltZWxvY2tEdXJhdGlvbjtcblxuICAgICAgY29uc3QgaHRsYzogSFRMQyA9IHtcbiAgICAgICAgaGFzaGxvY2ssXG4gICAgICAgIHRpbWVsb2NrLFxuICAgICAgICBoYXNoRnVuY3Rpb24sXG4gICAgICB9O1xuXG4gICAgICByZXR1cm4geyBodGxjLCBzZWNyZXQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHsgZXJyb3I6IGBGYWlsZWQgdG8gY3JlYXRlIEhUTEM6ICR7ZXJyb3J9YCB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wdXRlcyBoYXNoIHVzaW5nIHNwZWNpZmllZCBhbGdvcml0aG1cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIGNvbXB1dGVIYXNoKFxuICAgIGRhdGE6IHN0cmluZyxcbiAgICBhbGdvcml0aG06IHN0cmluZyA9IFwic2hhMjU2XCIsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgc3dpdGNoIChhbGdvcml0aG0udG9Mb3dlckNhc2UoKSkge1xuICAgICAgY2FzZSBcInNoYTI1NlwiOlxuICAgICAgICBjb25zdCBoYXNoID0gYXdhaXQgY3JlYXRlSGFzaChkYXRhKTtcbiAgICAgICAgcmV0dXJuIGJ5dGVzVG9IZXgoaGFzaCk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGhhc2ggYWxnb3JpdGhtOiAke2FsZ29yaXRobX1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29uc3RhbnQtdGltZSBzdHJpbmcgY29tcGFyaXNvbiB0byBwcmV2ZW50IHRpbWluZyBhdHRhY2tzXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBjb25zdGFudFRpbWVFcXVhbChhOiBzdHJpbmcsIGI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBsZXQgcmVzdWx0ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlc3VsdCB8PSBhLmNoYXJDb2RlQXQoaSkgXiBiLmNoYXJDb2RlQXQoaSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGV4cGVjdGVkIGhhc2ggbGVuZ3RoIGZvciBnaXZlbiBhbGdvcml0aG1cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGdldEV4cGVjdGVkSGFzaExlbmd0aChhbGdvcml0aG06IHN0cmluZyk6IG51bWJlciB7XG4gICAgc3dpdGNoIChhbGdvcml0aG0udG9Mb3dlckNhc2UoKSkge1xuICAgICAgY2FzZSBcInNoYTI1NlwiOlxuICAgICAgICByZXR1cm4gNjQ7IC8vIDMyIGJ5dGVzICogMiBoZXggY2hhcnMgcGVyIGJ5dGVcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBoYXNoIGFsZ29yaXRobTogJHthbGdvcml0aG19YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVXBkYXRlZCBUb2tlbiBwYXlsb2FkIHdpdGggcHJvcGVyIEhUTEMgc3RydWN0dXJlXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRW5oYW5jZWRQYXlsb2FkIHtcbiAgaXNzOiBzdHJpbmc7IC8vIElzc3VlciAoZm9yZ2UpIHB1YmtleVxuICBpYXQ6IG51bWJlcjsgLy8gSXNzdWVkIGF0IHRpbWVzdGFtcFxuICBhbW91bnQ/OiBudW1iZXI7IC8vIFRva2VuIGFtb3VudC92YWx1ZVxuICBIVExDPzogSFRMQzsgLy8gSGFzaCBUaW1lIExvY2tlZCBDb250cmFjdFxuICB0aW1lTG9jaz86IG51bWJlcjsgLy8gU2ltcGxlIHRpbWVsb2NrIGNvbnN0cmFpbnQgKGRpZmZlcmVudCBmcm9tIEhUTEMpXG4gIFAyUEtsb2NrPzogc3RyaW5nOyAvLyBQdWJsaWMga2V5IGxvY2tcbiAgdG9rZW5JRD86IG51bWJlciB8IHN0cmluZzsgLy8gVW5pcXVlIHRva2VuIGlkZW50aWZpZXJcbiAgZGF0YV91cmk/OiBzdHJpbmc7IC8vIE9wdGlvbmFsIGRhdGEgVVJJXG59XG5cbi8qKlxuICogRXhhbXBsZSB1c2FnZSBpbiB0b2tlbiB2YWxpZGF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBUb2tlblZhbGlkYXRvciB7XG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSB0b2tlbiB3aXRoIEhUTEMgY29uc3RyYWludHNcbiAgICovXG4gIHN0YXRpYyBhc3luYyB2YWxpZGF0ZVRva2VuSFRMQyhcbiAgICB0b2tlbjogeyBwYXlsb2FkOiBFbmhhbmNlZFBheWxvYWQgfSxcbiAgICBzZWNyZXQ/OiBzdHJpbmcsXG4gICAgY3VycmVudFRpbWU6IG51bWJlciA9IERhdGUubm93KCksXG4gICk6IFByb21pc2U8e1xuICAgIHZhbGlkOiBib29sZWFuO1xuICAgIGVycm9yPzogc3RyaW5nO1xuICAgIGNhblJlZGVlbT86IGJvb2xlYW47XG4gICAgY2FuUmVmdW5kPzogYm9vbGVhbjtcbiAgfT4ge1xuICAgIGlmICghdG9rZW4ucGF5bG9hZC5IVExDKSB7XG4gICAgICByZXR1cm4geyB2YWxpZDogdHJ1ZSB9OyAvLyBObyBIVExDLCB2YWxpZGF0aW9uIHBhc3Nlc1xuICAgIH1cblxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBIVExDSGFuZGxlci52YWxpZGF0ZUhUTEMoXG4gICAgICB0b2tlbi5wYXlsb2FkLkhUTEMsXG4gICAgICBjdXJyZW50VGltZSxcbiAgICApO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLmlzVmFsaWQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IHZhbGlkYXRpb24uZXJyb3IsXG4gICAgICAgIGNhblJlZGVlbTogZmFsc2UsXG4gICAgICAgIGNhblJlZnVuZDogZmFsc2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIElmIHNlY3JldCBpcyBwcm92aWRlZCwgYXR0ZW1wdCByZWRlbXB0aW9uXG4gICAgaWYgKHNlY3JldCkge1xuICAgICAgY29uc3QgcmVkZW1wdGlvbiA9IGF3YWl0IEhUTENIYW5kbGVyLnJlZGVlbUhUTEMoXG4gICAgICAgIHRva2VuLnBheWxvYWQuSFRMQyxcbiAgICAgICAgc2VjcmV0LFxuICAgICAgICBjdXJyZW50VGltZSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB2YWxpZDogcmVkZW1wdGlvbi5zdWNjZXNzLFxuICAgICAgICBlcnJvcjogcmVkZW1wdGlvbi5lcnJvcixcbiAgICAgICAgY2FuUmVkZWVtOiB2YWxpZGF0aW9uLmNhblJlZGVlbSxcbiAgICAgICAgY2FuUmVmdW5kOiB2YWxpZGF0aW9uLmNhblJlZnVuZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gTm8gc2VjcmV0IHByb3ZpZGVkLCBqdXN0IHJldHVybiB2YWxpZGF0aW9uIHN0YXRlXG4gICAgcmV0dXJuIHtcbiAgICAgIHZhbGlkOiB0cnVlLCAvLyBTdHJ1Y3R1cmUgaXMgdmFsaWQsIGJ1dCBtYXkgbm90IGJlIHJlZGVlbWFibGVcbiAgICAgIGNhblJlZGVlbTogdmFsaWRhdGlvbi5jYW5SZWRlZW0sXG4gICAgICBjYW5SZWZ1bmQ6IHZhbGlkYXRpb24uY2FuUmVmdW5kLFxuICAgIH07XG4gIH1cbn1cblxuLy8gRXhhbXBsZSB1c2FnZTpcbi8qXG4vLyBDcmVhdGluZyBhbiBIVExDXG5jb25zdCByZXN1bHQgPSBhd2FpdCBIVExDSGFuZGxlci5jcmVhdGVIVExDKFwibXktc2VjcmV0LXByZWltYWdlXCIsIDM2MDAwMDApOyAvLyAxIGhvdXJcbmlmICgnaHRsYycgaW4gcmVzdWx0KSB7XG4gIGNvbnNvbGUubG9nKCdIVExDIGNyZWF0ZWQ6JywgcmVzdWx0Lmh0bGMpO1xufVxuXG4vLyBWYWxpZGF0aW5nIEhUTENcbmNvbnN0IHZhbGlkYXRpb24gPSBIVExDSGFuZGxlci52YWxpZGF0ZUhUTEMoaHRsYyk7XG5jb25zb2xlLmxvZygnQ2FuIHJlZGVlbTonLCB2YWxpZGF0aW9uLmNhblJlZGVlbSk7XG5jb25zb2xlLmxvZygnQ2FuIHJlZnVuZDonLCB2YWxpZGF0aW9uLmNhblJlZnVuZCk7XG5cbi8vIEF0dGVtcHRpbmcgcmVkZW1wdGlvblxuY29uc3QgcmVkZW1wdGlvbiA9IGF3YWl0IEhUTENIYW5kbGVyLnJlZGVlbUhUTEMoaHRsYywgXCJteS1zZWNyZXQtcHJlaW1hZ2VcIik7XG5pZiAocmVkZW1wdGlvbi5zdWNjZXNzKSB7XG4gIGNvbnNvbGUubG9nKCdSZWRlbXB0aW9uIHN1Y2Nlc3NmdWwhJyk7XG59XG4qL1xuIl19