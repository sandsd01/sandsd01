# Inventory Manager

Basic stock management system with two roles — **admin** and **staff**. Includes a point-of-sale (POS) checkout flow and per-branch stock tracking across multiple locations.

- **admin**: manage products, manage users, record stock movements, view everything
- **staff**: view products, record stock in/out movements, view movement history, ring up sales at their home location

## Stack

- **Backend**: Node.js + Express 5, Prisma ORM + PostgreSQL (`@prisma/adapter-pg`), JWT auth
- **Frontend**: React + Vite SPA (`web/`), React Router
- **Tests**: `node:test` + Supertest against a dedicated PostgreSQL test database
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — runs backend tests and builds the frontend on every push/PR

## Setup

```bash
npm install                 # installs deps and generates the Prisma client (postinstall)
cp .env.example .env        # set JWT_SECRET to a real random value for anything beyond local dev
npx prisma migrate deploy   # apply migrations to the database in DATABASE_URL
npm run seed                # creates the initial admin user (admin@example.com / changeme123 by default)
npm run seed:menu           # optional: seeds 2 branches + a sample burger/fries/drinks menu with modifiers and stock
```

## Running locally

```bash
npm run dev        # backend API on http://localhost:3000 (auto-restarts on change)
```

In a second terminal:

```bash
cd web
npm install
npm run dev         # frontend on http://localhost:5173, proxies /api/* to the backend
```

Open `http://localhost:5173` and log in with the seeded admin account (or whatever `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` you set in `.env` before seeding).

## Tests

```bash
npm test            # migrates the test database and runs the full backend suite (node:test)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Run the API once (production-style) |
| `npm run dev` | Run the API with auto-restart on file changes |
| `npm test` | Migrate the test database and run backend tests (override the URL with `TEST_DATABASE_URL`) |
| `npm run prisma:migrate` | Create/apply a new dev migration |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run seed` | Create the initial admin user |
| `npm run seed:menu` | Seed 2 sample branches and a burger/fries/drinks menu (with modifiers and initial stock) — safe to re-run |
| `npm run dev:fresh` | Reset the database (`prisma migrate reset`), re-migrate, run `seed` + `seed:menu`, then start the API — a one-command reset for local testing |

## Deploying

The app ships as a single container: the API serves the built SPA from the same
origin, so there is one service and one URL to manage.

```bash
docker build -t pos .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/pos" \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  -e TRUST_PROXY=1 \
  pos
```

The container runs `prisma migrate deploy` before starting, so a fresh database
is migrated on first boot.

Required in production:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. The app refuses to start without it |
| `JWT_SECRET` | Random, 32+ characters. The app refuses to start on a missing, placeholder, or short value |
| `TRUST_PROXY` | Set to the number of proxy hops (usually `1`) behind a load balancer, so rate limiting sees real client IPs |

Strongly recommended:

| Variable | Why |
| --- | --- |
| `S3_BUCKET` + `S3_PUBLIC_BASE_URL` | Product images and branch PromptPay QR codes are otherwise written to the container filesystem and **lost on every redeploy**. Mount a persistent volume at `/app/uploads` if you'd rather not use object storage |
| `CRON_TIMEZONE` | Defaults to `Asia/Bangkok`; the daily summary fires at 8am in this zone |
| `CORS_ORIGIN` | Only needed if the frontend is hosted separately from the API |

Serve it behind TLS. The JWT lives in `localStorage` and is sent on every
request, so plain HTTP exposes it to anyone on the network path.

## API overview

