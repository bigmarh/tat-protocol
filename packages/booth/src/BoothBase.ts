import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { DebugLogger } from "@tat-protocol/utils";
import { randomBytes } from "crypto";
import {
  TokenOrder,
  OrderStatus,
  Payment,
  Receipt,
  InventoryItem,
  Price,
  PaymentMethod,
  SalesAnalytics,
  RefundRequest,
} from "./types";
import { PaymentProvider } from "./PaymentProviderInterface";
import { PricingEngine } from "./PricingEngineInterface";

const Debug = DebugLogger.getInstance();

/**
 * Boxoffice configuration
 */
export interface BoothConfig {
  storage?: StorageInterface;
  keys?: KeyPair;
  forgePubkey?: string; // Associated forge for minting tokens
  paymentProviders?: PaymentProvider[];
  pricingEngine?: PricingEngine;
}

/**
 * Boxoffice state
 */
export interface BoothState {
  orders: Map<string, TokenOrder>; // orderId -> order
  payments: Map<string, Payment>; // paymentId -> payment
  receipts: Map<string, Receipt>; // receiptId -> receipt
  inventory: Map<string, InventoryItem>; // itemId -> inventory
  refunds: Map<string, RefundRequest>; // refundId -> refund
}

/**
 * BoothBase - Abstract base class for token sales/purchase protocol
 *
 * This class defines the protocol for purchasing TAT tokens through various
 * payment methods. It provides:
 * - Order management
 * - Payment processing with pluggable providers
 * - Inventory tracking
 * - Receipt generation
 * - Refund handling
 * - Sales analytics
 *
 * Subclasses must implement abstract methods for specific sale flows
 * (e.g., minting tokens after payment, integrating with Forge, etc.)
 *
 * @example
 * ```typescript
 * class MyBoxoffice extends BoothBase {
 *   async fulfillOrder(order: TokenOrder): Promise<Receipt> {
 *     // Mint tokens via Forge
 *     const tokens = await this.forge.mint({
 *       recipient: order.buyerAddress,
 *       quantity: order.quantity
 *     });
 *
 *     // Create receipt
 *     return this.createReceipt(order, tokens);
 *   }
 * }
 * ```
 */
export abstract class BoothBase {
  protected config: BoothConfig;
  protected storage: StorageInterface;
  protected state!: BoothState;
  protected isInitialized: boolean = false;
  protected stateKey: string = "";
  protected paymentProviders: Map<PaymentMethod, PaymentProvider> = new Map();
  protected pricingEngine?: PricingEngine;

  constructor(config: BoothConfig) {
    if (!config.storage) {
      throw new Error(
        "A StorageInterface implementation must be provided in config.storage",
      );
    }

    this.config = config;
    this.storage = config.storage;
    this.pricingEngine = config.pricingEngine;

    // Register payment providers
    if (config.paymentProviders) {
      for (const provider of config.paymentProviders) {
        for (const method of provider.supportedMethods) {
          this.paymentProviders.set(method, provider);
        }
      }
    }
  }

  /**
   * Initialize the Boxoffice instance
   *
   * Loads state from storage and prepares for operations.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.stateKey = `boxoffice-state-${this.config.forgePubkey || "default"}`;
      await this._loadState();
      this.isInitialized = true;
      Debug.log("Boxoffice initialized", "Booth");
    } catch (error) {
      throw new Error(`Failed to initialize Boxoffice: ${error}`);
    }
  }

  // =============================
  // Abstract Methods (must be implemented by subclasses)
  // =============================

  /**
   * Fulfill an order after payment is confirmed
   *
   * This method should mint/issue tokens and deliver them to the buyer.
   * Typically integrates with a Forge to create tokens.
   *
   * @param order - The paid order to fulfill
   * @returns Receipt with issued tokens
   */
  protected abstract fulfillOrder(order: TokenOrder): Promise<Receipt>;

  /**
   * Validate order before creating it
   *
   * Perform custom validation (inventory checks, buyer verification, etc.)
   *
   * @param order - Order to validate
   * @returns True if order is valid
   * @throws Error if order is invalid
   */
  protected abstract validateOrder(
    order: Partial<TokenOrder>,
  ): Promise<boolean>;

  // =============================
  // Order Management
  // =============================

