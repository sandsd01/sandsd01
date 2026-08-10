# Inventory Manager

Basic stock management system with two roles — **admin** and **staff**. Includes a point-of-sale (POS) checkout flow and per-branch stock tracking across multiple locations.

- **admin**: manage products, manage users, record stock movements, view everything
- **staff**: view products, record stock in/out movements, view movement history, ring up sales at their home location

## Stack

- **Backend**: Node.js + Express 5, Prisma ORM + SQLite (`@prisma/adapter-better-sqlite3`), JWT auth
- **Frontend**: React + Vite SPA (`web/`), React Router
- **Tests**: `node:test` + Supertest against a dedicated SQLite test database
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — runs backend tests and builds the frontend on every push/PR

## Setup

```bash
npm install                 # installs deps and generates the Prisma client (postinstall)
cp .env.example .env        # set JWT_SECRET to a real random value for anything beyond local dev
npx prisma migrate deploy   # create dev.db and apply migrations
npm run seed                # creates the initial admin user (admin@example.com / changeme123 by default)
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
npm test            # migrates test.db and runs the full backend test suite (node:test)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Run the API once (production-style) |
| `npm run dev` | Run the API with auto-restart on file changes |
| `npm test` | Migrate `test.db` and run backend tests |
| `npm run prisma:migrate` | Create/apply a new dev migration |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run seed` | Create the initial admin user in `dev.db` |

## API overview