All API routes are namespaced under `/api` (so client-side SPA routes like `/sales` can't collide with them). All endpoints except `/api/auth/login` require `Authorization: Bearer <token>`. `/health` (unprefixed) is available for load-balancer health checks.

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | — | Log in, returns `{ token, user }`. Locks the account for 15 minutes after 5 consecutive failed attempts (`423`) |
| GET | `/api/auth/me` | any | Your own profile (`id`, `email`, `role`, `homeLocationId`) — the POS page uses it to pin a staff cashier to their assigned branch |
| POST | `/api/auth/logout` | any | No-op; client discards the token |
| PATCH | `/api/auth/password` | any | Change your own password (`{ currentPassword, newPassword }`) |
| POST | `/api/auth/forgot-password` | — | `{ email }` — always returns a generic success message; emails a reset link if the account exists |
| POST | `/api/auth/reset-password` | — | `{ email, token, newPassword }` — token expires after 30 minutes and is single-use |
| GET | `/api/products?search=&category=&page=&pageSize=&sortBy=&sortDir=` | any | Paginated, non-deleted product list — filter by SKU/name/category, sort by `name`\|`sku`\|`quantity`\|`reorderLevel`\|`category` |
| GET | `/api/products/categories` | any | Distinct list of product categories in use |
| GET | `/api/products/trash` | admin | List soft-deleted products |
| GET | `/api/products/export` | any | Download products as CSV (respects `?search=`/`?category=`) |
| POST | `/api/products/import` | admin | Bulk create/update products from CSV (`{ csv }`); upserts by SKU, never touches `quantity` |
| POST | `/api/products/bulk-delete` | admin | Soft-delete multiple products (`{ ids: [...] }`) |
| POST | `/api/products/bulk-category` | admin | Set category on multiple products (`{ ids: [...], category }`) |
| GET | `/api/products/lookup?code=` | any | Find one product by exact SKU or barcode match (used by the barcode-scan quick lookup) |
| GET | `/api/products/:id/modifier-groups` | any | List a product's modifier groups (POS options like size/topping), each with its options |
| POST | `/api/products/:id/modifier-groups` | admin | Add a modifier group to a product (`{ name, selectionType: "single"\|"multiple", required?, sortOrder? }`) |
| PATCH | `/api/products/modifier-groups/:groupId` | admin | Update a modifier group |
| DELETE | `/api/products/modifier-groups/:groupId` | admin | Delete a modifier group (cascades its options) |
| POST | `/api/products/modifier-groups/:groupId/options` | admin | Add an option to a modifier group (`{ name, priceDelta?, sortOrder? }`) |
| PATCH | `/api/products/modifier-options/:optionId` | admin | Update a modifier option |
| DELETE | `/api/products/modifier-options/:optionId` | admin | Delete a modifier option |
| GET | `/api/products/:id` | any | Get one product (excludes soft-deleted) |
| GET | `/api/products/:id/qrcode` | any | A 256x256 PNG QR code encoding the product's barcode (or SKU if it has none), for printing a scannable label |
| POST | `/api/products` | admin | Create a product (`category`, `supplierId`, `unitCost`, `sellingPrice`, `barcode` optional) |
| PATCH | `/api/products/:id` | admin | Update a product (same optional fields as create, including `sellingPrice`) |
| DELETE | `/api/products/:id` | admin | Soft-delete a product (recoverable via `/restore`) |
| POST | `/api/products/:id/restore` | admin | Restore a soft-deleted product |
| DELETE | `/api/products/:id/permanent` | admin | Permanently delete a soft-deleted product and its movement history (must already be in Trash) |
| POST | `/api/products/:id/image` | admin | Upload a product image (multipart, field `image`; jpg/png/webp/gif, 5MB max) |
| GET | `/api/products/:id/movements` | any | List stock movement history (includes each movement's `location`, if any) |
| GET | `/api/products/:id/movements/by-location` | any | Net quantity (in − out) for this product, grouped by location |
| GET | `/api/products/:id/movements/export` | any | Download a product's movement history as CSV |
| POST | `/api/products/:id/movements` | admin, staff | Record a stock in/out movement (updates `Product.quantity`; `locationId` optional, and when given also updates that branch's `LocationStock`) |
| DELETE | `/api/products/:id/movements/:movementId` | admin | Delete a movement, reversing its effect on `Product.quantity` (and that movement's `LocationStock`, if it was location-tagged) |
| GET | `/api/suppliers` | any | List suppliers |
| POST | `/api/suppliers` | admin | Create a supplier |
| PATCH | `/api/suppliers/:id` | admin | Update a supplier |
| DELETE | `/api/suppliers/:id` | admin | Delete a supplier (unlinks it from any products; rejected with `409` if it has purchase orders) |
| GET | `/api/purchase-orders?status=&supplierId=&page=&pageSize=` | any | Paginated purchase order list, newest first |
| GET | `/api/purchase-orders/:id` | any | Get one purchase order with its line items |
| POST | `/api/purchase-orders` | admin | Create a draft PO (`{ supplierId, notes?, items: [{ productId, quantityOrdered, unitCost? }] }`) |
| PATCH | `/api/purchase-orders/:id` | admin | Update a draft PO's supplier/notes/items (items are replaced wholesale); `400` once it's no longer a draft |
| DELETE | `/api/purchase-orders/:id` | admin | Delete a draft PO; `400` once it's no longer a draft |
| POST | `/api/purchase-orders/:id/mark-ordered` | admin | Draft → ordered (requires at least one item) |
| POST | `/api/purchase-orders/:id/cancel` | admin | Draft or ordered → cancelled (once anything has been received, it can no longer be cancelled) |
| POST | `/api/purchase-orders/:id/receive` | admin | Record receipt of stock (`{ items: [{ itemId, quantity }], locationId? }`); creates a stock-in movement per line, updates `Product.quantity`, and advances the PO to `partially_received` or `received` |
| GET | `/api/locations` | any | List locations (branches), including `address`/`phone`/`isActive` |
| GET | `/api/locations/:id/stock` | any | Per-branch stock levels — each non-deleted product's `LocationStock` quantity at this location |
| POST | `/api/locations` | admin | Create a location (`address`, `phone`, `isActive` optional) |
| PATCH | `/api/locations/:id` | admin | Update a location's name/address/phone/isActive |
| DELETE | `/api/locations/:id` | admin | Delete a location (rejected with `409` if any movement has been recorded against it, or if it still has `LocationStock` with quantity > 0) |
| POST | `/api/locations/:id/promptpay-qr` | admin | Upload/replace a location's PromptPay QR image (multipart, field `qr`; jpg/png/webp/gif, 5MB max); deletes the old file on disk if one existed |
| DELETE | `/api/locations/:id/promptpay-qr` | admin | Remove a location's PromptPay QR (`400` if none is set) |
| POST | `/api/sales` | admin, staff | Checkout — `{ locationId, items: [{ productId, quantity, modifierOptionIds? }], paymentMethod: "cash"\|"promptpay"\|"card", amountTendered?, note? }`; prices each line as `sellingPrice + Σ priceDelta`, then decrements stock (company-wide `Product.quantity` and that branch's `LocationStock`). Staff with a `homeLocationId` get `403` for any other branch |
| GET | `/api/sales?locationId=&from=&to=&status=&page=&pageSize=` | admin, staff | Paginated sale list, newest first; staff are auto-scoped to their own `homeLocationId` |
| GET | `/api/sales/:id` | admin, staff | Get one sale with its items and modifiers |
| GET | `/api/settings/shop` | any | Shop VAT/tax-invoice settings (the POS and receipts read these) |
| PATCH | `/api/settings/shop` | admin | Update the shop's legal name, tax ID, address, and VAT settings |
| GET | `/api/sales/:id/receipt` | admin, staff | Download the sale as a PDF receipt |
| POST | `/api/sales/:id/void` | admin | Void a completed sale (`{ reason }`); restocks each item via an `in` movement at the sale's location |
| GET | `/api/cash-shifts?locationId=&status=&page=&pageSize=` | admin, staff | Paginated shift history, newest first, each row carrying `cashSales`/`expectedCash`/`saleCount`; staff are auto-scoped to their own `homeLocationId` |
| GET | `/api/cash-shifts/current?locationId=` | admin, staff | The branch's open shift with its running cash figures, or `null` if the drawer isn't open (staff's own branch is used, `locationId` ignored) |
| POST | `/api/cash-shifts/open` | admin, staff | Open a drawer — `{ locationId, openingFloat, note? }`; `409` if the branch already has one open, `403` for a staff member's other branch |
| POST | `/api/cash-shifts/:id/close` | admin, staff | Close the drawer — `{ countedCash, note? }`; stores `countedCash` and the resulting `variance` (`400` if already closed) |
| GET | `/api/reports/summary` | any | Product/quantity/value/low-stock counts and the 10 most recent movements |
| GET | `/api/reports/summary/pdf` | any | The summary above as a downloadable PDF |
| GET | `/api/reports/movements-timeseries?days=` | any | Daily in/out totals for the last N days (default 30) |
| GET | `/api/reports/activity-log?page=&pageSize=` | admin | Paginated audit log (who did what, when) |
| GET | `/api/reports/sales-summary?locationId=&from=&to=` | any | Total revenue/sale count, revenue-by-location breakdown, and top 10 products by revenue; staff are auto-scoped to their `homeLocationId` (and don't get a by-location breakdown, since it's just their one branch) |
| POST | `/api/reports/send-low-stock-alert` | admin | Manually send the low-stock alert email now |
| POST | `/api/reports/send-daily-summary` | admin | Manually send the daily summary email now |
| GET | `/api/users` | admin | List users |
| POST | `/api/users` | admin | Create a user (`homeLocationId` optional) |
| PATCH | `/api/users/:id` | admin | Update a user's email/password/role/homeLocationId |
| DELETE | `/api/users/:id` | admin | Delete a user |

### Low-stock and daily summary email alerts

Set `RESEND_API_KEY` and `ALERT_EMAIL_TO` in `.env` (see `.env.example`) to enable email alerts via [Resend](https://resend.com). When configured:
- A low-stock alert fires automatically the moment a stock-out movement takes a product from above its reorder level to at-or-below it, and admins can also trigger one on demand from the Reports page.
- A daily summary email sends on the schedule in `DAILY_SUMMARY_CRON` (default 8am server time), and can also be triggered on demand.

Without those env vars set, both kinds of alert are silently skipped (logged, not an error).

### Other notable features

- **Stock valuation**: products can have an optional `unitCost`; Reports shows total inventory value (`quantity * unitCost` summed across products) alongside unit counts.
- **Password reset**: "Forgot password?" on the login page emails a link via Resend (no-ops if unconfigured, same as the other alerts) that expires in 30 minutes; the frontend auto-logs-out and redirects to `/login` if any authenticated request comes back `401` (e.g. an expired JWT).
- **Soft delete**: deleting a product just sets `deletedAt`; it disappears from normal views but can be restored from Trash (admin), or permanently purged (along with its movement history) from the Trash page.
- **Rate limiting**: all `/api/*` requests are limited to 300 per 15 minutes per IP; `/auth/login` and `/auth/forgot-password` are limited further to 20 per 15 minutes per IP (disabled when `NODE_ENV=test`).
- **Purchase orders**: admins can raise a draft PO against a supplier, mark it as ordered, and record receipt of stock (fully or in installments) — each receipt creates a normal stock-in movement, so `Product.quantity` and the audit trail stay consistent with manually recorded movements. A supplier with purchase orders can't be deleted, and a product referenced by one can't be permanently purged from Trash.
- **Locations & barcodes**: admins manage a list of locations (warehouses/branches, with optional `address`/`phone` and an `isActive` flag); any stock movement (manual or from a PO receipt) can optionally be tagged with one, and a product's movement history page shows a net-quantity breakdown by location. Locations also carry a real per-branch stock partition, `LocationStock` (see POS below) — recording a movement without a `locationId` behaves exactly as before and only touches the company-wide `Product.quantity`. Products can also have an optional unique `barcode`; the Products page has a scan-or-type lookup box (built for handheld barcode scanners, which act as keyboards) that jumps straight to a matched product's movements page, and each product's edit page shows a printable QR code encoding its barcode (or SKU if it has none).
- **Point of sale (POS) & multi-branch stock**: the `/pos` page lets a cashier pick a location, add products (with optional size/topping modifiers, each with a `priceDelta`) to a cart, and check out (`POST /sales`) with cash/PromptPay/card. Checkout prices each line as `sellingPrice + Σ priceDelta`, and decrements both the company-wide `Product.quantity` and the sold branch's `LocationStock` in one transaction — a branch can't sell more than its own recorded `LocationStock`, even if the company-wide total would otherwise cover it. Sales are listed/viewed at `/sales`, can be downloaded as a PDF receipt, and voided by an admin (`POST /sales/:id/void`), which restocks both figures. Staff are scoped to their `homeLocationId` (`User.homeLocationId`) for the sales list, sale detail, and sales-summary report; admins see everything. Reports gains a `GET /reports/sales-summary` (revenue, sale count, revenue by location, top products). Each branch can have an admin-uploaded PromptPay QR image (`Location.promptPayQrUrl`, managed from the Locations page); when a cashier selects "PromptPay" as the payment method on `/pos`, that branch's QR is shown at a scannable size (or a "no QR configured" message if none was uploaded) — it's a real bank-issued QR image the admin uploads, not a generated/decoded PromptPay payload, and checkout can still be completed regardless, same as cash/card.
- **Cash shift / drawer reconciliation**: `/shifts` lets a cashier open the till with a counted `openingFloat` and close it at the end of the day with the cash actually in the drawer. Every sale rung up while a shift is open is attached to it (`Sale.cashShiftId`), so closing compares `countedCash` against `openingFloat + cash sales` and stores the difference as `variance` — negative means the drawer is short. Only cash sales count toward it: card and PromptPay money never reaches the till. One branch can have at most one open shift, staff are pinned to their own branch for opening, closing, and history, and both open and close are written to the audit log. Trading still works with no shift open — those sales simply aren't reconciled (`cashShiftId` stays `null`).
- **Audit log**: product/user/supplier create-update-delete and stock movement create/delete are recorded to `AuditLog`, viewable on the Activity Log page (admin).
- **Product images**: uploaded files are stored on disk under `uploads/` (gitignored) and served at `/uploads/<filename>`.
- **Account lockout**: 5 consecutive failed login attempts locks the account for 15 minutes.
- **UI language**: the frontend nav has an EN/ไทย toggle (`web/src/i18n/translations.js`) that translates UI chrome (labels, headings, buttons) — not API error messages or user-entered data.

## Project structure

```
prisma/          Schema, migrations, seed script, Prisma client wrapper
src/
  app.js         Express app (routes + middleware); serves /uploads statically
  server.js      Entry point (reads env, starts listening, schedules the daily summary cron)
  middleware/    JWT auth + role-check middleware
  lib/csv.js     CSV serialize/parse helpers used by the export/import endpoints
  lib/email.js   Low-stock alert + daily summary emails via Resend (no-ops if unconfigured)
  lib/pdf.js     Summary report + sale receipt PDF generation (pdfkit)
  lib/audit.js   Writes AuditLog rows for the activity log
  lib/upload.js  Multer config for product image uploads
  lib/stock.js   applyStockMovement() — shared Product.quantity + LocationStock update, used by movements and sales
  routes/        auth, products, users, reports, suppliers, purchaseOrders, locations, sales
uploads/         Uploaded product images (gitignored)
tests/           node:test + Supertest suite (backend)
web/             React (Vite) frontend SPA
  src/i18n/      EN/ไทย translation dictionary
  src/context/   AuthContext, LanguageContext
.claude/agents/  Claude Code subagent pipeline (see CLAUDE.md)
```