  /**
   * Create a new token order
   *
   * Creates a pending order for purchasing tokens.
   *
   * @param orderData - Order details
   * @returns Created order
   */
  async createOrder(
    orderData: Omit<
      TokenOrder,
      "orderId" | "status" | "createdAt" | "updatedAt"
    >,
  ): Promise<TokenOrder> {
    const order: TokenOrder = {
      ...orderData,
      orderId: this._generateOrderId(),
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Validate order
    await this.validateOrder(order);

    // Calculate price if pricing engine is configured
    if (this.pricingEngine) {
      const calculation = this.pricingEngine.calculatePrice(order);
      order.price = calculation.finalPrice;
      order.metadata = {
        ...order.metadata,
        priceBreakdown: calculation,
      };
    }

    // Store order
    this.state.orders.set(order.orderId, order);
    await this._saveState();

    Debug.log(`Order created: ${order.orderId}`, "Booth");
    return order;
  }

  /**
   * Get order by ID
   *
   * @param orderId - Order identifier
   * @returns Order or undefined
   */
  async getOrder(orderId: string): Promise<TokenOrder | undefined> {
    return this.state.orders.get(orderId);
  }

  /**
   * Update order status
   *
   * @param orderId - Order identifier
   * @param status - New status
   */
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.status = status;
    order.updatedAt = Date.now();

    if (status === "paid") {
      order.paidAt = Date.now();
    } else if (status === "fulfilled") {
      order.fulfilledAt = Date.now();
    }

    this.state.orders.set(orderId, order);
    await this._saveState();

    Debug.log(`Order ${orderId} status updated to ${status}`, "Booth");
  }

  /**
   * Cancel an order
   *
   * @param orderId - Order identifier
   * @param reason - Cancellation reason
   */
  async cancelOrder(orderId: string, reason?: string): Promise<void> {
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status === "fulfilled") {
      throw new Error("Cannot cancel fulfilled order");
    }

    order.status = "cancelled";
    order.updatedAt = Date.now();
    order.metadata = {
      ...order.metadata,
      cancellationReason: reason,
    };

    this.state.orders.set(orderId, order);
    await this._saveState();

