# Troubleshooting

Commands below assume the repository root. Stop the affected process before changing configuration.

## Database

### `ECONNREFUSED 127.0.0.1:55432`

The embedded development database is not running.

```bash
npm run dev:db
```

Leave that terminal open. Verify the connection string matches the port printed by the command (default `55432`):

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/proof_of_impact
```

If `DEV_DB_PORT` is set in the shell, use that port instead. Ensure no other PostgreSQL instance already owns it:

```bash
netstat -ano | findstr :55432     # Windows
lsof -i :55432                    # macOS/Linux
```

### `database "proof_of_impact" does not exist`

The embedded helper creates it on first start. With an external server:

```bash
createdb proof_of_impact
npm run db:migrate
```

### Migration failure

- Read the first error; it usually names the failing statement.
- Ensure the database role can create tables, types, functions and triggers. The schema uses `CREATE TRIGGER`, `CREATE FUNCTION`, `pg_advisory_xact_lock` and check constraints.
- Do not edit an already-applied migration to "fix" it. Add a new numbered migration.
- The API runs migrations at startup outside production. In production, run `npm run db:migrate` explicitly before starting.
- Keep the server's timezone/encoding defaults conventional; the schema uses `timestamptz` and `NUMERIC`.

### Resetting the development database

Only when you are certain the local data is disposable. Stop `npm run dev:db`, then delete `var/pgdata` and restart it. **This permanently deletes the local development database, including the audit chain and uploaded-file metadata.** Back it up first if you need it. Never do this to a shared or production database. Uploaded files in `var/uploads` are not removed by this operation and can be deleted separately when appropriate.

### Seed refuses to run

| Message | Fix |
| --- | --- |
| `Set SEED_DEMO=true` | Set `SEED_DEMO=true` in `.env` (development only). |
| `Set SEED_DEMO_PASSWORD...` | Set a password of at least 10 characters. There is no default. |
| `Demonstration data must never be seeded into a production environment` | Intended. Do not seed demo data in production; provision an administrator with `npm run create-admin`. |
| Unique/constraint conflict while seeding | A partially seeded database or a conflicting pre-existing row. Use a fresh development database; do not manually delete audit rows. |

Re-running the seed is intended to be safe for demonstration data, but it is not a production data-import tool.

## API startup

### `Invalid environment configuration: ...`

The API validates its environment at startup. The message names the failing field.

- `DATABASE_URL` is required.
- `CONTRACT_ADDRESS` must be a 20-byte hex address (`0x` + 40 hex characters) or empty.
- `RPC_URL` must start with `http://` or `https://` or be empty.
- `SEED_DEMO=true` is rejected when `NODE_ENV=production`.
- Numeric bounds apply to `PORT`, `SESSION_TTL_HOURS`, `MAX_UPLOAD_BYTES`, `CHAIN_ID`, `ANCHOR_CONFIRMATIONS` and `RECONCILE_INTERVAL_MS`.

### Port 4000 already in use

Change `PORT` in `.env` and update the Vite proxy target in `apps/web/vite.config.ts` (currently `http://127.0.0.1:4000`), or stop the process using the port:

```bash
netstat -ano | findstr :4000     # Windows, then taskkill /PID <pid> /F
lsof -i :4000                    # macOS/Linux
```

### Vite port 5173 in use

`apps/web/vite.config.ts` sets `strictPort: true`, so Vite fails instead of silently moving. Stop the other process or change the port and the API's `WEB_ORIGIN` together. A mismatch is also a CSRF/origin failure.

## Authentication and CSRF

### Login always returns `Email or password is incorrect`

- Demo accounts use `SEED_DEMO_PASSWORD` from `.env`; there is no built-in password.
- If the seed ran with a different password, reseed the demo data or reset the account through the database with a proper Argon2 hash — do not insert plaintext.
- Accounts can be `SUSPENDED` or `INACTIVE`; the API returns `ACCOUNT_INACTIVE` for a correct password on a disabled account.
- Emails are matched case-insensitively.

### `429 RATE_LIMITED`

Authentication allows 20 attempts per 15 minutes per IP; the general API allows 300 requests per minute. Development limiter counters live in API memory: restart the API to reset them. In production, wait for the window or investigate the client. Do not disable rate limiting in production.

