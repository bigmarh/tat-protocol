import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCConfig,
} from "@tat-protocol/nwpc";
// import { Token, TokenType } from "@tat-protocol/token";
import { DebugLogger } from "@tat-protocol/utils";

// Local error codes (aligned with PROTOCOL_SPEC.md 1000/2000/3000 series)
// TODO: Import from @tat-protocol/nwpc once package is rebuilt
const NWPC_ERRORS = {
  INVALID_PARAMS: { code: 1003, message: "Invalid Params" },
  NOT_FOUND: { code: 1005, message: "Not Found" },
  UNAUTHORIZED: { code: 2004, message: "Unauthorized" },
  INTERNAL_ERROR: { code: 3000, message: "Internal Error" },
} as const;
import { BoothBase, BoothConfig } from "./BoothBase";
import {
  TokenOrder,
  // OrderStatus,
  Receipt,
  // Payment,
  // PaymentMethod,
} from "./types";

const Debug = DebugLogger.getInstance();

/**
 * Boxoffice Server configuration
 */
export interface BoothServerConfig extends BoothConfig, NWPCConfig {
  forgePubkey: string; // Associated forge public key
  autoFulfill?: boolean; // Automatically fulfill orders after payment (default: true)
}

/**
 * BoothServer - NWPC-based implementation of Boxoffice protocol
 *
 * This class provides a network-enabled boxoffice that handles purchase
 * requests over NWPC (Nostr Wrapped Procedure Calls). Clients can:
 * - Browse inventory
 * - Create orders
 * - Make payments
 * - Receive tokens
 *
 * The server integrates with a Forge to mint tokens after payment confirmation.
 *
 * @example
 * ```typescript
 * const boxoffice = await BoothServer.create({
 *   storage: new NodeStorage({ path: './boxoffice' }),
 *   keys: myKeys,
 *   forgePubkey: forgePublicKey,
 *   relays: ['wss://relay.damus.io'],
 *   paymentProviders: [bitcoinProvider, stripeProvider],
 *   pricingEngine: myPricingEngine
 * });
 *
 * // Boxoffice is now listening for purchase requests
 * ```
 */
export class BoothServer extends BoothBase {
  private nwpcServer: NWPCServer;
  // private autoFulfill: boolean;

  constructor(config: BoothServerConfig) {
    super(config);

    if (!config.forgePubkey) {
      throw new Error("Forge public key is required");
    }

    // this.autoFulfill = config.autoFulfill ?? true;

    // Create NWPC server
    this.nwpcServer = new NWPCServer(config);

    // Setup request handlers
    this.setupHandlers();
  }

  /**
   * Create and initialize a BoothServer instance
   *
   * @param config - Boxoffice server configuration
   * @returns Initialized boxoffice server
   */
  static async create(config: BoothServerConfig): Promise<BoothServer> {
    const boxoffice = new BoothServer(config);
    await boxoffice.nwpcServer.init();
    await boxoffice.initialize();
    Debug.log("BoothServer created and initialized", "Booth");
    return boxoffice;
  }

  /**
   * Setup NWPC request handlers
   */
  private setupHandlers(): void {
    // Get inventory list
    this.nwpcServer.use("getInventory", this.handleGetInventory.bind(this));

    // Get specific item
    this.nwpcServer.use("getItem", this.handleGetItem.bind(this));

    // Create order
    this.nwpcServer.use("createOrder", this.handleCreateOrder.bind(this));

    // Get order status
    this.nwpcServer.use("getOrder", this.handleGetOrder.bind(this));

    // Initialize payment
    this.nwpcServer.use(
      "initializePayment",
      this.handleInitializePayment.bind(this),
    );

    // Verify payment
    this.nwpcServer.use("verifyPayment", this.handleVerifyPayment.bind(this));

    // Get receipt
    this.nwpcServer.use("getReceipt", this.handleGetReceipt.bind(this));

    // Cancel order
    this.nwpcServer.use("cancelOrder", this.handleCancelOrder.bind(this));

    // Request refund
    this.nwpcServer.use("requestRefund", this.handleRequestRefund.bind(this));
  }

