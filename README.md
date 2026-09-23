# OYO Operational Requests Platform — Demo

A standalone demo of the OYO operational-request lifecycle: **Create → Submit →
sequential multi-level Approve/Reject → Execute (with evidence upload) → Close → status list**,
for a single outlet. Built with Next.js (App Router, TypeScript), Postgres (via `pg`) for
persistence, and Vercel Blob for evidence file storage — both chosen so the app runs cleanly on
Vercel's serverless functions, which have no persistent local disk. There is no real
authentication — a header **role-switcher** (Requester / Approver / Closer / Admin) stands in
for it.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_URL` or `DATABASE_URL` | Yes (one of the two) | Postgres connection string. `POSTGRES_URL` is what Vercel Postgres sets by default; `DATABASE_URL` is what Neon-via-Marketplace and most other Postgres providers use. Checked in that order. **Use a pooled connection string** (Vercel Postgres and Neon both provide one, usually with `-pooler` in the hostname or a `PRISMA`/`POOLING` variant) — each warm Vercel function instance opens its own `pg` connection pool, and an unpooled connection string can exhaust a small Postgres plan's connection limit under concurrent load. |
| `BLOB_READ_WRITE_TOKEN` | Yes, for Execute | Vercel Blob read/write token, used to upload evidence files. Only needed when a Requester executes a request with a file — the rest of the app works without it. |

Neither is required to run `npm test` — the test suite runs fully offline against an in-memory
Postgres-compatible engine (`pg-mem`) and an in-memory fake for Blob, selected automatically by
setting `OYO_TEST_DB=1` before the app's modules are first imported.

## Run it

```bash
npm install
npm run db:migrate   # one-time: creates the schema and seeds request types + sample data
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

`npm run db:migrate` is safe to re-run: schema creation uses `CREATE TABLE IF NOT EXISTS` and the
`request_types` seed uses `ON CONFLICT DO NOTHING`, so running it twice (or racing it against a
cold start that also lazily initializes the schema on first query) can never duplicate rows or
throw a duplicate-key error. It seeds:
- a default approval rule of **1 required level** for every request type (Purchasing,
  Maintenance, Marketing Spend, Security, Other), and
- 2–3 sample requests in varied statuses (one **Closed**, one **Rejected**, one freshly
  **Submitted**/pending) so the status list isn't empty on first run.

Uploaded evidence files are stored in Vercel Blob; the app links directly to the public URL Blob
returns — there's no local disk to serve them from and no custom download route.

## Roles

Use the **Acting as** dropdown in the header to switch role at any time — this sets a
`demoRole` cookie and re-renders the app as that role. No login is required.

| Role | Can do |
|---|---|
| **Requester** | Create/submit a new request; execute an Approved request (upload evidence) |
| **Approver** | Approve or reject a request that is awaiting approval, one level at a time |
| **Closer** | Close an Executed request |
| **Admin** | Configure how many sequential approval levels each request type requires |

Actions that don't apply to the current role/status are hidden on the request detail page, and
the API layer enforces the same rules server-side (so a direct API call from the wrong role or
against a locked request is also rejected).

## Demo script (matches the success signal)

1. **Acting as Admin** → go to **Admin** → set **Purchasing** to **2** required levels → Save.
2. **Switch to Requester** → **New Request** → create a Purchasing request (fill in title,
   description, amount, your name) → Create & Submit. It appears in the **Status List** as
   *Pending Approval (Level 1)*.
3. **Switch to Approver** → open the request → **Approve**. Status becomes *Pending Approval
   (Level 2)*.
4. Still as Approver → **Approve** again. Status becomes **Approved**.
5. **Switch to Requester** → open the request → attach an evidence file → **Execute & Upload
   Evidence**. Status becomes **Executed**, and the evidence file is now linked on the detail
   page (opens directly from its Blob URL).
6. **Switch to Closer** → open the request → **Close Request**. Status becomes **Closed**.
7. Go back to the **Status List** — the request shows **Closed**, and the evidence file still
   opens from its detail page. No further actions are available on it, for any role.

To see a reject or a live mid-flight config change:
- Reject: as Approver, click **Reject** instead of **Approve** at any level — the request moves
  straight to **Rejected** (terminal, read-only).
