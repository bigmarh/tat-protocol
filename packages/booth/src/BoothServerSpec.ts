import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCConfig,
} from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger } from "@tat-protocol/utils";
import { randomBytes } from "crypto";
// import { BoothBase, BoothConfig } from "./BoothBase";
import {
  CatalogItem,
  Receipt,
  Invoice,
  // InvoiceStatus,
  PaymentOptions,
  PaymentSubmission,
  BoothInfo,
  // ForgeMintRequest,
  ForgeAuthorization,
} from "./spec-types";
import { StorageInterface } from "@tat-protocol/storage";

const Debug = DebugLogger.getInstance();

/**
 * Boxoffice Server configuration (spec-compliant)
 */
export interface BoothServerSpecConfig extends NWPCConfig {
  storage: StorageInterface;
  forgePubkey?: string; // Optional - if provided, acts as authorized Booth
  boxOfficeName: string;
  fee: number; // Fee rate (0.025 = 2.5%)
  supportedPaymentMethods?: string[];
}

/**
 * Boxoffice Server State
 */
interface BoothServerState {
  catalog: Map<string, CatalogItem>; // catalogItemId -> item
  invoices: Map<string, Invoice>; // invoiceId -> invoice
  receipts: Map<string, Receipt>; // receiptId -> receipt
  forgeAuthorizations: Map<string, ForgeAuthorization>; // eventId -> authorization
}

/**
 * BoothServerSpec - Spec-compliant NWPC implementation
 *
 * Implements a Booth Agent (a type of Agent in TAT Protocol).
 * Implements TAT Protocol Extensions specification section 4 (Booth Protocol)
 * with NWPC methods:
 * - booth.catalog
 * - booth.invoice
 * - booth.pay
 * - booth.status
 *
 * @example
 * ```typescript
 * const boxoffice = await BoothServerSpec.create({
 *   storage: new NodeStorage({ path: './boxoffice' }),
 *   keys: myKeys,
 *   boxOfficeName: 'TATpay',
 *   fee: 0.025, // 2.5%
 *   relays: ['wss://relay.damus.io']
 * });
 * ```
 */
export class BoothServerSpec {
  protected config: BoothServerSpecConfig;
  protected storage: StorageInterface;
  protected state!: BoothServerState;
  protected isInitialized: boolean = false;
  protected stateKey: string = "";
  private nwpcServer: NWPCServer;

  constructor(config: BoothServerSpecConfig) {
    if (!config.storage) {
      throw new Error("Storage is required");
    }

    this.config = config;
    this.storage = config.storage;

    // Create NWPC server
    this.nwpcServer = new NWPCServer(config);

    // Setup spec-compliant handlers
    this.setupHandlers();
  }

  /**
   * Create and initialize BoothServerSpec
   */
  static async create(
    config: BoothServerSpecConfig
  ): Promise<BoothServerSpec> {
    const boxoffice = new BoothServerSpec(config);
    await boxoffice.nwpcServer.init();
    await boxoffice.initialize();
    Debug.log("BoothServerSpec initialized", "Booth");
    return boxoffice;
  }

  /**
   * Initialize the server
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.stateKey = `boxoffice-spec-${this.nwpcServer.getPublicKey() || "default"}`;
    await this._loadState();
    this.isInitialized = true;
  }

  /**
   * Setup NWPC request handlers per spec
   */
  private setupHandlers(): void {
    // booth.catalog (spec 4.4.1)
    this.nwpcServer.use("booth.catalog", this.handleCatalog.bind(this));

    // booth.invoice (spec 4.4.2)
    this.nwpcServer.use("booth.invoice", this.handleInvoice.bind(this));

    // booth.pay (spec 4.4.3)
    this.nwpcServer.use("booth.pay", this.handlePay.bind(this));

    // booth.status (spec 4.4.4)
    this.nwpcServer.use("booth.status", this.handleStatus.bind(this));
  }

  // =============================
  // NWPC Handlers (Per Spec)
  // =============================