  // =============================
  // NWPC Request Handlers
  // =============================

  /**
   * Handle get inventory request
   */
  private async handleGetInventory(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { activeOnly = true } = JSON.parse(req.params || "{}");
      const inventory = await this.listInventory(activeOnly);

      return res.send(
        {
          inventory: inventory.map((item) => ({
            itemId: item.itemId,
            name: item.name,
            description: item.description,
            price: item.price,
            available: item.available,
            metadata: item.metadata,
          })),
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle get item request
   */
  private async handleGetItem(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { itemId } = JSON.parse(req.params);

      if (!itemId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Item ID is required",
        );
      }

      const item = await this.getInventoryItem(itemId);

      if (!item) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Item not found");
      }

      return res.send({ item }, context.sender);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle create order request
   */
  private async handleCreateOrder(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const orderData = JSON.parse(req.params);

      // Set buyer from context
      orderData.buyer = context.sender;

      // Create order
      const order = await this.createOrder(orderData);

      return res.send(
        {
          order: {
            orderId: order.orderId,
            status: order.status,
            price: order.price,
            createdAt: order.createdAt,
          },
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INVALID_PARAMS.code, message);
    }
  }

  /**
   * Handle get order request
   */
  private async handleGetOrder(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { orderId } = JSON.parse(req.params);

      if (!orderId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Order ID is required",
        );
      }

      const order = await this.getOrder(orderId);

      if (!order) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Order not found");
      }

      // Verify buyer
      if (order.buyer !== context.sender) {
        return res.error(NWPC_ERRORS.UNAUTHORIZED.code, "Unauthorized");
      }

      return res.send({ order }, context.sender);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle initialize payment request
   */
  private async handleInitializePayment(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { orderId } = JSON.parse(req.params);

      if (!orderId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Order ID is required",
        );
      }

      const order = await this.getOrder(orderId);

      if (!order) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Order not found");
      }

      // Verify buyer
      if (order.buyer !== context.sender) {
        return res.error(NWPC_ERRORS.UNAUTHORIZED.code, "Unauthorized");
      }

      const paymentInit = await this.initializePayment(orderId);

