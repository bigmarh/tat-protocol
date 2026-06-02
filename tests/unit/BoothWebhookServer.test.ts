import { describe, expect, it } from "@jest/globals";
import { BoothWebhookServer } from "../../packages/booth/src/BoothWebhookServer";

describe("BoothWebhookServer", () => {
  it("serves webhook routes without external dependencies", async () => {
    const server = new BoothWebhookServer({
      port: 0,
      routes: [
        {
          path: "/webhook",
          methods: ["POST"],
          handler: async (request) => {
            expect(request.bodyJson).toEqual({ invoiceId: "inv-1" });
            return { status: 202, body: { received: true } };
          },
        },
      ],
    });

    const { url } = await server.start();
    try {
      const response = await fetch(`${url}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: "inv-1" }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ received: true });
    } finally {
      await server.stop();
    }
  });
});
