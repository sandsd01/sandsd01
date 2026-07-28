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
| GET | `/products` | any | List products |
| GET | `/products/:id` | any | Get one product |
| POST | `/products` | admin | Create a product |
| PATCH | `/products/:id` | admin | Update a product |
| DELETE | `/products/:id` | admin | Delete a product |
| GET | `/products/:id/movements` | any | List stock movement history |
| POST | `/products/:id/movements` | admin, staff | Record a stock in/out movement (updates quantity) |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create a user |
| PATCH | `/users/:id` | admin | Update a user's email/password/role |
| DELETE | `/users/:id` | admin | Delete a user |

## Project structure

```
prisma/          Schema, migrations, seed script, Prisma client wrapper
src/
  app.js         Express app (routes + middleware)
  server.js      Entry point (reads env, starts listening)
  middleware/    JWT auth + role-check middleware
  routes/        auth, products, users
tests/           node:test + Supertest suite (backend)
web/             React (Vite) frontend SPA
.claude/agents/  Claude Code subagent pipeline (see CLAUDE.md)
```
