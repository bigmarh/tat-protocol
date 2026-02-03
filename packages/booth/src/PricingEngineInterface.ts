import { Price, PricingConfig, TokenOrder } from "./types";

/**
 * Price calculation result
 */
export interface PriceCalculation {
  basePrice: Price;
  discounts: Array<{
    type: string;
    amount: number;
    description: string;
  }>;
  fees: Array<{
    type: string;
    amount: number;
    description: string;
  }>;
  tax?: {
    amount: number;
    rate: number;
  };
  finalPrice: Price;
  breakdown: string; // Human-readable price breakdown
}

/**
 * Pricing engine interface
 *
 * This interface defines the protocol for dynamic pricing strategies.
 * Implementations can support various pricing models: fixed, dynamic,
 * bulk discounts, time-based pricing, member pricing, etc.
 *
 * @example
 * ```typescript
 * class BulkDiscountPricing implements PricingEngine {
 *   calculatePrice(order: Partial<TokenOrder>): PriceCalculation {
 *     const basePrice = this.config.basePrice;
 *     const quantity = order.quantity || 1;
 *
 *     // Apply bulk discount
 *     let discount = 0;
 *     if (quantity >= 10) discount = 0.2; // 20% off
 *     else if (quantity >= 5) discount = 0.1; // 10% off
 *
 *     const finalAmount = basePrice.amount * quantity * (1 - discount);
 *
 *     return {
 *       basePrice: { amount: basePrice.amount * quantity, currency: basePrice.currency },
 *       discounts: discount > 0 ? [{
 *         type: 'BULK',
 *         amount: basePrice.amount * quantity * discount,
 *         description: `${discount * 100}% bulk discount`
 *       }] : [],
 *       fees: [],
 *       finalPrice: { amount: finalAmount, currency: basePrice.currency },
 *       breakdown: `Base: ${basePrice.amount * quantity}, Discount: -${discount * 100}%, Final: ${finalAmount}`
 *     };
 *   }
 * }
 * ```
 */
export interface PricingEngine {
  /**
   * Pricing engine name/identifier
   */
  readonly name: string;

  /**
   * Pricing configuration
   */
  config: PricingConfig;

  /**
   * Calculate price for an order
   *
   * Computes the final price based on quantity, discounts, fees, taxes, etc.
   *
   * @param order - Partial order with quantity and buyer info
   * @param context - Optional pricing context (time, buyer tier, etc.)
   * @returns Complete price calculation
   */
  calculatePrice(
    order: Partial<TokenOrder>,
    context?: Record<string, unknown>
  ): PriceCalculation;

  /**
   * Validate price
   *
   * Checks if a proposed price is valid for the given order.
   * Useful for verifying user-provided pricing data.
   *
   * @param order - Order to validate
   * @param proposedPrice - Price to validate
   * @returns True if price is valid
   */
  validatePrice(order: Partial<TokenOrder>, proposedPrice: Price): boolean;

  /**
   * Update pricing configuration
   *
   * Updates the pricing rules dynamically.
   *
   * @param config - New pricing configuration
   */
  updateConfig(config: Partial<PricingConfig>): void;

  /**
   * Get current base price
   *
   * Returns the current base price for an item.
   *
   * @param itemId - Optional item identifier
   * @returns Current base price
   */
  getBasePrice(itemId?: string): Price;
}