### `403 ORIGIN_REJECTED`

The browser `Origin` does not match `WEB_ORIGIN` or the API's own origin. Common causes:

- You opened `http://127.0.0.1:5173` but `WEB_ORIGIN` says `http://localhost:5173` (these are different origins).
- The front end runs on a different port than configured.
- A reverse proxy rewrites the host and `WEB_ORIGIN` was not updated.
- A tool sends an unexpected origin.

Set `WEB_ORIGIN` to the exact scheme, host and port, comma separated for multiple origins.

### `403 CSRF_INVALID` or `A CSRF token is required`

- The `poi_csrf` cookie and the `X-CSRF-Token` header must come from the same session.
- Cookies may have been cleared while the page stayed open; refresh and sign in again.
- Cross-origin front-end/API setups must allow credentials and send the header. The supplied Vite proxy avoids this locally.
- `COOKIE_SECURE=true` over plain HTTP prevents the browser from storing cookies; use HTTPS or set it to `false` locally.

### Redirected to login unexpectedly

- Sessions expire after `SESSION_TTL_HOURS` (default 12).
- Changing a password revokes all sessions.
- An administrator can suspend an account, which invalidates its sessions.
- Check the browser console/network panel for 401 responses and read the API error `code`.

## Automated tests

### API tests cannot connect or permission denied creating the test database

The API suite requires a running PostgreSQL and a role allowed to create/drop the `proof_of_impact_test` database. It derives the name from `DATABASE_URL`. Do not point tests at production. Start `npm run dev:db`, or provide a test-capable role.

The embedded cluster's default superuser can create databases. With a restricted production role, run the suite against your local development cluster instead.

### Contract tests hang or fail to start

The Hardhat tests use an in-memory EDR network and require no Sepolia access. A hang is usually a stale Node process or a corrupted cache. Remove `contracts/cache` and re-run; artifacts can be regenerated with `npm run compile:contracts`.

### Web tests fail with a missing DOM

Run them through the workspace script (`npm run test:web`), which uses the jsdom configuration in `apps/web/vite.config.ts`. Running a bare Vitest from the repository root bypasses that configuration.

## Uploads

| Symptom | Cause / fix |
| --- | --- |
| `413 FILE_TOO_LARGE` | File exceeds `MAX_UPLOAD_BYTES` (default 10 MB). |
| `The file type could not be determined` | Empty or unrecognised file. Only PDF, PNG, JPEG and WebP are accepted based on magic bytes. |
| `Files of type text/html are not accepted` | The declared extension is irrelevant; the detected content is rejected. Rename/re-encode the file or convert it to PDF. |
| `403`/`404` downloading evidence | Restricted evidence requires administrator, project owner or active assigned reviewer access. Anonymous users can download only public evidence on public projects. |
| Upload succeeds but download fails | The database row exists but the file is missing from `FILE_STORAGE_DIR`. Restore the matching storage snapshot; do not delete the row silently. |
| Files disappear after restart | `FILE_STORAGE_DIR` points at a non-persistent path. Use an absolute persistent directory. |

Do not place `FILE_STORAGE_DIR` inside a directory served statically by Vite, Nginx or the API; downloads must pass through authorization.

## Blockchain anchoring and verification

### Anchoring is disabled in the UI

Check the API's own view:

```bash
curl http://localhost:4000/api/v1/meta
```

- `contractAddress: null` → set `CONTRACT_ADDRESS` after a real deployment.
- `rpcConfigured: false` → set `RPC_URL`.
- Both missing → no deployment/configuration exists. This is the current state of the project; no anchor can be prepared, and the UI says so.

Never set a placeholder address to "enable" the UI. Verification will fail and the resulting anchor states will be misleading.

### `CONTRACT_ADDRESS must be a 20-byte hex address`

Use the address printed by the deploy script. Do not include a transaction hash or an explorer URL.

### MetaMask does not switch networks / transaction rejected

- Add Sepolia to the wallet and ensure `CHAIN_ID=11155111` matches.
- The browser wallet must hold the account that has `ANCHOR_ROLE`; a transaction from another account reverts.
- If the API was started before the contract deployment, restart it after updating configuration.
- MetaMask may reject the request if the account is locked; unlock it and retry.

