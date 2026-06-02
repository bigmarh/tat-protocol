import type { Token } from "@tat-protocol/token";
import { ValidationResult, ValidationStrategy } from "./types.js";
import type {
  ValidationContext,
  ValidationStrategyInterface,
} from "./ValidationStrategyInterface.js";

interface UsageRecord {
  uses: number;
  lastUsed?: number;
  metadata?: Record<string, unknown>;
}

class UsageBackedStrategy implements ValidationStrategyInterface {
  private readonly usage = new Map<string, UsageRecord>();

  constructor(
    readonly type: ValidationStrategy,
    private readonly validateUse: (
      token: Token,
      usage: UsageRecord,
      context?: ValidationContext,
    ) => Promise<{
      valid: boolean;
      reason?: string;
      metadata?: Record<string, unknown>;
    }>,
  ) {}

  async validate(
    token: Token,
    context?: ValidationContext,
  ): Promise<ValidationResult> {
    const usage = this.usage.get(token.header.token_hash) ?? { uses: 0 };
    const result = await this.validateUse(token, usage, context);
    return {
      valid: result.valid,
      token,
      reason: result.reason,
      timestamp: Date.now(),
      metadata: result.metadata,
    };
  }

  async consume(token: Token, context?: ValidationContext): Promise<boolean> {
    const tokenHash = token.header.token_hash;
    const current = this.usage.get(tokenHash) ?? { uses: 0 };
    this.usage.set(tokenHash, {
      uses: current.uses + 1,
      lastUsed: Date.now(),
      metadata: { ...(current.metadata ?? {}), ...(context?.customData ?? {}) },
    });
    return true;
  }

  async canUse(token: Token): Promise<boolean> {
    return (await this.validate(token)).valid;
  }

  async getUsage(tokenHash: string): Promise<UsageRecord> {
    return this.usage.get(tokenHash) ?? { uses: 0 };
  }

  async reset(tokenHash: string): Promise<boolean> {
    return this.usage.delete(tokenHash);
  }
}

/** Token can be consumed exactly once. */
export function singleUse(): ValidationStrategyInterface {
  return new UsageBackedStrategy(
    ValidationStrategy.SINGLE_USE,
    async (_token, usage) =>
      usage.uses > 0
        ? { valid: false, reason: "Token already used" }
        : { valid: true },
  );
}

/** Token can be consumed up to maxUses times. */
export function multiUse(maxUses: number): ValidationStrategyInterface {
  return new UsageBackedStrategy(
    ValidationStrategy.MULTI_ENTRY,
    async (_token, usage) =>
      usage.uses >= maxUses
        ? { valid: false, reason: `Token use limit reached (${maxUses})` }
        : { valid: true, metadata: { usesRemaining: maxUses - usage.uses } },
  );
}

/** Token is only usable within a wall-clock window. */
export function timeWindow(config: {
  startsAt?: number;
  endsAt?: number;
}): ValidationStrategyInterface {
  return new UsageBackedStrategy(ValidationStrategy.TIME_BASED, async () => {
    const now = Date.now();
    if (config.startsAt && now < config.startsAt) {
      return { valid: false, reason: "Access window has not started" };
    }
    if (config.endsAt && now > config.endsAt) {
      return { valid: false, reason: "Access window has ended" };
    }
    return { valid: true };
  });
}

/** Compose multiple strategies; all must pass, consume is applied to all. */
export function allOf(
  strategies: ValidationStrategyInterface[],
): ValidationStrategyInterface {
  return {
    type: ValidationStrategy.CUSTOM,
    async validate(token, context) {
      for (const strategy of strategies) {
        const result = await strategy.validate(token, context);
        if (!result.valid) return result;
      }
      return { valid: true, token, timestamp: Date.now() };
    },
    async consume(token, context) {
      await Promise.all(
        strategies.map((strategy) => strategy.consume(token, context)),
      );
      return true;
    },
    async canUse(token) {
      return (await this.validate(token)).valid;
    },
    async getUsage(tokenHash) {
      const entries = await Promise.all(
        strategies.map((strategy) => strategy.getUsage(tokenHash)),
      );
      return {
        uses: Math.max(...entries.map((entry) => entry.uses), 0),
        metadata: { strategies: entries },
      };
    },
    async reset(tokenHash) {
      const results = await Promise.all(
        strategies.map((strategy) => strategy.reset(tokenHash)),
      );
      return results.some(Boolean);
    },
  };
}
