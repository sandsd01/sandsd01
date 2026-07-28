# Inventory Manager

Basic stock management system with two roles — **admin** and **staff**.

- **admin**: manage products, manage users, record stock movements, view everything
- **staff**: view products, record stock in/out movements, view movement history

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
| POST | `/auth/login` | — | Log in, returns `{ token, user }` |
| POST | `/auth/logout` | any | No-op; client discards the token |
| PATCH | `/auth/password` | any | Change your own password (`{ currentPassword, newPassword }`) |
| GET | `/products?search=&category=&page=&pageSize=&sortBy=&sortDir=` | any | Paginated product list — filter by SKU/name/category, sort by `name`\|`sku`\|`quantity`\|`reorderLevel`\|`category` |
| GET | `/products/categories` | any | Distinct list of product categories in use |
| GET | `/products/export` | any | Download products as CSV (respects `?search=`/`?category=`) |
| POST | `/products/import` | admin | Bulk create/update products from CSV (`{ csv }`); upserts by SKU, never touches `quantity` |
| GET | `/products/:id` | any | Get one product |
| POST | `/products` | admin | Create a product |
| PATCH | `/products/:id` | admin | Update a product |
| DELETE | `/products/:id` | admin | Delete a product |
| GET | `/products/:id/movements` | any | List stock movement history |
| GET | `/products/:id/movements/export` | any | Download a product's movement history as CSV |
| POST | `/products/:id/movements` | admin, staff | Record a stock in/out movement (updates quantity) |
| DELETE | `/products/:id/movements/:movementId` | admin | Delete a movement, reversing its effect on quantity |
| GET | `/reports/summary` | any | Product/quantity/low-stock counts and the 10 most recent movements |
| GET | `/reports/movements-timeseries?days=` | any | Daily in/out totals for the last N days (default 30) |
| POST | `/reports/send-low-stock-alert` | admin | Manually send the low-stock alert email now |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create a user |
| PATCH | `/users/:id` | admin | Update a user's email/password/role |
| DELETE | `/users/:id` | admin | Delete a user |

### Low-stock email alerts

Set `RESEND_API_KEY` and `ALERT_EMAIL_TO` in `.env` (see `.env.example`) to enable email alerts via [Resend](https://resend.com). When configured, an alert fires automatically the moment a stock-out movement takes a product from above its reorder level to at-or-below it, and admins can also trigger one on demand from the Reports page. Without those env vars set, alerts are silently skipped (logged, not an error).

## Project structure

```
prisma/          Schema, migrations, seed script, Prisma client wrapper
src/
  app.js         Express app (routes + middleware)
  server.js      Entry point (reads env, starts listening)
  middleware/    JWT auth + role-check middleware
  lib/csv.js     CSV serialize/parse helpers used by the export/import endpoints
  lib/email.js   Low-stock alert emails via Resend (no-ops if unconfigured)
  routes/        auth, products, users, reports
tests/           node:test + Supertest suite (backend)
web/             React (Vite) frontend SPA
.claude/agents/  Claude Code subagent pipeline (see CLAUDE.md)
```
