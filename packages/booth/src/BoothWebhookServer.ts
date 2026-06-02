import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createSecureServer } from "node:https";
import type { Server } from "node:http";
import type { BoothPaymentWebhookEvent } from "./PaymentAdapterInterface.js";

export interface BoothWebhookRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  bodyJson?: unknown;
  raw: IncomingMessage;
}

export interface BoothWebhookResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
}

export type BoothWebhookHandler = (
  request: BoothWebhookRequest,
) => Promise<BoothWebhookResponse | BoothPaymentWebhookEvent | void>;

export interface BoothWebhookRoute {
  path: string;
  methods?: string[];
  handler: BoothWebhookHandler;
}

export interface BoothWebhookServerConfig {
  host?: string;
  port: number;
  routes?: BoothWebhookRoute[];
  maxBodyBytes?: number;
  /** Optional TLS material. If omitted, a plain HTTP server is created. */
  tls?: {
    key: string | Buffer;
    cert: string | Buffer;
  };
}

/**
 * Tiny optional webhook server for Booth payment providers.
 *
 * Production deployments can also use Express/Hono/Fastify/etc. directly and
 * call booth.confirmInvoice() from their existing webhook routes. This helper is
 * for SDK users who want a batteries-included Node server without extra deps.
 */
export class BoothWebhookServer {
  private readonly routes = new Map<string, BoothWebhookRoute>();
  private readonly maxBodyBytes: number;
  private server?: Server;

  constructor(private readonly config: BoothWebhookServerConfig) {
    this.maxBodyBytes = config.maxBodyBytes ?? 1024 * 1024;
    for (const route of config.routes ?? []) {
      this.addRoute(route);
    }
  }

  addRoute(route: BoothWebhookRoute): void {
    this.routes.set(route.path, route);
  }

  async start(): Promise<{ host: string; port: number; url: string }> {
    if (this.server) {
      return this.address();
    }

    this.server = this.config.tls
      ? createSecureServer(this.config.tls, this.handle.bind(this))
      : createServer(this.handle.bind(this));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.config.port, this.config.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });

    return this.address();
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private address(): { host: string; port: number; url: string } {
    const addr = this.server?.address();
    const port =
      typeof addr === "object" && addr ? addr.port : this.config.port;
    const host = this.config.host ?? "127.0.0.1";
    const scheme = this.config.tls ? "https" : "http";
    return { host, port, url: `${scheme}://${host}:${port}` };
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const route = this.routes.get(url.pathname);
      const method = req.method ?? "GET";

      if (!route) {
        this.send(res, {
          status: 404,
          body: { error: "Webhook route not found" },
        });
        return;
      }

      const allowed = route.methods ?? ["POST"];
      if (!allowed.includes(method)) {
        this.send(res, { status: 405, body: { error: "Method not allowed" } });
        return;
      }

      const bodyText = await this.readBody(req);
      let bodyJson: unknown | undefined;
      const contentType = req.headers["content-type"] ?? "";
      if (bodyText && String(contentType).includes("application/json")) {
        bodyJson = JSON.parse(bodyText);
      }

      const result = await route.handler({
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        bodyText,
        bodyJson,
        raw: req,
      });

      if (!result) {
        this.send(res, { status: 200, body: { ok: true } });
        return;
      }

      if ("body" in result || "status" in result || "headers" in result) {
        this.send(res, result as BoothWebhookResponse);
        return;
      }

      this.send(res, {
        status: 200,
        body: { ok: true, event: result as Record<string, unknown> },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook failed";
      this.send(res, { status: 500, body: { error: message } });
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > this.maxBodyBytes) {
          reject(new Error("Webhook body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("error", reject);
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  private send(res: ServerResponse, response: BoothWebhookResponse): void {
    const status = response.status ?? 200;
    const body = response.body ?? { ok: status >= 200 && status < 300 };
    const text = typeof body === "string" ? body : JSON.stringify(body);

    res.statusCode = status;
    res.setHeader(
      "content-type",
      typeof body === "string" ? "text/plain" : "application/json",
    );
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      res.setHeader(key, value);
    }
    res.end(text);
  }
}

export function createBoothWebhookServer(
  config: BoothWebhookServerConfig,
): BoothWebhookServer {
  return new BoothWebhookServer(config);
}