### `The transaction reverted` or `FAILED`

The anchor preparation is recorded, but no confirmation is claimed. Check:

- The submitted `txHash` belongs to the same prepared commitment and registry.
- The wallet has `ANCHOR_ROLE` at the time of the transaction.
- The record version is newer than the last active version.
- The `previousKey` matches the active commitment when superseding.

A failed anchor remains `FAILED` with the provider's reason. Do not overwrite it with a fabricated success; prepare a new anchor after correcting the cause.

### `VERIFICATION_ERROR` or "transaction not found yet"

- The transaction may still be pending; reconciliation retries while `RPC_URL` and `CONTRACT_ADDRESS` are configured.
- Public RPC endpoints can lag or rate-limit. Configure a reliable provider.
- A reorg can make a previously seen receipt unavailable; the API surfaces this rather than assuming finality.
- Check that `ANCHOR_CONFIRMATIONS` is realistic for the network.

### Verification says `MISMATCH`

A mismatch means the recomputed record commitment differs from the on-chain commitment: the record changed after anchoring, the wrong contract/chain is configured, or the on-chain transaction belongs to a different record/version. Compare the record version, digest, contract address and chain ID. Do not "fix" this by rewriting the anchor or history; investigate the record versions and anchor a new version if appropriate.

### Verification says `NOT_FOUND`

The record has no confirmed anchor. This is an honest result, not an error. In the current repository state, every record returns this because nothing has been deployed or anchored.

### `RPC_URL` reachable but contract calls fail

- Ensure the contract at `CONTRACT_ADDRESS` is the `ProofOfImpactRegistry` deployed for the same `CHAIN_ID`.
- A provider error surfaces as `VERIFICATION_ERROR`; check the API log for the provider message (secrets are redacted, URLs may appear).
- Verify with an explorer that the address is a contract, not an externally owned account.

## Build and tooling

### Web build warning about a chunk larger than 1100 kB

Expected. Recharts, React and the wallet/stellar dependencies produce a single main chunk, and the ethers dynamic import is reported as ineffective. The build still succeeds. Code splitting is a future optimisation, not a functional failure.

### Dynamic import of ethers is reported as ineffective

Vite bundles ethers into the main chunk because other code paths reference it synchronously. This is a size warning, not a runtime failure. Wallet functionality still works.

### TypeScript errors in a clean checkout

Run the full typecheck (`npm run typecheck`), which includes the shared workspace and its tests. Running `tsc` in a single workspace without building shared can report unresolved `@poi/shared` imports. The Vite and API tooling resolve the shared source/alias directly in development.

### `EADDRINUSE` starting `npm run dev`

Another dev session is already running. Stop it, or check for orphan processes on 4000 and 5173. The API and Vite are started together by `concurrently`; stop both with Ctrl+C in that terminal.

### Windows path or script issues

Use Git Bash or PowerShell with the provided npm scripts. Paths are constructed with `node:path` in the application. Avoid running the API from a different working directory without an absolute `FILE_STORAGE_DIR`; migrations are located relative to the repository root.

## Issues found and fixed during this build

These were genuine failures during development and are recorded so the fixes are understandable:

- `PATCH /api/v1/projects/:id` accepted a body without a status transition; status changes now use `PATCH /api/v1/projects/:id/status` with validated transitions and reasons.
- The demo seed could collide with an existing category slug; it now uses an idempotent upsert.
- 5xx responses exposed internal validation details; details are now omitted for all status codes ≥ 500.
- Mark-all-notifications-read was shadowed by the `/:id/read` route; the specific route is registered first.
- Public project responses returned the owner's name; public projections now null owner and reviewer identity, and the UI renders "Withheld from this view".
- Anonymous claim detail was linked from public project pages but the route required login; claim detail is now public with restricted fields masked by the API.
- `/blockchain` claimed no RPC was configured while also rendering "Configured"; the UI now derives its message from the API's actual chain fields.

For security design and residual risks, see [SECURITY.md](SECURITY.md). For the verified results and scope, see [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md).