- Live config change: while a Purchasing request is pending at level 1, switch to Admin and
  change Purchasing's required levels (e.g. to 1) — the next approval decision on that request
  immediately uses the new count, without needing to recreate the request.

## Project layout

- `lib/types.ts` — shared domain enums/types (`RequestType`, `RequestStatus`, `Role`).
- `lib/db.ts` — Postgres connection pool (`pg`), schema init, and idempotent seed data. Swaps to
  a `pg-mem`-backed pool when `OYO_TEST_DB` is set.
- `lib/blob.ts` — thin wrapper around `@vercel/blob`'s `put()` for evidence uploads. Swaps to an
  in-memory fake when `OYO_TEST_DB` is set.
- `lib/requests.ts` — all lifecycle/business logic (create, list, get, approve/reject, execute,
  close, approval-rule config), including the **live** read of required levels on every
  approval decision. Every function is async.
- `lib/role.ts` — reads the `demoRole` cookie server-side.
- `app/` — pages and API routes (status list, new-request form, request detail, admin, and the
  corresponding `app/api/**/route.ts` handlers).
- `components/` — `RoleSwitcher`, `RequestActions`, `AdminRulesTable`.
- `scripts/db-migrate.ts` — one-time schema/seed runner for a fresh Postgres database.
- `tests/` — integration tests covering the lifecycle and edge cases (see below).

## Tests

```bash
npm test
```

Runs `tests/requests.test.ts` (Node's built-in test runner via `tsx`) fully offline against
`pg-mem` (an in-memory Postgres-compatible engine) and an in-memory Blob fake — no real network
Postgres or Blob call is ever made. Covers:
- happy path: submit → approve L1 → approve L2 → execute → close
- reject at any level terminates the request
- a single-required-level type reaches Approved after one approval
- a live admin config change mid-flight is honored on the next decision
- executing without an evidence file is blocked with a validation error
- a Closed request rejects further approve/execute/close actions
- wrong-role actions are rejected (Requester approving, Approver executing, Closer approving, …)
- executing with a file returns a fetchable `evidenceUrl`, not a local path
- re-seeding the database twice leaves exactly 5 `request_types` rows, no duplicate-key errors
- a missing `POSTGRES_URL`/`DATABASE_URL` produces a clear, actionable error
- a missing `BLOB_READ_WRITE_TOKEN` produces a clear "Blob storage is not configured" error

## Verification

```bash
npm install   # installs cleanly, no native-binary postinstall step
npm run build # TypeScript compiles, Next.js build succeeds
npm test      # lifecycle + edge-case tests pass, fully offline
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. In the Vercel dashboard, **Add New → Project** and import the GitHub repository.
3. Add a Postgres database: **Storage → Create Database → Postgres** (or connect a Neon database
   via the Marketplace) and attach it to the project — this sets `POSTGRES_URL` (or
   `DATABASE_URL`) automatically.
4. Add a Blob store: **Storage → Create Database → Blob** and attach it to the project — this
   sets `BLOB_READ_WRITE_TOKEN` automatically.
5. Deploy.
6. Run the one-time migration against the new database: locally, set `POSTGRES_URL` (copy it
   from the Vercel project's Storage tab or `vercel env pull`) and run `npm run db:migrate`, or
   run the same command from a Vercel CLI/terminal session with the project's env vars loaded.
7. Open the deployed URL and walk the demo script above.

No CI/CD pipeline is authored here beyond this manual, dashboard-driven flow — Vercel builds and
redeploys automatically on every push to the connected branch once the project is imported.

## Known limitations (by design, for this demo)

- No real authentication/user accounts — role-switcher only.
- Single outlet only; no multi-outlet/multi-region data model.
- No integrations with real OYO backend systems.
- No notifications (email/SMS/push).
- No partial approval/delegation; no multi-language or multi-currency support.
- No migration of the old local SQLite demo data — this is a fresh-seed cutover to Postgres +
  Blob, not a data migration.
- Evidence files are stored in Vercel Blob with `access: 'public'` — anyone with the URL can view
  them, no login required. This matches the app's existing no-real-auth trust model (evidence was
  never access-controlled in the local-disk version either), but the URLs are now real public
  internet links rather than routed through this app, so treat them accordingly for real business
  documents.
