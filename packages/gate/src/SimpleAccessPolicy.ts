import type { Token } from "@tat-protocol/token";
import type {
  AccessPolicyInterface,
  PolicyEvaluationResult,
} from "./AccessPolicyInterface.js";
import type { AccessPolicy } from "./types.js";

export class SimpleAccessPolicy implements AccessPolicyInterface {
  policy: AccessPolicy;
  private readonly blockedTokens = new Set<string>();
  private readonly allowedIssuers = new Set<string>();
  private readonly blockedIssuers = new Set<string>();

  constructor(policy: AccessPolicy) {
    this.policy = policy;
    for (const issuer of policy.allowedIssuers ?? [])
      this.allowedIssuers.add(issuer);
    for (const issuer of policy.blockedIssuers ?? [])
      this.blockedIssuers.add(issuer);
    for (const token of policy.blockedTokens ?? [])
      this.blockedTokens.add(token);
  }

  async evaluate(
    token: Token,
    context?: Record<string, unknown>,
  ): Promise<PolicyEvaluationResult> {
    if (!this.isIssuerAllowed(token.payload.iss)) {
      return { allowed: false, reason: "Token issuer is not allowed" };
    }
    if (this.blockedIssuers.has(token.payload.iss)) {
      return { allowed: false, reason: "Token issuer is blocked" };
    }
    if (this.isTokenBlocked(token.header.token_hash)) {
      return { allowed: false, reason: "Token is blocked" };
    }
    if (!this.isWithinOperatingHours()) {
      return { allowed: false, reason: "Outside operating hours" };
    }

    for (const rule of this.policy.customRules ?? []) {
      if (!(await rule.check(token, context))) {
        return { allowed: false, reason: `Custom rule failed: ${rule.name}` };
      }
    }

    return { allowed: true };
  }

  isIssuerAllowed(issuerPubkey: string): boolean {
    return (
      this.allowedIssuers.size === 0 || this.allowedIssuers.has(issuerPubkey)
    );
  }

  isTokenBlocked(tokenHash: string): boolean {
    return this.blockedTokens.has(tokenHash);
  }

  addAllowedIssuer(issuerPubkey: string): void {
    this.allowedIssuers.add(issuerPubkey);
    this.policy.allowedIssuers = Array.from(this.allowedIssuers);
  }

  removeAllowedIssuer(issuerPubkey: string): void {
    this.allowedIssuers.delete(issuerPubkey);
    this.policy.allowedIssuers = Array.from(this.allowedIssuers);
  }

  blockToken(tokenHash: string): void {
    this.blockedTokens.add(tokenHash);
    this.policy.blockedTokens = Array.from(this.blockedTokens);
  }

  unblockToken(tokenHash: string): void {
    this.blockedTokens.delete(tokenHash);
    this.policy.blockedTokens = Array.from(this.blockedTokens);
  }

  updatePolicy(updates: Partial<AccessPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    if (updates.allowedIssuers) {
      this.allowedIssuers.clear();
      for (const issuer of updates.allowedIssuers)
        this.allowedIssuers.add(issuer);
    }
    if (updates.blockedIssuers) {
      this.blockedIssuers.clear();
      for (const issuer of updates.blockedIssuers)
        this.blockedIssuers.add(issuer);
    }
    if (updates.blockedTokens) {
      this.blockedTokens.clear();
      for (const token of updates.blockedTokens) this.blockedTokens.add(token);
    }
  }

  isWithinOperatingHours(): boolean {
    const hours = this.policy.operatingHours;
    if (!hours) return true;

    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const start = this.timeToMinutes(hours.start);
    const end = this.timeToMinutes(hours.end);

    if (start <= end) {
      return current >= start && current <= end;
    }
    return current >= start || current <= end;
  }

  private timeToMinutes(value: string): number {
    const [hh = "0", mm = "0"] = value.split(":");
    return Number(hh) * 60 + Number(mm);
  }
}

export function createAccessPolicy(policy: AccessPolicy): SimpleAccessPolicy {
  return new SimpleAccessPolicy(policy);
}