All endpoints except `/health` and `/auth/login` require `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | Log in, returns `{ token, user }`. Locks the account for 15 minutes after 5 consecutive failed attempts (`423`) |
| POST | `/auth/logout` | any | No-op; client discards the token |
| PATCH | `/auth/password` | any | Change your own password (`{ currentPassword, newPassword }`) |
| POST | `/auth/forgot-password` | — | `{ email }` — always returns a generic success message; emails a reset link if the account exists |
| POST | `/auth/reset-password` | — | `{ email, token, newPassword }` — token expires after 30 minutes and is single-use |
| GET | `/products?search=&category=&page=&pageSize=&sortBy=&sortDir=` | any | Paginated, non-deleted product list — filter by SKU/name/category, sort by `name`\|`sku`\|`quantity`\|`reorderLevel`\|`category` |
| GET | `/products/categories` | any | Distinct list of product categories in use |
| GET | `/products/trash` | admin | List soft-deleted products |
| GET | `/products/export` | any | Download products as CSV (respects `?search=`/`?category=`) |
| POST | `/products/import` | admin | Bulk create/update products from CSV (`{ csv }`); upserts by SKU, never touches `quantity` |
| POST | `/products/bulk-delete` | admin | Soft-delete multiple products (`{ ids: [...] }`) |
| POST | `/products/bulk-category` | admin | Set category on multiple products (`{ ids: [...], category }`) |
| GET | `/products/lookup?code=` | any | Find one product by exact SKU or barcode match (used by the barcode-scan quick lookup) |
| GET | `/products/:id/modifier-groups` | any | List a product's modifier groups (POS options like size/topping), each with its options |
| POST | `/products/:id/modifier-groups` | admin | Add a modifier group to a product (`{ name, selectionType: "single"\|"multiple", required?, sortOrder? }`) |
| PATCH | `/products/modifier-groups/:groupId` | admin | Update a modifier group |
| DELETE | `/products/modifier-groups/:groupId` | admin | Delete a modifier group (cascades its options) |
| POST | `/products/modifier-groups/:groupId/options` | admin | Add an option to a modifier group (`{ name, priceDelta?, sortOrder? }`) |
| PATCH | `/products/modifier-options/:optionId` | admin | Update a modifier option |
| DELETE | `/products/modifier-options/:optionId` | admin | Delete a modifier option |
| GET | `/products/:id` | any | Get one product (excludes soft-deleted) |
| GET | `/products/:id/qrcode` | any | A 256x256 PNG QR code encoding the product's barcode (or SKU if it has none), for printing a scannable label |
| POST | `/products` | admin | Create a product (`category`, `supplierId`, `unitCost`, `sellingPrice`, `barcode` optional) |
| PATCH | `/products/:id` | admin | Update a product (same optional fields as create, including `sellingPrice`) |
| DELETE | `/products/:id` | admin | Soft-delete a product (recoverable via `/restore`) |
| POST | `/products/:id/restore` | admin | Restore a soft-deleted product |
| DELETE | `/products/:id/permanent` | admin | Permanently delete a soft-deleted product and its movement history (must already be in Trash) |
| POST | `/products/:id/image` | admin | Upload a product image (multipart, field `image`; jpg/png/webp/gif, 5MB max) |
| GET | `/products/:id/movements` | any | List stock movement history (includes each movement's `location`, if any) |
| GET | `/products/:id/movements/by-location` | any | Net quantity (in − out) for this product, grouped by location |
| GET | `/products/:id/movements/export` | any | Download a product's movement history as CSV |
| POST | `/products/:id/movements` | admin, staff | Record a stock in/out movement (updates `Product.quantity`; `locationId` optional, and when given also updates that branch's `LocationStock`) |
| DELETE | `/products/:id/movements/:movementId` | admin | Delete a movement, reversing its effect on `Product.quantity` (and that movement's `LocationStock`, if it was location-tagged) |
| GET | `/suppliers` | any | List suppliers |
| POST | `/suppliers` | admin | Create a supplier |
| PATCH | `/suppliers/:id` | admin | Update a supplier |
| DELETE | `/suppliers/:id` | admin | Delete a supplier (unlinks it from any products; rejected with `409` if it has purchase orders) |
| GET | `/purchase-orders?status=&supplierId=&page=&pageSize=` | any | Paginated purchase order list, newest first |
| GET | `/purchase-orders/:id` | any | Get one purchase order with its line items |
| POST | `/purchase-orders` | admin | Create a draft PO (`{ supplierId, notes?, items: [{ productId, quantityOrdered, unitCost? }] }`) |
| PATCH | `/purchase-orders/:id` | admin | Update a draft PO's supplier/notes/items (items are replaced wholesale); `400` once it's no longer a draft |
| DELETE | `/purchase-orders/:id` | admin | Delete a draft PO; `400` once it's no longer a draft |
| POST | `/purchase-orders/:id/mark-ordered` | admin | Draft → ordered (requires at least one item) |
| POST | `/purchase-orders/:id/cancel` | admin | Draft or ordered → cancelled (once anything has been received, it can no longer be cancelled) |
| POST | `/purchase-orders/:id/receive` | admin | Record receipt of stock (`{ items: [{ itemId, quantity }], locationId? }`); creates a stock-in movement per line, updates `Product.quantity`, and advances the PO to `partially_received` or `received` |
| GET | `/locations` | any | List locations (branches), including `address`/`phone`/`isActive` |
| GET | `/locations/:id/stock` | any | Per-branch stock levels — each non-deleted product's `LocationStock` quantity at this location |
| POST | `/locations` | admin | Create a location (`address`, `phone`, `isActive` optional) |
| PATCH | `/locations/:id` | admin | Update a location's name/address/phone/isActive |
| DELETE | `/locations/:id` | admin | Delete a location (rejected with `409` if any movement has been recorded against it, or if it still has `LocationStock` with quantity > 0) |
| POST | `/sales` | admin, staff | Checkout — `{ locationId, items: [{ productId, quantity, modifierOptionIds? }], paymentMethod: "cash"\|"promptpay"\|"card", amountTendered?, note? }`; prices each line as `sellingPrice + Σ priceDelta`, then decrements stock (company-wide `Product.quantity` and that branch's `LocationStock`) |
| GET | `/sales?locationId=&from=&to=&status=&page=&pageSize=` | admin, staff | Paginated sale list, newest first; staff are auto-scoped to their own `homeLocationId` |
| GET | `/sales/:id` | admin, staff | Get one sale with its items and modifiers |
| GET | `/sales/:id/receipt` | admin, staff | Download the sale as a PDF receipt |
| POST | `/sales/:id/void` | admin | Void a completed sale (`{ reason }`); restocks each item via an `in` movement at the sale's location |
| GET | `/reports/summary` | any | Product/quantity/value/low-stock counts and the 10 most recent movements |
| GET | `/reports/summary/pdf` | any | The summary above as a downloadable PDF |
| GET | `/reports/movements-timeseries?days=` | any | Daily in/out totals for the last N days (default 30) |
| GET | `/reports/activity-log?page=&pageSize=` | admin | Paginated audit log (who did what, when) |
| GET | `/reports/sales-summary?locationId=&from=&to=` | any | Total revenue/sale count, revenue-by-location breakdown, and top 10 products by revenue; staff are auto-scoped to their `homeLocationId` (and don't get a by-location breakdown, since it's just their one branch) |
| POST | `/reports/send-low-stock-alert` | admin | Manually send the low-stock alert email now |
| POST | `/reports/send-daily-summary` | admin | Manually send the daily summary email now |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create a user (`homeLocationId` optional) |
| PATCH | `/users/:id` | admin | Update a user's email/password/role/homeLocationId |
| DELETE | `/users/:id` | admin | Delete a user |

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
- **Point of sale (POS) & multi-branch stock**: the `/pos` page lets a cashier pick a location, add products (with optional size/topping modifiers, each with a `priceDelta`) to a cart, and check out (`POST /sales`) with cash/PromptPay/card. Checkout prices each line as `sellingPrice + Σ priceDelta`, and decrements both the company-wide `Product.quantity` and the sold branch's `LocationStock` in one transaction — a branch can't sell more than its own recorded `LocationStock`, even if the company-wide total would otherwise cover it. Sales are listed/viewed at `/sales`, can be downloaded as a PDF receipt, and voided by an admin (`POST /sales/:id/void`), which restocks both figures. Staff are scoped to their `homeLocationId` (`User.homeLocationId`) for the sales list, sale detail, and sales-summary report; admins see everything. Reports gains a `GET /reports/sales-summary` (revenue, sale count, revenue by location, top products).
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