    Debug.log(`Order cancelled: ${orderId}`, "Booth");
  }

  // =============================
  // Payment Processing
  // =============================

  /**
   * Initialize payment for an order
   *
   * Creates a payment request using the appropriate payment provider.
   *
   * @param orderId - Order identifier
   * @returns Payment initialization result
   */
  async initializePayment(orderId: string) {
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== "pending") {
      throw new Error(`Order is not pending: ${order.status}`);
    }

    // Get payment provider
    const provider = this.paymentProviders.get(order.paymentMethod);
    if (!provider) {
      throw new Error(
        `No payment provider configured for method: ${order.paymentMethod}`,
      );
    }

    // Create payment record
    const payment: Payment = {
      paymentId: this._generatePaymentId(),
      orderId: order.orderId,
      method: order.paymentMethod,
      status: "pending",
      amount: order.price,
      provider: provider.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Initialize payment with provider
    const initResult = await provider.initializePayment(payment);

    payment.providerData = initResult.paymentData;
    this.state.payments.set(payment.paymentId, payment);
    await this._saveState();

    Debug.log(`Payment initialized: ${payment.paymentId}`, "Booth");

    return {
      payment,
      ...initResult,
    };
  }

  /**
   * Verify payment status
   *
   * Checks if a payment has been completed.
   *
   * @param paymentId - Payment identifier
   * @returns Payment verification result
   */
  async verifyPayment(paymentId: string) {
    const payment = this.state.payments.get(paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    const provider = this.paymentProviders.get(payment.method);
    if (!provider) {
      throw new Error(
        `No payment provider configured for method: ${payment.method}`,
      );
    }

    const result = await provider.verifyPayment(paymentId);

    // Update payment status
    payment.status = result.status;
    payment.updatedAt = Date.now();
    if (result.completedAt) {
      payment.completedAt = result.completedAt;
    }

    this.state.payments.set(paymentId, payment);

    // If payment completed, update order
    if (result.status === "completed") {
      await this.updateOrderStatus(payment.orderId, "paid");

      // Auto-fulfill if configured
      const order = this.state.orders.get(payment.orderId);
      if (order) {
        await this.processOrderFulfillment(order);
      }
    }

    await this._saveState();

    return result;
  }

  /**
   * Process order fulfillment
   *
   * Fulfills a paid order by issuing tokens.
   *
   * @param order - Order to fulfill
   */
  protected async processOrderFulfillment(order: TokenOrder): Promise<Receipt> {
    if (order.status !== "paid") {
      throw new Error(`Order is not paid: ${order.status}`);
    }

    // Mark as confirmed while processing
    await this.updateOrderStatus(order.orderId, "confirmed");

    try {
      // Fulfill order (implemented by subclass)
      const receipt = await this.fulfillOrder(order);

      // Store receipt - handle both new (id) and legacy (receiptId) fields
      const receiptKey = receipt.id || receipt.receiptId;
      if (!receiptKey) {
        throw new Error("Receipt must have an id");
      }
      this.state.receipts.set(receiptKey, receipt);

      // Update order status
      await this.updateOrderStatus(order.orderId, "fulfilled");

      await this._saveState();

      Debug.log(`Order fulfilled: ${order.orderId}`, "Booth");

      return receipt;
    } catch (error) {
      // Fulfillment failed, mark order as failed
      await this.updateOrderStatus(order.orderId, "failed");
      order.metadata = {
        ...order.metadata,
        fulfillmentError:
          error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  // =============================
  // Inventory Management
  // =============================

  /**
   * Add inventory item
   *
   * @param item - Inventory item to add
   */
  async addInventoryItem(item: InventoryItem): Promise<void> {
    this.state.inventory.set(item.itemId, item);
    await this._saveState();
    Debug.log(`Inventory item added: ${item.itemId}`, "Booth");
  }

  /**
   * Update inventory availability
   *
   * @param itemId - Item identifier
   * @param delta - Change in availability (positive or negative)
   */
  async updateInventory(itemId: string, delta: number): Promise<void> {
    const item = this.state.inventory.get(itemId);
    if (!item) {
      throw new Error(`Inventory item not found: ${itemId}`);
    }

    item.available += delta;
    if (item.available < 0) {
      throw new Error(`Insufficient inventory for item: ${itemId}`);
    }

    this.state.inventory.set(itemId, item);
    await this._saveState();
  }

  /**
   * Get inventory item
   *
   * @param itemId - Item identifier
   * @returns Inventory item or undefined
   */
  async getInventoryItem(itemId: string): Promise<InventoryItem | undefined> {
    return this.state.inventory.get(itemId);
  }

  /**
   * List all inventory items
   *
   * @param activeOnly - Only return active items
   * @returns Array of inventory items
   */
  async listInventory(activeOnly: boolean = false): Promise<InventoryItem[]> {
    const items = Array.from(this.state.inventory.values());
    if (activeOnly) {
      return items.filter((item) => item.active && item.available > 0);
    }
    return items;
  }

  // =============================
  // Receipts
  // =============================

  /**
   * Get receipt by ID
   *
   * @param receiptId - Receipt identifier
   * @returns Receipt or undefined
   */
  async getReceipt(receiptId: string): Promise<Receipt | undefined> {
    return this.state.receipts.get(receiptId);
  }

  /**
   * Get receipt by order ID
   *
   * @param orderId - Order identifier
   * @returns Receipt or undefined
   */
  async getReceiptByOrderId(orderId: string): Promise<Receipt | undefined> {
    for (const receipt of this.state.receipts.values()) {
      // Check both new (invoiceId) and legacy (orderId) fields
      if (receipt.invoiceId === orderId || receipt.orderId === orderId) {
        return receipt;
      }
    }
    return undefined;
  }

  // =============================
  // Refunds
  // =============================

  /**
   * Request refund for an order
   *
   * @param orderId - Order identifier
   * @param amount - Amount to refund
   * @param reason - Refund reason
   * @returns Refund request
   */
  async requestRefund(
    orderId: string,
    amount: Price,
    reason: string,
  ): Promise<RefundRequest> {
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== "fulfilled") {
      throw new Error(`Order is not fulfilled: ${order.status}`);
    }

    const refund: RefundRequest = {
      refundId: this._generateRefundId(),
      orderId,
      amount,
      reason,
      status: "pending",
      requestedAt: Date.now(),
    };

    this.state.refunds.set(refund.refundId, refund);
    await this._saveState();

    Debug.log(`Refund requested: ${refund.refundId}`, "Booth");

    return refund;
  }

  /**
   * Process a refund
   *
   * @param refundId - Refund identifier
   * @param approved - Whether refund is approved
   */
  async processRefund(refundId: string, approved: boolean): Promise<void> {
    const refund = this.state.refunds.get(refundId);
    if (!refund) {
      throw new Error(`Refund not found: ${refundId}`);
    }

    if (approved) {
      // Find payment for this order
      let payment: Payment | undefined;
      for (const p of this.state.payments.values()) {
        if (p.orderId === refund.orderId) {
          payment = p;
          break;
        }
      }

      if (payment) {
        const provider = this.paymentProviders.get(payment.method);
        if (provider) {
          // Process refund with provider
          await provider.refundPayment(
            payment.paymentId,
            refund.amount,
            refund.reason,
          );

          payment.status = "refunded";
          this.state.payments.set(payment.paymentId, payment);
        }
      }

      refund.status = "completed";

      // Update order status
      const order = this.state.orders.get(refund.orderId);
      if (order) {
        order.status = "refunded";
        this.state.orders.set(order.orderId, order);
      }
    } else {
      refund.status = "rejected";
    }

    refund.processedAt = Date.now();
    this.state.refunds.set(refundId, refund);
    await this._saveState();

    Debug.log(
      `Refund ${approved ? "approved" : "rejected"}: ${refundId}`,
      "Booth",
    );
  }

  // =============================
  // Analytics
  // =============================

  /**
   * Get sales analytics for a time period
   *
   * @param startTime - Start timestamp
   * @param endTime - End timestamp
   * @returns Sales analytics
   */
  async getSalesAnalytics(
    startTime: number,
    endTime: number,
  ): Promise<SalesAnalytics> {
    const orders = Array.from(this.state.orders.values()).filter(
      (order) => order.createdAt >= startTime && order.createdAt <= endTime,
    );

    const ordersByStatus: Record<OrderStatus, number> = {
      pending: 0,
      paid: 0,
      confirmed: 0,
      fulfilled: 0,
      cancelled: 0,
      refunded: 0,
      failed: 0,
    };

    let totalRevenue = 0;
    const currency = orders[0]?.price.currency || "USD";

    for (const order of orders) {
      ordersByStatus[order.status]++;
      if (order.status === "fulfilled") {
        totalRevenue += order.price.amount;
      }
    }

    return {
      totalOrders: orders.length,
      totalRevenue: {
        amount: totalRevenue,
        currency,
      },
      ordersByStatus,
      topItems: [], // TODO: Implement item-level tracking
      period: {
        start: startTime,
        end: endTime,
      },
    };
  }

  // =============================
  // State Management
  // =============================

  protected async _loadState(): Promise<void> {
    const savedState = await this.storage.getItem(this.stateKey);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      this.state = {
        orders: new Map(parsed.orders || []),
        payments: new Map(parsed.payments || []),
        receipts: new Map(parsed.receipts || []),
        inventory: new Map(parsed.inventory || []),
        refunds: new Map(parsed.refunds || []),
      };
    } else {
      this.state = {
        orders: new Map(),
        payments: new Map(),
        receipts: new Map(),
        inventory: new Map(),
        refunds: new Map(),
      };
      await this._saveState();
    }
  }

  protected async _saveState(): Promise<void> {
    const serialized = {
      orders: Array.from(this.state.orders.entries()),
      payments: Array.from(this.state.payments.entries()),
      receipts: Array.from(this.state.receipts.entries()),
      inventory: Array.from(this.state.inventory.entries()),
      refunds: Array.from(this.state.refunds.entries()),
    };
    await this.storage.setItem(this.stateKey, JSON.stringify(serialized));
  }

  // =============================
  // Utility Methods
  // =============================

  protected _generateOrderId(): string {
    return `order-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  protected _generatePaymentId(): string {
    return `pay-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  protected _generateRefundId(): string {
    return `refund-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  /**
   * Get state (for debugging/inspection)
   */
  public getState(): BoothState {
    return this.state;
  }
}
