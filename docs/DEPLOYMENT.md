# Deployment guide

This guide covers three things separately:

1. Running the full stack locally.
2. Preparing a production-style deployment of the API, database and web build.
3. Deploying the registry contract to Ethereum Sepolia and enabling anchoring.

> **Current deployment status (26 October 2026):** no Sepolia deployment has been performed. `CONTRACT_ADDRESS` is empty, the development database contains zero anchors, and no transaction hash or contract address is published anywhere in this repository. The contract compiles and its 13 tests pass on an ephemeral Hardhat network. The steps below describe what an operator would do; they are not a record of a completed deployment.

## 1. Local development

### Prerequisites

- Node.js 22.12 or newer (verified on Node 26.3.0), npm 10 or newer.
- Git Bash, PowerShell or another shell on Windows; macOS/Linux work normally.
- A browser. MetaMask is required only for anchoring.
- PostgreSQL is optional locally: `npm run dev:db` runs an embedded PostgreSQL 17 on `127.0.0.1:55432`.

### Steps

```bash
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Local value |
| --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:55432/proof_of_impact` |
| `SEED_DEMO_PASSWORD` | a development password of at least 10 characters with a letter and a number |
| `WEB_ORIGIN` | `http://localhost:5173` |
| `COOKIE_SECURE` | `false` for local HTTP |
| `CONTRACT_ADDRESS` | leave empty |

Start the embedded database in terminal 1:

```bash
npm run dev:db
```

Apply migrations and seed the demonstration dataset in terminal 2:

```bash
npm run db:setup
```

Start the API and Vite in terminal 3:

```bash
npm run dev
```

| URL | Purpose |
| --- | --- |
| <http://localhost:5173> | Web application |
| <http://localhost:4000/api/v1/health> | API health |
| <http://localhost:4000/api/v1/openapi.json> | OpenAPI 3.1 document |
| <http://localhost:4000/api/docs> | Swagger UI |

