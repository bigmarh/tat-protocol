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
import { StorageInterface } from "@tat-protocol/storage";
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

const Debug = DebugLogger.getInstance();

/**
 * Booth Agent configuration (spec-compliant)
 */
export interface BoothAgentConfig extends NWPCConfig {
  storage: StorageInterface;
  forgePubkey?: string; // Optional - if provided, acts as authorized Booth
  boothName: string;
  fee: number; // Fee rate (0.025 = 2.5%)
  supportedPaymentMethods?: string[];
}

/**
 * Booth Agent State
 */
interface BoothAgentState {
  catalog: Map<string, CatalogItem>; // catalogItemId -> item
  invoices: Map<string, Invoice>; // invoiceId -> invoice
  receipts: Map<string, Receipt>; // receiptId -> receipt
  forgeAuthorizations: Map<string, ForgeAuthorization>; // eventId -> authorization
}

/**
 * BoothAgent - Spec-compliant Booth implementation
 *
 * A Booth is an Agent (Nostr account) that sells TATs and handles payments.
 *
 * Implements TAT Protocol Extensions specification section 4 (Booth Protocol)
 * with NWPC methods:
 * - booth.catalog
 * - booth.invoice
 * - booth.pay
 * - booth.status
 *
 * Agents communicate via NWPC (Nostr Wrapped Procedure Calls) over encrypted DMs.
 *
 * @example
 * ```typescript
 * const booth = await BoothAgent.create({
 *   storage: new NodeStorage({ path: './booth' }),
 *   keys: myKeys,
 *   boothName: 'TATpay',
 *   fee: 0.025, // 2.5%
 *   relays: ['wss://relay.damus.io']
 * });
 *
 * // Booth is now an Agent responding to booth.* NWPC methods
 * ```
 */
export class BoothAgent {
  protected config: BoothAgentConfig;
  protected storage: StorageInterface;
  protected state!: BoothAgentState;
  protected isInitialized: boolean = false;
  protected stateKey: string = "";
  private nwpcServer: NWPCServer;
  /** Cached public key resolved from signer or keys */
  private resolvedPubkey: string = "";
  private forgeClient?: NWPCPeer;
  private forgeClientReady?: Promise<void>;

  constructor(config: BoothAgentConfig) {
    if (!config.storage) {
      throw new Error("Storage is required");
    }

    this.config = config;
    this.storage = config.storage;

    // Create NWPC server (this makes us an Agent)
    this.nwpcServer = new NWPCServer(config);

    // Setup spec-compliant handlers
    this.setupHandlers();
  }

  /**
   * Create and initialize BoothAgent
   */
  static async create(config: BoothAgentConfig): Promise<BoothAgent> {
    const booth = new BoothAgent(config);
    await booth.nwpcServer.init();
    await booth.initialize();
    Debug.log("BoothAgent initialized", "Booth");
    return booth;
  }

  /**
   * Initialize the Booth Agent
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Resolve and cache public key from signer or keys
    this.resolvedPubkey = (await this.resolvePublicKey()) || "default";
    this.stateKey = `booth-spec-${this.resolvedPubkey}`;
    await this._loadState();
    this.isInitialized = true;
  }

  /**
   * Resolve public key from signer or keys (async, called during init)
   */
  private async resolvePublicKey(): Promise<string | undefined> {
    // Try signer first (from config)
    if (this.config.signer) {
      return await this.config.signer.getPublicKey();
    }
    // Fall back to NWPC public key
    return this.nwpcServer.getPublicKey();
  }

  /**
   * Get Booth Agent public key (sync, uses cached value)
   */
  public getPublicKey(): string {
    return this.resolvedPubkey;
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

      // Booth info (this Agent's info)
      const boothInfo: BoothInfo = {
        pubkey: this.resolvedPubkey,
        name: this.config.boothName,
        fee: this.config.fee,
      };

      return res.send(
        {
          booth: boothInfo,
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
      const paymentOptions = await this.buildPaymentOptions(
        catalogItem,
        quantity,
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
   * Build payment options for invoice
   */
  private async buildPaymentOptions(
    catalogItem: CatalogItem,
    quantity: number,
  ): Promise<PaymentOptions> {
    const totalAmount = catalogItem.price.amount * quantity;
    const options: PaymentOptions = {};

    if (this.config.supportedPaymentMethods?.includes("tat")) {
      options.tat = {
        amount: catalogItem.tokenType === "FUNGIBLE" ? totalAmount : undefined,
        payTo: this.resolvedPubkey,
        issuer: catalogItem.issuer,
        tokenType: catalogItem.tokenType,
      };
    }

    // Add other payment methods based on configuration
    if (this.config.supportedPaymentMethods?.includes("lightning")) {
      options.lightning = {
        bolt11: "lnbc...", // TODO: Generate Lightning invoice
        amountSats: Math.floor(totalAmount / 100),
      };
    }

    if (this.config.supportedPaymentMethods?.includes("card")) {
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
            token.payload.P2PKlock !== this.resolvedPubkey
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
            method: "tat",
            grossAmount: invoice.catalogItem.price.amount,
            currency: invoice.catalogItem.price.currency,
            fees: {
              boxOffice: invoice.catalogItem.price.amount * this.config.fee,
              platform: 0,
              payment: 0,
            },
            netToCreator:
              invoice.catalogItem.price.amount * (1 - this.config.fee),
          },
          tat: {
            tokenID: "placeholder",
            tokenHash: "placeholder",
          },
          buyer: buyerPubkey,
          boxOffice: this.resolvedPubkey,
        };

        return {
          success: true,
          tat: "placeholder-tat-jwt",
          receipt,
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

  async addCatalogItem(item: CatalogItem): Promise<void> {
    this.state.catalog.set(item.id, item);
    await this._saveState();
    Debug.log(`Catalog item added: ${item.id}`, "Booth");
  }

  async removeCatalogItem(itemId: string): Promise<void> {
    this.state.catalog.delete(itemId);
    await this._saveState();
    Debug.log(`Catalog item removed: ${itemId}`, "Booth");
  }

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
   * Get NWPC server (this Agent's communication layer)
   */
  public getServer(): NWPCServer {
    return this.nwpcServer;
  }
}
