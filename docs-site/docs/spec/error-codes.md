# Error Codes

NWPC uses structured error codes organized into three series.

## Error response format

```json
{
  "error": {
    "code": 2003,
    "message": "Insufficient balance",
    "params": "optional additional data"
  },
  "id": "request-id",
  "ver": "1.0.0"
}
```

## 1000 series — Request errors

Errors related to parsing, routing, and request validation.

| Code | Name | Description |
|------|------|-------------|
| 1000 | Parse Error | Invalid JSON or malformed message format |
| 1001 | Invalid Request | Missing required fields in the request |
| 1002 | Method Not Found | No handler registered for the requested method |
| 1003 | Invalid Params | Parameter validation failed (wrong type, missing field) |
| 1004 | Rate Limited | Too many requests within the configured time window |
| 1005 | Not Found | The requested resource does not exist |

## 2000 series — Token errors

Errors related to token validation, authorization, and spending.

| Code | Name | Description |
|------|------|-------------|
| 2000 | Token Invalid | Token signature or format is invalid |
| 2001 | Token Expired | Token has passed its `exp` timestamp |
| 2002 | Token Spent | Token has already been spent (double-spend attempt) |
| 2003 | Insufficient Balance | Not enough tokens to complete the transfer or payment |
| 2004 | Unauthorized | Signature verification failed or sender is not authorized |
| 2005 | Supply Limit | Minting would exceed the Forge's `totalSupply` cap |
| 2006 | Token Required | A token is required for this method but was not provided |
| 2007 | Insufficient Scope | Token lacks the required scope for this operation |
| 2008 | Token Wrong Audience | Token is bound to a different server (audience mismatch) |
| 2009 | Token Wrong Issuer | Token was issued by an untrusted or incorrect issuer |

## 3000 series — Server errors

Internal server-side errors.

| Code | Name | Description |
|------|------|-------------|
| 3000 | Internal Error | Server-side processing error |

## Usage in handlers

The `NWPCResponseObject` provides convenience methods for common errors:

```ts
// Specific error code
await res.error(2003, "Insufficient balance");

// Convenience methods
await res.badRequest("Missing 'to' field");     // 1001
await res.notFound("Token not found");           // 1005
await res.unauthorized("Invalid signature");     // 2004
await res.internalError("Database unavailable"); // 3000
```

## Handling errors in clients

```ts
const response = await pocket.sendTx("transfer", issuer, tx);

if (response.error) {
  switch (response.error.code) {
    case 2002:
      console.error("Token already spent");
      break;
    case 2003:
      console.error("Insufficient balance");
      break;
    default:
      console.error(`Error ${response.error.code}: ${response.error.message}`);
  }
}
```