Seeded accounts are listed in the [README](../README.md#demonstration-accounts). All share `SEED_DEMO_PASSWORD`; the application never prints it.

### Using an existing PostgreSQL server

```bash
createdb proof_of_impact
# Set DATABASE_URL=postgres://user:password@host:5432/proof_of_impact
npm run db:migrate
npm run db:seed        # development only; refuses NODE_ENV=production
```

The API migration runner applies files in `database/migrations` in lexical order inside a lock, and records applied files. Inspect it before applying to a database you care about.

### Provisioning the first administrator

```bash
ADMIN_PASSWORD='<strong-password>' npm run create-admin -- admin@example.org "Platform Administrator"
```

`ADMIN_EMAIL` and `ADMIN_NAME` are also accepted. The password is read from the environment only; it is never accepted as a command-line argument.

### Running the automated tests

```bash
npm run typecheck
npm test
```

The API suite creates and drops a separate database named `proof_of_impact_test` derived from `DATABASE_URL`, applies real migrations, and disables rate limiting. Point `DATABASE_URL` at a development/test cluster only. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if the suite cannot connect.

## 2. Production-style deployment

### Application requirements

- Node.js 22.12+.
- PostgreSQL 16+ with a dedicated role and database, backed up and encrypted at rest.
- HTTPS termination (reverse proxy or managed load balancer).
- Persistent storage for `FILE_STORAGE_DIR`, not inside a static or executable web root.
- Outbound HTTPS access to the configured Sepolia RPC endpoint if anchoring/verification is enabled.

### Required configuration

| Variable | Production guidance |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | dedicated least-privilege role; TLS if the database is remote |
| `WEB_ORIGIN` | the exact HTTPS origin(s) of the front end, comma separated; no wildcards |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` only when exactly one trusted proxy hop fronts the API |
| `SESSION_TTL_HOURS` | 12 or less, depending on policy |
| `SEED_DEMO` | **unset or `false`** — startup rejects `true` in production |
| `DEMO_MODE` | `false` unless this is an explicitly labelled showcase deployment |
| `SEED_DEMO_PASSWORD` | remove it in production |
| `FILE_STORAGE_DIR` | absolute path on a persistent, encrypted volume |
| `MAX_UPLOAD_BYTES` | keep bounded (default 10 MB) |
| `SERVE_WEB` | `true` to serve `apps/web/dist` from the API, or `false` behind a web server |
| `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` | set only after a real deployment; see section 3 |
| `ANCHOR_CONFIRMATIONS` | 2 or more for Sepolia |
| `LOG_LEVEL` | `info`; ship logs to a durable sink |

Never put `DATABASE_URL`, `RPC_URL` with credentials, session material, or any deployer key in a `VITE_*` variable. The front end has no use for them.

### Build and start

```bash
npm ci
npm run db:migrate
ADMIN_PASSWORD='<strong-password>' npm run create-admin -- admin@example.org "Platform Administrator"
npm run build
NODE_ENV=production COOKIE_SECURE=true SERVE_WEB=true npm start
```

`npm run build` produces:

- `apps/api/dist/index.js` (bundled API)
- `apps/web/dist/` (static React assets)

`npm start` runs the built API on `PORT` (default 4000). With `SERVE_WEB=true`, the API serves the web build and falls back to `index.html` for non-API GET routes. The SPA and the API share an origin in that mode, which keeps `SameSite=Lax` cookies simple.

Alternatively, serve `apps/web/dist` from Nginx/CDN and proxy `/api/` to the API. In that case set `SERVE_WEB=false`, keep the web and API on the same site (or configure `WEB_ORIGIN` and CORS deliberately), and ensure the browser sends the `poi_session` cookie to the API origin.

### Reverse proxy sketch

```nginx
server {
    listen 443 ssl;
    server_name impact.example.org;

    root /srv/proof-of-impact/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

Set `TRUST_PROXY=true` for this single-hop setup. If you add another proxy layer, adjust the trust setting instead of assuming the forwarded IP is genuine.

### Database and files

- Run migrations before starting a new API version. Migrations are additive; there is no automatic down-migration.
- Take a backup before deploying schema changes. Test restores periodically.
- Back up both PostgreSQL and `FILE_STORAGE_DIR`; evidence rows reference stored files, and a database-only restore leaves broken downloads.
- The audit chain is append-only. Never "fix" it with manual updates; restore from backup or document a new corrective event instead.
- Restrict filesystem permissions to the API user. Do not serve `var/uploads` directly from the web server; downloads must go through the API's authorization check.

### Scaling notes

- Rate limiting is in-process. Running multiple API instances requires a shared limiter store or upstream rate limiting.
- The audit chain serialises appends with a PostgreSQL advisory lock; this is correct across instances but serialises audit writes by design.
- Uploads are local disk. Horizontal scaling requires shared object storage and a consistent local cache, which is not implemented.
- Anchor reconciliation runs in-process on an interval (`RECONCILE_INTERVAL_MS`); multiple instances will attempt reconciliation concurrently. The database state machine is defensive, but a dedicated worker is the cleaner production design.

### Health and operations

- `GET /api/v1/health` checks database connectivity and reports the environment.
- `GET /api/v1/meta` reports chain configuration (without secrets). `contractAddress` being `null` means anchoring is unavailable.
- Logs are structured JSON through pino. Cookies, authorization headers, CSRF headers and common secret keys are redacted.
- No metrics endpoint or tracing is included.

## 3. Deploying the registry to Sepolia

These steps are **not yet performed**. Follow them only when you actually intend to deploy. Deployment costs Sepolia ETH; Sepolia ETH has no real value, but the process is a real chain interaction.

### 3.1 Prerequisites

- A dedicated deployer wallet with Sepolia ETH. Do not use a wallet holding mainnet assets.
- An RPC endpoint for Sepolia (the public endpoint in `.env.example` works for development; a paid provider is more reliable).
- A decision about the registry administrator. It can be the deployer or a separate account (`REGISTRY_ADMIN_ADDRESS`).
- A decision about the first anchoring wallet (`INITIAL_ANCHORER_ADDRESS`), typically the operator's MetaMask address. An administrator can grant the role later.

### 3.2 Configure the contract workspace

Create `contracts/.env` (git-ignored; never commit it):

```bash
SEPOLIA_PRIVATE_KEY=0x...        # deployer key, server-side only
RPC_URL=https://sepolia.example-rpc.org
REGISTRY_ADMIN_ADDRESS=0x...     # optional; defaults to the deployer
INITIAL_ANCHORER_ADDRESS=0x...   # optional; role can also be granted later
```

Rules:

- Never place `SEPOLIA_PRIVATE_KEY` in the repository `.env` used by the API, in `VITE_*`, in the browser, or in documentation.
- Never share a seed phrase with this application. It has no seed-phrase feature and never asks for one.
- Prefer a hardware wallet or a freshly generated deployer key.

### 3.3 Compile and test

```bash
npm run compile:contracts
npm run test:contracts
```

Expected current results: the contract compiles with Solidity 0.8.28 and the suite reports 13 passing tests on the ephemeral Hardhat network. If you change the ABI, regenerate the shared ABI module:

```bash
npm run export:abi
```

### 3.4 Deploy

```bash
npm run deploy:sepolia --workspace @poi/contracts
```

Equivalent direct command:

```bash
cd contracts && npx hardhat run scripts/deploy.ts --network sepolia
```

The script deploys `ProofOfImpactRegistry` with the configured administrator, waits for the deployment receipt, and prints the network, contract address, deployment transaction hash, block number, deployer and administrator. If `INITIAL_ANCHORER_ADDRESS` is set and the deployer is the administrator, it grants `ANCHOR_ROLE` to that address.

Record the output in your own deployment log. Do not add invented values to this repository. The repository's `.gitignore` ignores `contracts/deployments/localhost.json`; Sepolia deployment details are intentionally not committed.

### 3.5 Grant ANCHOR_ROLE later

If no initial anchorer was granted, use an administrator account:

```bash
cd contracts
CONTRACT_ADDRESS=0xYourRegistry ANCHORER_ADDRESS=0xOperatorWallet npx hardhat run scripts/grant-anchorer.ts --network sepolia
```

The script verifies that the signer holds `DEFAULT_ADMIN_ROLE` and refuses to proceed otherwise. Grant `ANCHOR_ROLE` only to wallets that should be able to publish commitments.

### 3.6 Configure the API

Add to the server environment (not to `VITE_*`):

```bash
CHAIN_ID=11155111
CHAIN_NAME=Sepolia
RPC_URL=https://sepolia.example-rpc.org
CONTRACT_ADDRESS=0xYourRegistry
ANCHOR_CONFIRMATIONS=2
EXPLORER_BASE_URL=https://sepolia.etherscan.io
```

Restart the API. Check:

```bash
curl http://localhost:4000/api/v1/meta
```

The response should report the configured contract address and `rpcConfigured: true`. If `contractAddress` is `null`, anchoring remains disabled and the UI states that accurately.

### 3.7 Anchor a record from the browser

1. Sign in as an administrator or the owner of the project.
2. Open a public project record eligible for anchoring (the API rejects record versions that are not newer than the last confirmed anchor).
3. Prepare the anchor. The API builds the canonical payload, computes the digest and commitment, and stores an `AWAITING_WALLET` anchor.
4. Use MetaMask to switch to Sepolia if prompted and send the transaction to the registry.
5. Submit the transaction hash to the API. It verifies the receipt, the registry address and the `RecordAnchored` event, counts confirmations, and only then marks the anchor `CONFIRMED`.
6. Re-check `/blockchain` and the project's chain tab. A confirmed anchor shows the real transaction hash and explorer link.

If anything is missing — no wallet, wrong network, reverted transaction, no matching event — the anchor remains unconfirmed with a factual state. Do not manually mark anchors confirmed in the database.

### 3.8 Verification

- `GET /api/v1/verify` and `/verify` in the UI recompute commitments and compare them with on-chain state when configured.
- Verification distinguishes `MATCH`, `MISMATCH`, `NOT_FOUND` and `VERIFICATION_ERROR`.
- A `NOT_FOUND` result for an unknown record is expected and is shown as such.
- Local digest recomputation is also exposed in anchor details; it checks the stored payload against the recorded digest and does not by itself prove on-chain presence.

### 3.9 Contract upgrades

The contract is immutable and uses no proxy. To change its logic:

1. Deploy a new registry.
2. Grant `ANCHOR_ROLE` on the new contract.
3. Update `CONTRACT_ADDRESS` on the API.
4. Keep the old contract and its events for historical verification; do not rewrite existing anchor rows.

Anchors recorded against the previous registry remain valid for that registry. The application does not silently migrate or re-point historical anchors.

## 4. Rollback and recovery

- **API/web:** redeploy the previous build. Database migrations are not automatically reversed; if a migration must be undone, write and review a forward migration instead of editing history.
- **Contract:** cannot be rolled back. Deploy a new instance and reconfigure if required.
- **Database:** restore from a verified backup. Restoring an older snapshot may discard audit events; document the incident rather than patching the chain.
- **Uploads:** restore the matching storage snapshot with the database.
- **Compromised session:** revoke the session row. For a compromised account, suspend the user and change the password (which revokes all sessions).

## 5. Production checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS enforced.
- [ ] Strong, unique `SEED_DEMO_PASSWORD` absent; `SEED_DEMO=false`/unset; demo accounts not seeded.
- [ ] `WEB_ORIGIN` limited to real HTTPS origins.
- [ ] Dedicated database role, backups, restore drill performed.
- [ ] `FILE_STORAGE_DIR` on persistent encrypted storage with restrictive permissions.
- [ ] No secrets in `VITE_*`, source control or frontend bundles.
- [ ] First administrator provisioned with a strong password; demo accounts removed/refused.
- [ ] Rate limiting appropriate for the deployment (shared store if scaled).
- [ ] Logging and alerting configured; secret redaction verified.
- [ ] Chain configuration verified via `/api/v1/meta`; anchoring disabled intentionally if no deployment.
- [ ] Independent security review completed before handling real accountability data — **not yet done**.

For failure symptoms and fixes, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
