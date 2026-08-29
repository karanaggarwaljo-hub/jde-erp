# Adaptive Skill Platform integration

Jai Durga ERP exposes a narrow, server-to-server, read-only projection for the Adaptive Skill
Platform. It does not expose the generic `/api/local/[table]` routes, accept browser sessions, or
permit mutations.

## Base URL and endpoints

Configure the platform base URL as the ERP deployment origin plus `/api/integration/`:

```text
ERP_ADAPTER_BASE_URL=https://erp.example.com/api/integration/
```

The platform then calls:

- `GET /api/integration/v1/inventory/balance`
- `GET /api/integration/v1/inventory/movements`
- `GET /api/integration/v1/procurement/purchase-orders`

Every call requires `Authorization: Bearer <ERP_INTEGRATION_TOKEN>`, `X-Correlation-ID`, and the
query parameters `organizationId`, `productId`, `warehouseId`, `from`, and `to`. Date ranges are
limited to 366 days and result sets to 5,000 records. Responses are uncached JSON and carry the
correlation ID back to the caller.

## Required configuration

Set these as server-side deployment secrets or environment values; never commit real values:

```text
ERP_INTEGRATION_TOKEN=<at-least-32-random-characters>
ERP_INTEGRATION_WAREHOUSE_ID=default
ERP_INTEGRATION_UNIT_OF_MEASURE=EA
```

`ERP_INTEGRATION_PREVIOUS_TOKEN` is optional during rotation. Remove it after the platform has
switched to the new token. Generate a token with Node.js, for example:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The same current token is configured as `ERP_ADAPTER_TOKEN` in the Adaptive Skill Platform.
`jde_companies` is the live company registry: after the ERP successfully creates a company, its ID
can be used by the platform immediately without changing an environment variable or redeploying.
Every inventory and purchasing query still matches that company ID together with the requested
product ID, so records from different companies cannot be mixed. Missing or short secrets disable
the API with `503`.

## Data projection

| Contract value | Jai Durga ERP source |
|---|---|
| On-hand/available balance | Sum of `jde_stock_layers.qty_remaining`, reconciled against `jde_products.current_stock` |
| Reserved balance | `0`; the ERP has no separate reservation ledger |
| Purchase receipts | FIFO stock layers carrying `source_po_id` |
| Manual stock increases/opening stock | FIFO stock layers without `source_po_id`, reported as adjustments |
| Sales issues | `jde_invoice_items`, dated by their invoice |
| Sales returns | `jde_sales_return_items`, reported as positive adjustments |
| Supplier returns | `jde_purchase_return_items`, reported as negative adjustments |
| Open/received purchase quantity | `jde_po_items` plus `jde_stock_layers.qty_original` by source PO |

All quantities are emitted as base-10 strings so the platform can use exact decimal arithmetic.
Every record includes a stable `jde-erp://...` source URI for citations and audit trails. If the
denormalized product balance differs from the FIFO ledger, the balance endpoint returns `409`
instead of sending a value that may be wrong.

## Deliberate boundaries

- The ERP currently has no warehouse table. All stock is exposed through the one configured
  virtual warehouse ID; callers cannot invent a second warehouse.
- The integration token is intentionally deployment-wide. Protect and rotate it as a server-only
  secret; tenant isolation is enforced by the authenticated platform principal and the ERP's
  company-scoped database queries.
- The ERP currently has no separate reservation quantity. Draft invoices already reduce
  `current_stock`, so reserved remains zero and available equals audited on-hand stock.
- Historical manual stock decreases were not stored as standalone event rows by the existing ERP.
  They cannot be reconstructed honestly and are therefore absent from historical movements. The
  current balance remains protected by FIFO reconciliation.
- Non-received purchase orders created before this integration may use legacy status names. Known
  names are normalized; an unknown status returns `409` for operator correction rather than being
  guessed.

## Verification

Run the repository checks before deploying:

```bash
npm run check
```

After deploying with real Supabase and integration secrets, reconcile one known product by calling
all three endpoints and comparing the balance, movements, and purchase quantities with the ERP UI.
The production release is not complete until that live reconciliation succeeds.
