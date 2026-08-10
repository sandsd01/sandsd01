# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An inventory/stock management system with two roles, admin and staff, including a POS checkout flow and per-branch (`Location`) stock partitioning. See `README.md` for setup, the API endpoint table, and available scripts.

- **Backend**: Node.js + Express 5 (`src/`), Prisma ORM + SQLite via `@prisma/adapter-better-sqlite3` (`prisma/`)
- **Frontend**: React + Vite SPA (`web/`)
- **Auth**: JWT (`Authorization: Bearer <token>`), role-based authorization (`admin`/`staff`) enforced in backend middleware — never rely on the frontend to hide unauthorized actions, it's UX-only there
- **Tests**: `node:test` + Supertest (`tests/`) against a dedicated SQLite test database

## Commands

```bash
npm install                 # also runs `prisma generate` via postinstall
npx prisma migrate deploy   # create/update dev.db from prisma/migrations
npm run seed                # seed the initial admin user into dev.db
npm run dev                 # run the backend with auto-restart (http://localhost:3000)
npm test                    # migrate test.db, then run the full backend test suite
```

To run a single backend test file: `DATABASE_URL="file:./test.db" JWT_SECRET="test-secret" NODE_ENV="test" node --test tests/products.test.js` (run `npm run test:migrate` first if `test.db` doesn't exist yet).

Frontend (`cd web` first):

```bash
npm install
npm run dev     # http://localhost:5173, proxies /api/* to the backend
npm run build   # production build, also run in CI
```

## Architecture

- `src/app.js` wires up Express routes and middleware; `src/server.js` is the actual process entry point (reads env, calls `app.listen`) — tests import `app.js` directly and never start a real listener.
- `src/middleware/auth.js`: `authenticate` verifies the JWT and attaches `req.user`; `requireRole(...roles)` 403s if `req.user.role` isn't in the allowed list. Apply `authenticate` (and `requireRole` where needed) at the top of each router with `router.use(...)`.
- `prisma/client.js` is the single shared Prisma Client instance (constructed with the better-sqlite3 driver adapter reading `DATABASE_URL`) — routes and scripts require this rather than instantiating their own client.
- `src/lib/stock.js#applyStockMovement(tx, { productId, locationId, type, quantity, note, createdById })` is the single place `Product.quantity` and (when a `locationId` is given) that branch's `LocationStock` change together — it creates the `StockMovement` row and updates both in one call, and must be invoked inside a `prisma.$transaction`. It's shared by `POST /products/:id/movements` and the `/sales` checkout/void routes. An `out` movement is rejected (via `InsufficientStockError`, surfaced as 400) if it would take either the company-wide `Product.quantity` negative or — when scoped to a location — that location's own `LocationStock` negative; a branch can never sell/move out more than its own recorded `LocationStock`, even if the company-wide total would otherwise cover it. `DELETE /products/:id/movements/:movementId` (reversing a movement) is handled separately in `products.js` with the same negative-quantity/negative-`LocationStock` guards, and also updates both figures together in a `$transaction`.
- CSV export/import use `src/lib/csv.js` (`toCsv`/`parseCsv`) rather than a dependency; import upserts products by `sku` and never touches `quantity` (only movements do, to keep the audit trail meaningful).
- A route computing "low stock" should use `quantity <= reorderLevel`, matching `src/routes/reports.js` and the frontend's `.low-stock` styling.
- Route ordering matters in `src/routes/products.js`: fixed-path routes like `/export`, `/import`, `/categories` must be declared before `/:id` so Express doesn't treat them as an id.
- `src/lib/email.js` sends low-stock alerts and the daily summary via Resend and is a no-op (logs a warning, doesn't throw) if `RESEND_API_KEY`/`ALERT_EMAIL_TO` aren't set — the automatic low-stock trigger in `src/server.js` (`app.locals.onStockMovement`) only fires on the transition into low stock, not on every movement, to avoid spamming; the daily summary is scheduled with `node-cron` (`DAILY_SUMMARY_CRON`, default 8am).
- Products are soft-deleted (`deletedAt`), not removed: every product query in `src/routes/products.js` (list, get, export, movements) filters `deletedAt: null`; `GET /products/trash` and `POST /products/:id/restore` are the admin-only escape hatches, and `DELETE /products/:id/permanent` (admin, must already be soft-deleted) purges the product and its `StockMovement` rows in a transaction — `AuditLog` rows are untouched since they hold no FK to `Product`. `tests/helpers/db.js#resetDb` deletes in FK order: `SaleItemModifier` → `SaleItem` → `Sale` → `LocationStock` → `ModifierOption` → `ModifierGroup` → `AuditLog` → `PurchaseOrderItem` → `PurchaseOrder` → `StockMovement` → `Location` → `Product` → `Supplier` → `User`.
- `src/middleware/rateLimit.js` (`apiLimiter` mounted globally in `app.js`, `authLimiter` on `/auth/login` and `/auth/forgot-password`) is skipped entirely when `NODE_ENV=test` (set by `npm run test:run`) — when running a single test file by hand per the command above, add `NODE_ENV="test"` too or the login-lockout/rate-limit tests will interfere with each other.
- `src/lib/audit.js#logAction` is called after every product/user/supplier mutation and movement create/delete; keep new mutating routes consistent with this so the Activity Log stays complete.
- `src/lib/upload.js` configures multer to write to `uploads/` (gitignored, served at `/uploads` by `src/app.js`) with a jpg/png/webp/gif extension allowlist and a 5MB limit.
- `Product.unitCost` is optional; `reports.js#getSummary` computes `totalValue` as `sum(quantity * (unitCost || 0))` — keep this the single source of truth for valuation rather than recomputing it elsewhere.
- Password reset (`POST /auth/forgot-password` / `/auth/reset-password`) stores only a sha256 hash of the token (`User.resetTokenHash`/`resetTokenExpiresAt`, 30 min expiry, single-use) and always returns a generic response from `/forgot-password` regardless of whether the email exists, to avoid account enumeration.
- Frontend auth state (JWT + user) lives in `web/src/context/AuthContext.jsx`, persisted to `localStorage`; `RequireAuth`/`RequireRole` (`web/src/components/RequireAuth.jsx`) gate routes in `web/src/App.jsx`. `AuthContext` re-fetches `GET /auth/me` whenever a token is present, so a session persisted before a user field existed (e.g. `homeLocationId`) picks it up without a re-login — keep `/auth/me` and the `POST /auth/login` user payload returning the same fields. `PosPage.jsx` reads `user.homeLocationId` to pin a `staff` cashier's branch selector to their assigned branch (admins still choose freely); this is UX only — `sales.js` independently scopes staff server-side, so the lock is never the thing enforcing it. `web/src/api/client.js#onUnauthorized` lets `AuthContext` register a callback that clears the session and redirects to `/login` on any authenticated request that comes back `401` — it only fires when a token was sent, so a bad-password `401` on `/auth/login` itself doesn't trigger it. `web/src/context/LanguageContext.jsx` + `web/src/i18n/translations.js` provide the EN/ไทย toggle via a flat-key `t()` — add new UI copy as keys there rather than inline strings, and don't expect API error messages to be translated (those come from the backend in English).
- Purchase orders (`src/routes/purchaseOrders.js`, `PurchaseOrder`/`PurchaseOrderItem`) move through `draft` → `ordered` → `partially_received`/`received` (or `cancelled` from `draft`/`ordered` only — once anything's been received it can't be cancelled). Only a `draft` PO can be edited (`PATCH`, which replaces all items wholesale) or deleted. `POST /:id/receive` is the only place PO receipt touches stock: for each line item it creates a normal `StockMovement` (`type: "in"`, note `"Received from PO #<id>"`), increments `Product.quantity`, and increments `PurchaseOrderItem.quantityReceived` in one `$transaction`, then recomputes the order's status from all its items. A PO can never receive more than an item's remaining `quantityOrdered - quantityReceived`. Because `PurchaseOrderItem` rows are live business records (not just an audit trail), `DELETE /suppliers/:id` 409s if the supplier has any purchase orders, and `DELETE /products/:id/permanent` 409s if the product appears on any purchase order item — unlike `StockMovement` rows, which permanent-delete does discard.
- `Location` (`src/routes/locations.js`) doubles as a "branch" entity: it now also carries `address`/`phone`/`isActive`, and `User.homeLocationId` ties a staff member to one. `StockMovement.locationId` is still optional and purely descriptive — `GET /products/:id/movements/by-location` derives each location's net quantity by summing `in`/`out` movements client-side (in the route handler) rather than reading `LocationStock`, so it stays consistent with the movement log by construction even though `LocationStock` (see above) is now the real, persisted per-branch stock partition used to gate POS sales. `Product.quantity` is still the single company-wide running total, updated on every movement regardless of whether it's location-tagged — `LocationStock` is additive, not a replacement. `DELETE /locations/:id` 409s if any movement references it, or if it still has `LocationStock` rows with `quantity > 0`, matching the supplier/product-permanent-delete pattern. `GET /locations/:id/stock` lists that location's per-product `LocationStock` for non-deleted products. `Location.promptPayQrUrl` (nullable, `/uploads/<filename>.png` path, same convention as `Product.imageUrl`) holds an admin-uploaded PromptPay QR image per branch — `POST /locations/:id/promptpay-qr` (admin, multipart field `qr`, reuses `upload` from `src/lib/upload.js`) replaces the old file on disk if one existed, and `DELETE /locations/:id/promptpay-qr` (admin) clears it, 400 if none is set. This is a real, bank-issued QR image the admin uploads and PosPage.jsx displays when "promptpay" is the selected payment method — the app never generates or decodes a PromptPay/EMV payload itself.
- `Product.barcode` is optional and unique (like `sku`); `GET /products/lookup?code=` matches either field exactly and powers the Products page's scan-to-jump box (a barcode scanner types the code + Enter, same as a keyboard). `GET /products/:id/qrcode` streams a PNG (via the `qrcode` package) encoding the barcode, falling back to the SKU — treat it as a printable label generator, not a decoder; there's no server-side barcode/QR scanning.
- `ModifierGroup`/`ModifierOption` (`src/routes/products.js`, nested under `/products/:id/modifier-groups`, `/products/modifier-groups/:groupId`, `/products/modifier-groups/:groupId/options`, `/products/modifier-options/:optionId`) let a product define POS choices (e.g. size, toppings) — a group has a `selectionType` (`single`/`multiple`) and `required` flag, and each option has a `priceDelta`. POS pricing for a line item is always `product.sellingPrice ?? 0` plus the sum of the selected options' `priceDelta`; `Product.sellingPrice` is optional (nullable) like `unitCost`, separate from it, and unrelated to inventory valuation (`reports.js#getSummary`'s `totalValue` still uses `unitCost` only).
- `Sale`/`SaleItem`/`SaleItemModifier` (`src/routes/sales.js`, mounted at `/sales`) implement checkout: `POST /sales` validates `locationId` (must be an active `Location`), `paymentMethod` (`cash`/`promptpay`/`card`), and each item's product/modifier options, computes `unitPrice`/`lineTotal` server-side (never trusts client-sent prices), then in one `$transaction` creates the `Sale`/`SaleItem`/`SaleItemModifier` rows and calls `applyStockMovement` (type `out`, note `"POS sale #<id>"`) per item — so a sale can't be recorded if it would oversell either `Product.quantity` or the branch's `LocationStock`. `POST /sales/:id/void` (admin only) is the inverse: it reverses each item via `applyStockMovement` (type `in`, note `"Void of sale #<id>: <reason>"`) and marks the sale `voided`/`voidedAt`/`voidedById`; a sale can only be voided once. `GET /sales`, `GET /sales/:id`, and `GET /sales/:id/receipt` (a PDF via `src/lib/pdf.js`) all auto-scope staff users to their own `User.homeLocationId` (404 on a sale outside it); admins are unscoped. `reports.js#GET /sales-summary` (revenue, sale count, revenue-by-location, top 10 products) applies the same staff home-location scoping and only counts `status: "completed"` sales.

## Conventions

- Backend and frontend are separate npm projects (root `package.json` vs `web/package.json`) with independent dependencies and CI jobs.
- Never commit `.env`, `dev.db`, or `test.db` (all gitignored) — use `.env.example` as the template for required environment variables.
- New backend routes needing role restriction should reuse `requireRole` rather than checking `req.user.role` ad hoc.

## Subagent pipeline

This project defines 7 subagents under `.claude/agents/`. For any new feature or system request, invoke them in this order:

1. **planner-agent** — breaks the request into a plan and task list for the other agents. Always run first for anything beyond a trivial one-line fix.
2. **database-agent** — designs schema, writes migrations, defines models.
3. **backend-agent** — implements API endpoints, business logic, auth/authorization.
4. **frontend-agent** — builds UI screens/components against the backend API.
5. **qa-agent** — writes and runs tests covering the golden path and edge cases.
6. **devops-agent** — sets up build/run/CI/deployment configuration.
7. **docs-agent** — updates README/API docs/CLAUDE.md to match what was actually built.

Each agent should hand off to the next once its stage is done, rather than trying to do the whole feature itself. Skip stages that clearly don't apply to a given request (e.g. a pure copy change doesn't need database-agent), but default to running planner-agent first so that decision is made explicitly rather than skipped by accident.

### Role-based access

Role/permission concerns (e.g. admin vs staff) must be enforced in the database schema and backend, not just hidden in the UI. See database-agent and backend-agent for specifics.
