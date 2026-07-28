# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An inventory/stock management system with two roles, admin and staff. See `README.md` for setup, the API endpoint table, and available scripts.

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

To run a single backend test file: `DATABASE_URL="file:./test.db" JWT_SECRET="test-secret" node --test tests/products.test.js` (run `npm run test:migrate` first if `test.db` doesn't exist yet).

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
- Stock movements (`POST /products/:id/movements`) are the only place `Product.quantity` changes; a movement create + quantity update happen together in a `prisma.$transaction`. Out-movements are rejected with 400 if they'd take quantity negative.
- CSV export endpoints (`GET /products/export`, `GET /products/:id/movements/export`) build CSV with `src/lib/csv.js` rather than a dependency; a route computing "low stock" should use `quantity <= reorderLevel`, matching `src/routes/reports.js` and the frontend's `.low-stock` styling.
- Route ordering matters in `src/routes/products.js`: fixed-path routes like `/export` must be declared before `/:id` so Express doesn't treat `"export"` as an id.
- Frontend auth state (JWT + user) lives in `web/src/context/AuthContext.jsx`, persisted to `localStorage`; `RequireAuth`/`RequireRole` (`web/src/components/RequireAuth.jsx`) gate routes in `web/src/App.jsx`.

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
