# OYO Operational Requests Platform — Demo

A standalone, single-process demo of the OYO operational-request lifecycle: **Create → Submit →
sequential multi-level Approve/Reject → Execute (with evidence upload) → Close → status list**,
for a single outlet. Built with Next.js (App Router, TypeScript) and SQLite (`better-sqlite3`).
There is no real authentication — a header **role-switcher** (Requester / Approver / Closer /
Admin) stands in for it.

## Run it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

A SQLite database is created automatically at `data/app.db` on first run, seeded with:
- default approval rule of **1 required level** for every request type (Purchasing, Maintenance,
  Marketing Spend, Security, Other), and
- 2–3 sample requests in varied statuses (one **Closed** with a real evidence file, one
  **Rejected**, one freshly **Submitted**/pending) so the status list isn't empty on first run.

Uploaded evidence files are stored on disk under `data/uploads/`.

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
   page.
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
- `lib/db.ts` — SQLite connection, schema, and seed data.
- `lib/requests.ts` — all lifecycle/business logic (create, list, get, approve/reject, execute,
  close, approval-rule config), including the **live** read of required levels on every
  approval decision.
- `lib/role.ts` — reads the `demoRole` cookie server-side.
- `app/` — pages and API routes (status list, new-request form, request detail, admin, and the
  corresponding `app/api/**/route.ts` handlers).
- `components/` — `RoleSwitcher`, `RequestActions`, `AdminRulesTable`.
- `data/` — SQLite database file and uploaded evidence files (created at runtime, not committed).
- `tests/` — integration tests covering the lifecycle and edge cases (see below).

## Tests

```bash
npm test
```

Runs `tests/requests.test.ts` (Node's built-in test runner via `tsx`) against a temporary SQLite
database, covering:
- happy path: submit → approve L1 → approve L2 → execute → close
- reject at any level terminates the request
- a single-required-level type reaches Approved after one approval
- a live admin config change mid-flight is honored on the next decision
- executing without an evidence file is blocked with a validation error
- a Closed request rejects further approve/execute/close actions
- wrong-role actions are rejected (Requester approving, Approver executing, Closer approving, …)

## Verification

```bash
npm install   # installs cleanly
npm run build # TypeScript compiles, Next.js build succeeds
npm test      # lifecycle + edge-case tests pass
```

## Troubleshooting

- **`npm install` fails inside `better-sqlite3`'s install step with a certificate error**
  (`unable to verify the first certificate`), typically followed by a `node-gyp`/Visual Studio
  error: this happens on corporate Windows machines that sit behind a TLS-inspecting proxy,
  which breaks Node's certificate validation when `better-sqlite3` tries to download its
  prebuilt binary from GitHub. Fix by re-running install with Node's system certificate store:
  ```bash
  # bash
  NODE_OPTIONS="--use-system-ca" npm install
  ```
  ```powershell
  # PowerShell
  $env:NODE_OPTIONS="--use-system-ca"; npm install
  ```
  You only need this for `npm install`; `npm run dev`/`build`/`start` do not need it. (Requires
  Node 22+; on older Node, ask IT for the corporate root CA and point `NODE_EXTRA_CA_CERTS` at
  it instead.)

## Known limitations (by design, for this demo)

- No real authentication/user accounts — role-switcher only.
- Single outlet only; no multi-outlet/multi-region data model.
- No integrations with real OYO backend systems.
- No notifications (email/SMS/push).
- No partial approval/delegation; no multi-language or multi-currency support.