  /**
   * Handle booth.catalog request (spec 4.4.1)
   */
  private async handleCatalog(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject
  ): Promise<NWPCResponse | void> {
    try {
      const params = req.params ? JSON.parse(req.params) : {};
      const { issuer, category, limit = 50, offset = 0 } = params;

      // Filter catalog
      let items = Array.from(this.state.catalog.values());

      if (issuer) {
        items = items.filter((item) => item.issuer === issuer);
      }

      if (category) {
        items = items.filter((item) => item.metadata?.category === category);
      }

      // Paginate
      const total = items.length;
      items = items.slice(offset, offset + limit);

      // Booth info
      const boxOfficeInfo: BoothInfo = {
        pubkey: this.nwpcServer.getPublicKey() || "",
        name: this.config.boxOfficeName,
        fee: this.config.fee,
      };

      return res.send(
        {
          boxOffice: boxOfficeInfo,
          items,
          total,
          offset,
        },
        context.sender
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(1000, message);
    }
  }

  /**
   * Handle booth.invoice request (spec 4.4.2)
   */
  private async handleInvoice(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject
  ): Promise<NWPCResponse | void> {
    try {
      const params = JSON.parse(req.params);
      const { catalogItemId, buyerPubkey, quantity = 1 } = params;

      // Get catalog item
      const catalogItem = this.state.catalog.get(catalogItemId);
      if (!catalogItem) {
        return res.error(3000, "Catalog item not found");
      }

      // Check supply
      if (
        catalogItem.supply &&
        catalogItem.supply.remaining < quantity
      ) {
        return res.error(4001, "Insufficient supply");
      }

      // Create invoice
      const invoiceId = this._generateInvoiceId();
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

      // Build payment options
      const paymentOptions = await this.buildPaymentOptions(
        catalogItem,
        quantity
      );

      const invoice: Invoice = {
        invoiceId,
        catalogItem,
        expiresAt,
        paymentOptions,
        status: "pending",
        createdAt: Date.now(),
        buyerPubkey,
      };

      this.state.invoices.set(invoiceId, invoice);
      await this._saveState();

      return res.send(
        {
          invoiceId,
          catalogItem,
          expiresAt,
          paymentOptions,
        },
        context.sender
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(1000, message);
    }
  }

  /**
   * Handle booth.pay request (spec 4.4.3)
   */
  private async handlePay(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject
  ): Promise<NWPCResponse | void> {
    try {
      const params = JSON.parse(req.params);
      const { invoiceId, payment } = params as {
        invoiceId: string;
        payment: PaymentSubmission;
      };

      // Get invoice
      const invoice = this.state.invoices.get(invoiceId);
      if (!invoice) {
        return res.error(3000, "Invoice not found");
      }

      // Check expiry
      if (Date.now() > invoice.expiresAt) {
        invoice.status = "expired";
        this.state.invoices.set(invoiceId, invoice);
        await this._saveState();
        return res.error(4002, "Invoice expired");
      }

      // Check already paid
      if (invoice.status === "paid") {
        // Return existing receipt
        const receipt = Array.from(this.state.receipts.values()).find(
          (r) => r.invoiceId === invoiceId
        );
        if (receipt) {
          return res.send(
            {
              success: true,
              receipt,
            },
            context.sender
          );
        }
      }

      // Process payment
      const result = await this.processPayment(invoice, payment, context.sender);

      if (!result.success) {
        return res.error(4000, result.error || "Payment failed");
      }

      // Update invoice
      invoice.status = "paid";
      invoice.paidAt = Date.now();
      this.state.invoices.set(invoiceId, invoice);

      // Store receipt
      if (result.receipt) {
        this.state.receipts.set(result.receipt.id, result.receipt);
      }

      await this._saveState();

      return res.send(
        {
          success: true,
          tat: result.tat,
          receipt: result.receipt,
        },
        context.sender
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(5000, message);
    }
  }

  /**
   * Handle booth.status request (spec 4.4.4)
   */
  private async handleStatus(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject
  ): Promise<NWPCResponse | void> {
    try {
      const params = JSON.parse(req.params);
      const { invoiceId } = params;

      const invoice = this.state.invoices.get(invoiceId);
      if (!invoice) {
        return res.error(3000, "Invoice not found");
      }

      // Find receipt if paid
      let receipt: Receipt | undefined;
      let tat: string | undefined;

      if (invoice.status === "paid") {
        receipt = Array.from(this.state.receipts.values()).find(
          (r) => r.invoiceId === invoiceId
        );
        // TODO: Retrieve TAT JWT from receipt or storage
      }

      return res.send(
        {
          invoiceId,
          status: invoice.status,
          tat,
          receipt,
          expiresAt: invoice.expiresAt,
        },
        context.sender
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(5000, message);
    }
  }

  // =============================
  // Helper Methods
  // =============================

  /**
   * Build payment options for invoice
   */
  private async buildPaymentOptions(
    catalogItem: CatalogItem,
    quantity: number
  ): Promise<PaymentOptions> {
    const totalAmount = catalogItem.price.amount * quantity;
    const options: PaymentOptions = {};

    // TATUSD payment (always available)
    options.tatusd = {
      amount: totalAmount,
      payTo: this.nwpcServer.getPublicKey() || "",
    };

    // Add other payment methods based on configuration
    if (this.config.supportedPaymentMethods?.includes("lightning")) {
      // TODO: Generate Lightning invoice
      options.lightning = {
        bolt11: "lnbc...", // Placeholder
        amountSats: Math.floor(totalAmount / 100), // Example conversion
      };
    }

    if (this.config.supportedPaymentMethods?.includes("card")) {
      // TODO: Generate Stripe checkout URL
      options.card = {
        checkoutUrl: `https://checkout.example.com/${catalogItem.id}`,
        amount: totalAmount / 100,
        currency: "USD",
      };
    }

    return options;
  }

  /**
   * Process payment and mint TAT
   */
  private async processPayment(
    invoice: Invoice,
    payment: PaymentSubmission,
    buyerPubkey: string
  ): Promise<{
    success: boolean;
    tat?: string;
    receipt?: Receipt;
    error?: string;
  }> {
    try {
      if (payment.method === "tatusd") {
        // Verify TATUSD tokens
        const tokens = payment.tokens;
        let totalAmount = 0;

        for (const tokenJWT of tokens) {
          const token = await new Token().restore(tokenJWT);

          // Verify token is valid
          if (!(await token.validate())) {
            return { success: false, error: "Invalid TATUSD token" };
          }

          // Verify token is locked to this Booth
          if (token.payload.P2PKlock !== this.nwpcServer.getPublicKey()) {
            return { success: false, error: "Token not locked to Booth" };
          }

          totalAmount += token.payload.amount || 0;
        }

        // Verify amount matches
        const expectedAmount = invoice.catalogItem.price.amount;
        if (totalAmount < expectedAmount) {
          return { success: false, error: "Insufficient payment amount" };
        }

        // If we have a forge, request mint
        if (this.config.forgePubkey) {
          // TODO: Send mint request to Forge with TATUSD
          // For now, return placeholder
        }

        // Create receipt
        const receipt: Receipt = {
          id: this._generateReceiptId(),
          invoiceId: invoice.invoiceId,
          timestamp: Date.now(),
          item: {
            id: invoice.catalogItem.id,
            name: invoice.catalogItem.name,
            issuer: invoice.catalogItem.issuer,
          },
          payment: {
            method: "tatusd",
            grossAmount: expectedAmount,
            currency: "TATUSD",
            fees: {
              boxOffice: expectedAmount * this.config.fee,
              platform: 0,
              payment: 0,
            },
            netToCreator: expectedAmount * (1 - this.config.fee),
          },
          tat: {
            tokenID: "placeholder", // TODO: Get from minted TAT
            tokenHash: "placeholder",
          },
          buyer: buyerPubkey,
          boxOffice: this.nwpcServer.getPublicKey() || "",
        };

        return {
          success: true,
          tat: "placeholder-tat-jwt", // TODO: Return actual TAT JWT
          receipt,
        };
      }

      return { success: false, error: "Payment method not implemented" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Payment processing failed",
      };
    }
  }

  // =============================
  // Catalog Management
  // =============================

  /**
   * Add catalog item
   */
  async addCatalogItem(item: CatalogItem): Promise<void> {
    this.state.catalog.set(item.id, item);
    await this._saveState();
    Debug.log(`Catalog item added: ${item.id}`, "Booth");
  }

  /**
   * Remove catalog item
   */
  async removeCatalogItem(itemId: string): Promise<void> {
    this.state.catalog.delete(itemId);
    await this._saveState();
    Debug.log(`Catalog item removed: ${itemId}`, "Booth");
  }

  /**
   * Update catalog item
   */
  async updateCatalogItem(
    itemId: string,
    updates: Partial<CatalogItem>
  ): Promise<void> {
    const item = this.state.catalog.get(itemId);
    if (!item) {
      throw new Error(`Catalog item not found: ${itemId}`);
    }

    Object.assign(item, updates);
    this.state.catalog.set(itemId, item);
    await this._saveState();
    Debug.log(`Catalog item updated: ${itemId}`, "Booth");
  }

  // =============================
  // State Management
  // =============================

  protected async _loadState(): Promise<void> {
    const savedState = await this.storage.getItem(this.stateKey);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      this.state = {
        catalog: new Map(parsed.catalog || []),
        invoices: new Map(parsed.invoices || []),
        receipts: new Map(parsed.receipts || []),
        forgeAuthorizations: new Map(parsed.forgeAuthorizations || []),
      };
    } else {
      this.state = {
        catalog: new Map(),
        invoices: new Map(),
        receipts: new Map(),
        forgeAuthorizations: new Map(),
      };
      await this._saveState();
    }
  }

  protected async _saveState(): Promise<void> {
    const serialized = {
      catalog: Array.from(this.state.catalog.entries()),
      invoices: Array.from(this.state.invoices.entries()),
      receipts: Array.from(this.state.receipts.entries()),
      forgeAuthorizations: Array.from(this.state.forgeAuthorizations.entries()),
    };
    await this.storage.setItem(this.stateKey, JSON.stringify(serialized));
  }

  // =============================
  // Utility Methods
  // =============================

  private _generateInvoiceId(): string {
    return `inv-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  private _generateReceiptId(): string {
    return `rcpt-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  /**
   * Get NWPC server
   */
  public getServer(): NWPCServer {
    return this.nwpcServer;
  }

  /**
   * Get booth public key
   */
  public getPublicKey(): string | undefined {
    return this.nwpcServer.getPublicKey();
  }
}