      return res.send(
        {
          payment: {
            paymentId: paymentInit.payment.paymentId,
            paymentUrl: paymentInit.paymentUrl,
            paymentAddress: paymentInit.paymentAddress,
            amount: paymentInit.payment.amount,
            expiresAt: paymentInit.expiresAt,
          },
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle verify payment request
   */
  private async handleVerifyPayment(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { paymentId } = JSON.parse(req.params);

      if (!paymentId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Payment ID is required",
        );
      }

      const result = await this.verifyPayment(paymentId);

      return res.send(
        {
          verified: result.verified,
          status: result.status,
          completedAt: result.completedAt,
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle get receipt request
   */
  private async handleGetReceipt(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { orderId } = JSON.parse(req.params);

      if (!orderId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Order ID is required",
        );
      }

      const receipt = await this.getReceiptByOrderId(orderId);

      if (!receipt) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Receipt not found");
      }

      // Verify buyer
      if (receipt.buyer !== context.sender) {
        return res.error(NWPC_ERRORS.UNAUTHORIZED.code, "Unauthorized");
      }

      return res.send({ receipt }, context.sender);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  /**
   * Handle cancel order request
   */
  private async handleCancelOrder(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { orderId, reason } = JSON.parse(req.params);

      if (!orderId) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Order ID is required",
        );
      }

      const order = await this.getOrder(orderId);

      if (!order) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Order not found");
      }

      // Verify buyer
      if (order.buyer !== context.sender) {
        return res.error(NWPC_ERRORS.UNAUTHORIZED.code, "Unauthorized");
      }

      await this.cancelOrder(orderId, reason);

      return res.send({ success: true }, context.sender);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INVALID_PARAMS.code, message);
    }
  }

  /**
   * Handle refund request
   */
  private async handleRequestRefund(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const { orderId, amount, reason } = JSON.parse(req.params);

      if (!orderId || !reason) {
        return res.error(
          NWPC_ERRORS.INVALID_PARAMS.code,
          "Order ID and reason are required",
        );
      }

      const order = await this.getOrder(orderId);

      if (!order) {
        return res.error(NWPC_ERRORS.NOT_FOUND.code, "Order not found");
      }

      // Verify buyer
      if (order.buyer !== context.sender) {
        return res.error(NWPC_ERRORS.UNAUTHORIZED.code, "Unauthorized");
      }

      const refund = await this.requestRefund(
        orderId,
        amount || order.price,
        reason,
      );

      return res.send(
        {
          refund: {
            refundId: refund.refundId,
            status: refund.status,
            requestedAt: refund.requestedAt,
          },
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_ERRORS.INVALID_PARAMS.code, message);
    }
  }

  // =============================
  // Abstract Method Implementations
  // =============================

  /**
   * Validate order before creation
   *
   * Checks inventory availability and order constraints.
   */
  protected async validateOrder(order: Partial<TokenOrder>): Promise<boolean> {
    // Basic validation
    if (!order.buyer || !order.buyerAddress) {
      throw new Error("Buyer and buyer address are required");
    }

    if (!order.quantity && !order.tokenIDs) {
      throw new Error("Quantity or token IDs must be specified");
    }

    // TODO: Add inventory checks, supply limits, etc.

    return true;
  }

  /**
   * Fulfill order by minting tokens
   *
   * This is a placeholder - in production, this should integrate
   * with a Forge to actually mint and deliver tokens.
   */
  protected async fulfillOrder(order: TokenOrder): Promise<Receipt> {
    Debug.log(`Fulfilling order: ${order.orderId}`, "Booth");

    // Find the payment for this order
    let orderPayment;
    for (const payment of this.state.payments.values()) {
      if (payment.orderId === order.orderId) {
        orderPayment = payment;
        break;
      }
    }

    const timestamp = Date.now();

    // TODO: Integration with Forge to mint tokens
    // For now, create a placeholder receipt using new spec-aligned structure
    const receipt: Receipt = {
      // New spec-aligned fields
      id: `receipt-${order.orderId}`,
      invoiceId: order.orderId,
      timestamp,

      item: {
        id: order.orderId,
        name: order.tokenType === "FUNGIBLE" ? "Fungible Tokens" : "TAT",
        issuer: order.forgePubkey,
      },

      payment: {
        method: order.paymentMethod,
        grossAmount: order.price.amount,
        currency: order.price.currency,
        fees: {
          boxOffice: 0,
          platform: 0,
          payment: 0,
        },
        netToCreator: order.price.amount,
      },

      tat: {
        tokenID: order.tokenIDs?.[0] || `token-${order.orderId}`,
        tokenHash: "", // Placeholder - should be actual token hash
      },

      buyer: order.buyer,
      boxOffice: this.getPublicKey() || "",

      // Legacy fields for backward compatibility
      tokens: [], // Placeholder - should contain actual token JWTs
      metadata: {
        note: "Token minting not yet implemented - integrate with Forge",
        originalPayment: orderPayment,
      },
      receiptId: `receipt-${order.orderId}`,
      orderId: order.orderId,
      issuedAt: timestamp,
    };

    // In production, this would be something like:
    // const tokens = await this.forge.mint({
    //   tokenType: order.tokenType,
    //   recipient: order.buyerAddress,
    //   quantity: order.quantity,
    //   tokenIDs: order.tokenIDs,
    //   payload: order.tokenPayload
    // });
    // receipt.tokens = tokens;

    return receipt;
  }

  // =============================
  // Public API
  // =============================

  /**
   * Get NWPC server instance
   *
   * Useful for accessing the underlying server for advanced use cases.
   */
  public getServer(): NWPCServer {
    return this.nwpcServer;
  }

  /**
   * Get boxoffice public key
   *
   * Returns the public key of the boxoffice (same as NWPC server key).
   */
  public getPublicKey(): string | undefined {
    return this.nwpcServer.getPublicKey();
  }
}
