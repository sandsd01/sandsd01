# Chat App (Drive-backed transcripts)

1:1 chat MVP. Messages relay in real time through a Node/Socket.io server,
then get archived as JSON transcripts in **each participant's own Google
Drive** — the server itself never holds a permanent copy of message content.
See the design spec this was built from for the full architecture rationale.

> **Standalone project.** This directory is unrelated to the inventory/POS
> system at the repo root — it shares no code, database, or auth with it.
> It has its own `package.json` files (`server/`, `web/`) and its own env vars.

## Stack

- **Server** (`server/`): Node.js + Express + Socket.io (real-time relay),
  BullMQ + Redis (background Drive-sync queue), `pg` (Postgres/Supabase for
  metadata only), `googleapis` (OAuth + Drive API).
- **Web** (`web/`): React + TypeScript + Tailwind + Vite, `socket.io-client`.
- **Storage**: Google Drive of each user (via the restricted `drive.file`
  OAuth scope) — not a database, not S3.

## What's implemented

- Google OAuth sign-in (`openid email profile drive.file`), encrypted
  refresh-token storage, auto-created `ChatApp_ChatData/{conversations,attachments}`
  Drive folders per user on first login.
- Postgres metadata schema (`users`, `conversations`, `pending_sync_messages`).
- Socket.io relay: `message:send` / `message:receive`, `presence:online` /
  `presence:update`, `sync:status`.
- BullMQ background worker that appends every message to `conv_<id>.json` in
  **both** participants' Drives, with retry+backoff and per-message
  synced-to-A / synced-to-B tracking so a partial failure doesn't re-send to
  the side that already succeeded.
- Client-side direct-to-Drive file upload (bytes never touch the relay
  server) with automatic read-only sharing to the recipient.
- REST: `POST /auth/google/callback`, `GET /auth/google/url`, `GET /me`,
  `GET /me/drive-token`, `GET /conversations`, `POST /conversations`,
  `GET /conversations/:id/history`.
- React UI: Google sign-in, conversation list with online/offline dots, chat
  room with text + file messages and Drive-sync delivery ticks.

## What's deliberately NOT implemented (per spec section 11)

Group chats, stickers, push notifications, video/voice calls, a social feed.

## Setup

This repo ships **code only** — you need to provision three external
services yourself and put the resulting credentials into `.env` files. None
of this can be done by an agent on your behalf; each step below requires an
account only you can create.

### 1. Google Cloud project (OAuth + Drive API)

1. Create a project at https://console.cloud.google.com.
2. Enable the **Google Drive API** (APIs & Services → Library).
3. Configure the **OAuth consent screen** (APIs & Services → OAuth consent
   screen). While in "Testing" mode you can add up to 100 test users without
   Google review. Going beyond that, or requesting the `drive.file` scope
   for a public launch, requires **OAuth verification** (and possibly a CASA
   security assessment) — this can take weeks, so start it early, not right
   before launch.
4. Create an **OAuth 2.0 Client ID** of type "Web application"
   (Credentials → Create Credentials). Add an Authorized redirect URI
   matching `GOOGLE_REDIRECT_URI` below (e.g. `http://localhost:5173/login`
   for local dev).
5. Copy the Client ID and Client Secret into `server/.env`.

### 2. Postgres (Supabase)

1. Create a project at https://supabase.com.
2. Copy its Postgres connection string into `server/.env` as `DATABASE_URL`.
3. Apply the schema: `cd server && npm install && npm run migrate`
   (runs `src/sql/schema.sql`).

### 3. Redis (for the BullMQ Drive-sync queue)

Any reachable Redis instance works (local `redis-server`, Upstash, Railway,
etc). Put its connection string in `server/.env` as `REDIS_URL`.

### 4. Environment variables

```bash
cp server/.env.example server/.env   # fill in DATABASE_URL, REDIS_URL, JWT_SECRET,
                                       # ENCRYPTION_KEY, GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI
cp web/.env.example web/.env         # VITE_API_BASE_URL
```

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
```

### 5. Run it

```bash
cd server && npm install && npm run dev    # http://localhost:4000
cd web && npm install && npm run dev       # http://localhost:5173
```

Redis and Postgres must be reachable before `npm run dev` on the server, or
the sync queue / DB queries will throw at startup/request time.

## Known gaps to close before shipping

- No automated tests yet (spec step 8: token-expiry, revoke, and
  network-loss scenarios need coverage).
- No CI/deploy config yet (Railway/Render for `server/`, Vercel for `web/`
  per the spec's suggested hosting).
- `docs/PRIVACY.md` is a starting draft, not reviewed legal copy — needed
  before Google OAuth verification and PDPA compliance sign-off.
- Drive API calls in `server/src/services/drive.js` are not yet
  rate-limited per user (spec section 10) — fine for an MVP with a handful
  of users, but add a limiter before opening this up broadly.
