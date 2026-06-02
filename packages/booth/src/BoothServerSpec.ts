import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCConfig,
} from "@tat-protocol/nwpc";
import { NWPCPeer } from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger } from "@tat-protocol/utils";
import { randomBytes } from "crypto";
// import { BoothBase, BoothConfig } from "./BoothBase.js";
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
} from "./spec-types.js";
import type {
  BoothPaymentAdapter,
  BoothPaymentReference,
} from "./PaymentAdapterInterface.js";
import type {
  BoothFulfillmentHandler,
  BoothFulfillmentResult,
} from "./FulfillmentInterface.js";
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
  /** External payment adapters used to build invoice payment options. */
  paymentAdapters?: BoothPaymentAdapter[];
  /** Called after payment confirmation to mint/deliver the purchased token(s). */
  fulfill?: BoothFulfillmentHandler;
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
  private forgeClient?: NWPCPeer;
  private forgeClientReady?: Promise<void>;

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
  static async create(config: BoothServerSpecConfig): Promise<BoothServerSpec> {
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
    res: NWPCResponseObject,
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
        context.sender,
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
    res: NWPCResponseObject,
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
      if (catalogItem.supply && catalogItem.supply.remaining < quantity) {
        return res.error(4001, "Insufficient supply");
      }

      // Create invoice
      const invoiceId = this._generateInvoiceId();
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

      // Build payment options
      const { paymentOptions, paymentReferences } =
        await this.buildPaymentOptionsAndReferences(
          catalogItem,
          quantity,
          invoiceId,
          buyerPubkey,
          expiresAt,
        );

      const invoice: Invoice = {
        invoiceId,
        catalogItem,
        expiresAt,
        paymentOptions,
        status: "pending",
        createdAt: Date.now(),
        buyerPubkey,
        quantity,
        paymentReferences,
        fulfillment: { status: "pending" },
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
        context.sender,
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
    res: NWPCResponseObject,
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
          (r) => r.invoiceId === invoiceId,
        );
        if (receipt) {
          return res.send(
            {
              success: true,
              receipt,
            },
            context.sender,
          );
        }
      }

      // Process payment
      const result = await this.processPayment(
        invoice,
        payment,
        context.sender,
      );

      if (!result.success) {
        return res.error(4000, result.error || "Payment failed");
      }

      // Update invoice
      invoice.status = "paid";
      invoice.paidAt = Date.now();
      this.state.invoices.set(invoiceId, invoice);

      // Store receipt and fulfillment state
      if (result.receipt) {
        this.state.receipts.set(result.receipt.id, result.receipt);
        invoice.fulfillment = {
          status: "fulfilled",
          receiptId: result.receipt.id,
          fulfilledAt: Date.now(),
          token: result.tat,
        };
        this.state.invoices.set(invoiceId, invoice);
      }

      await this._saveState();

      return res.send(
        {
          success: true,
          tat: result.tat,
          receipt: result.receipt,
        },
        context.sender,
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
    res: NWPCResponseObject,
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
          (r) => r.invoiceId === invoiceId,
        );
        tat = invoice.fulfillment?.token;
      }

      return res.send(
        {
          invoiceId,
          status: invoice.status,
          tat,
          receipt,
          expiresAt: invoice.expiresAt,
        },
        context.sender,
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
   * Build payment options for invoice and persist provider references.
   */
  private async buildPaymentOptionsAndReferences(
    catalogItem: CatalogItem,
    quantity: number,
    invoiceId: string,
    buyerPubkey: string,
    expiresAt: number,
  ): Promise<{
    paymentOptions: PaymentOptions;
    paymentReferences?: Record<string, BoothPaymentReference>;
  }> {
    const totalAmount = catalogItem.price.amount * quantity;
    const paymentOptions: PaymentOptions = {};
    const paymentReferences: Record<string, BoothPaymentReference> = {};
    const boothPubkey = this.nwpcServer.getPublicKey() || "";

    if (this.config.supportedPaymentMethods?.includes("tat")) {
      paymentOptions.tat = {
        amount: catalogItem.tokenType === "FUNGIBLE" ? totalAmount : undefined,
        payTo: boothPubkey,
        issuer: catalogItem.issuer,
        tokenType: catalogItem.tokenType,
      };
    }

    for (const adapter of this.config.paymentAdapters ?? []) {
      const created = await adapter.createPayment({
        invoiceId,
        catalogItem,
        buyerPubkey,
        quantity,
        totalAmount,
        currency: catalogItem.price.currency,
        boothPubkey,
        expiresAt,
      });
      Object.assign(paymentOptions, created.paymentOptions);
      if (created.reference) {
        paymentReferences[adapter.method] = created.reference;
      }
    }

    return {
      paymentOptions,
      paymentReferences:
        Object.keys(paymentReferences).length > 0
          ? paymentReferences
          : undefined,
    };
  }

  /**
   * @deprecated Use buildPaymentOptionsAndReferences. Kept for subclasses/tests.
   */
  protected async buildPaymentOptions(
    catalogItem: CatalogItem,
    quantity: number,
  ): Promise<PaymentOptions> {
    return (
      await this.buildPaymentOptionsAndReferences(
        catalogItem,
        quantity,
        this._generateInvoiceId(),
        "",
        Date.now() + 30 * 60 * 1000,
      )
    ).paymentOptions;
  }

  /**
   * Process payment and mint TAT
   */
  private async processPayment(
    invoice: Invoice,
    payment: PaymentSubmission,
    buyerPubkey: string,
  ): Promise<{
    success: boolean;
    tat?: string;
    receipt?: Receipt;
    error?: string;
  }> {
    try {
      if (payment.method === "tat") {
        const tokens = payment.tokens;
        if (!tokens?.length) {
          return { success: false, error: "No tokens provided" };
        }

        let totalAmount = 0;
        const tokenHashes: string[] = [];
        for (const tokenJWT of tokens) {
          const token = await new Token().restore(tokenJWT);

          if (!(await token.validate())) {
            return { success: false, error: "Invalid token" };
          }

          if (token.payload.iss !== invoice.catalogItem.issuer) {
            return { success: false, error: "Token issuer mismatch" };
          }

          if (token.header.typ !== invoice.catalogItem.tokenType) {
            return { success: false, error: "Token type mismatch" };
          }

          if (
            token.payload.P2PKlock &&
            token.payload.P2PKlock !== this.nwpcServer.getPublicKey()
          ) {
            return { success: false, error: "Token not locked to Booth" };
          }

          if (invoice.catalogItem.tokenType === "FUNGIBLE") {
            const amount = token.payload.amount;
            if (typeof amount !== "number" || amount <= 0) {
              return { success: false, error: "Invalid token amount" };
            }
            totalAmount += amount;
          } else if (!token.payload.tokenID) {
            return { success: false, error: "Missing tokenID" };
          }

          tokenHashes.push(token.header.token_hash);
        }

        const spentTokens = await this.verifyTokensNotSpent(
          Array.from(new Set(tokenHashes)),
          invoice.catalogItem.issuer,
        );
        if (spentTokens.length > 0) {
          return { success: false, error: "Token already spent" };
        }

        if (invoice.catalogItem.tokenType === "FUNGIBLE") {
          const expectedAmount = invoice.catalogItem.price.amount;
          if (totalAmount < expectedAmount) {
            return { success: false, error: "Insufficient payment amount" };
          }
        }

        const fulfillment = await this.fulfillInvoice(
          invoice,
          buyerPubkey,
          "tat",
          {
            tokens,
            tokenHashes,
            amount: totalAmount,
          },
        );

        return {
          success: true,
          tat: fulfillment.tat,
          receipt: fulfillment.receipt,
        };
      }

      if (payment.method === "lightning") {
        return { success: false, error: "Lightning payments not implemented" };
      }

      if (payment.method === "card") {
        return { success: false, error: "Card payments not implemented" };
      }

      return { success: false, error: "Payment method not implemented" };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Payment processing failed",
      };
    }
  }

  /**
   * Confirm an externally-paid invoice from a webhook or custom payment flow.
   * Idempotent: if the invoice is already fulfilled, the existing receipt is
   * returned and fulfillment is not run again.
   */
  public async confirmInvoice(
    invoiceId: string,
    payment: {
      method: string;
      provider?: string;
      providerPaymentId?: string;
      amount?: number;
      currency?: string;
      details?: Record<string, unknown>;
    },
  ): Promise<{
    success: boolean;
    invoice?: Invoice;
    tat?: string;
    receipt?: Receipt;
    error?: string;
  }> {
    const invoice = this.state.invoices.get(invoiceId);
    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    const existingReceipt = Array.from(this.state.receipts.values()).find(
      (receipt) => receipt.invoiceId === invoiceId,
    );
    if (invoice.fulfillment?.status === "fulfilled" && existingReceipt) {
      return {
        success: true,
        invoice,
        tat: invoice.fulfillment.token,
        receipt: existingReceipt,
      };
    }

    if (Date.now() > invoice.expiresAt && invoice.status !== "paid") {
      invoice.status = "expired";
      this.state.invoices.set(invoiceId, invoice);
      await this._saveState();
      return { success: false, invoice, error: "Invoice expired" };
    }

    invoice.status = "paid";
    invoice.paidAt = invoice.paidAt ?? Date.now();
    invoice.paymentReferences = {
      ...(invoice.paymentReferences ?? {}),
      [payment.method]: {
        method: payment.method,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        status: "completed",
        data: payment.details,
      },
    };
    this.state.invoices.set(invoiceId, invoice);
    await this._saveState();

    try {
      const fulfillment = await this.fulfillInvoice(
        invoice,
        invoice.buyerPubkey,
        payment.method,
        payment.details,
        payment.provider,
        payment.providerPaymentId,
        payment.amount,
        payment.currency,
      );

      if (fulfillment.receipt) {
        this.state.receipts.set(fulfillment.receipt.id, fulfillment.receipt);
      }
      invoice.fulfillment = {
        status: "fulfilled",
        receiptId: fulfillment.receipt?.id,
        fulfilledAt: Date.now(),
        token: fulfillment.tat,
        tokens: fulfillment.tokens,
      };
      this.state.invoices.set(invoiceId, invoice);
      await this._saveState();

      return {
        success: true,
        invoice,
        tat: fulfillment.tat,
        receipt: fulfillment.receipt,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Fulfillment failed";
      invoice.fulfillment = { status: "failed", error: message };
      this.state.invoices.set(invoiceId, invoice);
      await this._saveState();
      return { success: false, invoice, error: message };
    }
  }

  private async fulfillInvoice(
    invoice: Invoice,
    buyerPubkey: string,
    method: string,
    details?: Record<string, unknown>,
    provider?: string,
    providerPaymentId?: string,
    amount = invoice.catalogItem.price.amount * (invoice.quantity ?? 1),
    currency = invoice.catalogItem.price.currency,
  ): Promise<BoothFulfillmentResult & { receipt: Receipt }> {
    const context = {
      invoice,
      buyerPubkey,
      boothPubkey: this.nwpcServer.getPublicKey() || "",
      payment: {
        method,
        provider,
        providerPaymentId,
        amount,
        currency,
        details,
      },
    };

    const result = this.config.fulfill
      ? await this.config.fulfill(context)
      : ({
          tat: undefined,
          tokenID: invoice.catalogItem.id,
          tokenHash: invoice.invoiceId,
        } satisfies BoothFulfillmentResult);

    const receipt =
      result.receipt ??
      this.createStandardReceipt(
        invoice,
        buyerPubkey,
        method,
        result,
        amount,
        currency,
      );

    return { ...result, receipt };
  }

  private createStandardReceipt(
    invoice: Invoice,
    buyerPubkey: string,
    method: string,
    fulfillment: BoothFulfillmentResult,
    amount: number,
    currency: string,
  ): Receipt {
    const grossAmount = amount;
    return {
      id: this._generateReceiptId(),
      invoiceId: invoice.invoiceId,
      timestamp: Date.now(),
      item: {
        id: invoice.catalogItem.id,
        name: invoice.catalogItem.name,
        issuer: invoice.catalogItem.issuer,
      },
      payment: {
        method,
        grossAmount,
        currency,
        fees: {
          boxOffice: grossAmount * this.config.fee,
          platform: 0,
          payment: 0,
        },
        netToCreator: grossAmount * (1 - this.config.fee),
      },
      tat: {
        tokenID: fulfillment.tokenID ?? invoice.catalogItem.id,
        tokenHash:
          fulfillment.tokenHash ??
          fulfillment.tat ??
          fulfillment.tokens?.[0] ??
          invoice.invoiceId,
      },
      buyer: buyerPubkey,
      boxOffice: this.nwpcServer.getPublicKey() || "",
    };
  }

  private async verifyTokensNotSpent(
    tokenHashes: string[],
    forgePubkey: string,
  ): Promise<string[]> {
    if (!forgePubkey) {
      throw new Error("Missing forge public key for verification");
    }
    if (!tokenHashes.length) return [];
    const client = await this.getForgeClient();
    const response = await client.request(
      "verify",
      { token_hashes: tokenHashes },
      forgePubkey,
    );
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as {
      spent?: Record<string, boolean>;
    };
    const spent = tokenHashes.filter((hash) => result?.spent?.[hash]);
    return spent;
  }

  private async getForgeClient(): Promise<NWPCPeer> {
    if (!this.forgeClient) {
      this.forgeClient = new NWPCPeer({
        ...this.config,
        storage: this.storage,
      });
      this.forgeClientReady = this.forgeClient.init();
    }
    if (this.forgeClientReady) {
      await this.forgeClientReady;
    }
    return this.forgeClient;
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
    updates: Partial<CatalogItem>,
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
