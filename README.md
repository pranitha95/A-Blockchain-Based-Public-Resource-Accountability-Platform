# Proof of Impact

A full-stack public resource accountability platform. Projects, milestones, evidence, reviewed expenditure claims and versioned blockchain commitments are exposed through a versioned REST API with a React front end, a real PostgreSQL schema and a Solidity registry contract for Ethereum Sepolia.

> **Blockchain status (26 October 2026):** the registry contract is implemented, compiles and passes 13 contract tests on an ephemeral Hardhat network. It has **not** been deployed to Sepolia, no contract address is configured, and the development database contains **zero** blockchain anchors. The API and UI report anchoring as unavailable instead of inventing a deployment, transaction or confirmation. See [docs/ENGINEERING_REPORT.md](docs/ENGINEERING_REPORT.md).

> **What an anchor can and cannot prove.** A confirmed anchor proves that a specific record digest was committed to the registry contract at a point in time. It does not prove that a document is genuine, that work was completed, that a supplier was paid, or that a reviewer is trustworthy. Approved claims are review decisions, not proof of payment.

## What is implemented

- Public project directory with search, category/status filters, sorting and overdue filtering.
- Project detail with overview, milestones, expenditure, evidence, independent reviews, audit activity and chain anchors.
- Four server-enforced roles: Platform Administrator, Project Owner, Independent Reviewer, Public Observer.
- Owner-submitted milestone completions and expenditure claims with mandatory independent review.
- Reviewer assignments with conflict notes, self-review and owner-review prevention, and assignment-scoped decisions.
- Append-only SHA-256 audit hash chain, with database triggers that reject updates, deletes and truncation.
- Versioned budgets, claims and project records; immutable review decisions; explicit discrepancy handling.
- Evidence uploads with magic-byte type detection, randomised storage names, SHA-256 checksums and public/restricted visibility.
- Accountability report snapshots with a recomputable SHA-256 checksum over canonical JSON.
- Deterministic on-chain commitment construction, explicit supersession, wallet submission, receipt reconciliation and public verification.
- OpenAPI 3.1 document and Swagger UI at `/api/docs`.
- Automated tests across shared logic, Solidity, the API and the web application.

## Architecture

```
React 19 + Vite (apps/web)
        |
        |  /api/v1 (cookie session + CSRF)
        v
Express 5 + Zod + pino (apps/api)
        |
        +---- PostgreSQL 17 (database/migrations)
        |
        +---- Sepolia JSON-RPC (read verification, receipt reconciliation)
                       ^
                       | anchorRecord() signed by MetaMask
                       |
              Authorised operator browser
```

The API never holds a blockchain private key. A permitted owner or administrator prepares a deterministic commitment server-side; an authorised wallet signs and submits the transaction in the browser; the API records the hash, verifies the receipt and the registry event, and only then marks the anchor confirmed.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React 19, TypeScript, Vite, TanStack Query, React Router |
| `apps/api` | Express 5, TypeScript, PostgreSQL access, sessions, CSRF, uploads, OpenAPI |
| `packages/shared` | Shared Zod schemas, domain types, money formatting, role capabilities, commitment helpers, registry ABI |
| `contracts` | Solidity registry, Hardhat configuration, deployment and role-grant scripts, Mocha/Ethers tests |
| `database/migrations` | Numbered SQL migrations applied by the API |
| `docs` | Architecture, security, deployment, troubleshooting and the engineering report |
| `var` | Development PostgreSQL data, uploads and test artifacts (ignored) |

## Prerequisites

- Node.js 22 or newer (verified on Node 26.3.0) and npm 10 or newer.
- PostgreSQL 16 or newer. The development helper embeds PostgreSQL 17; a separately managed instance is recommended for production.
- A modern browser. MetaMask or another injected EIP-1193 wallet is needed only for on-chain anchoring.

## Quick start

```bash
npm install
cp .env.example .env
```

Edit `.env`:

1. Set `SEED_DEMO_PASSWORD` to a strong development password (at least 10 characters, including a letter and a number). Do not reuse it anywhere real.
2. Review `DATABASE_URL`. The template points at the embedded development database on port 55432.
3. Leave `CONTRACT_ADDRESS` empty unless you have actually deployed the registry.

Then start PostgreSQL in one terminal:

```bash
npm run dev:db
```

Apply migrations and seed the labelled demonstration dataset in a second terminal:

```bash
npm run db:setup
```

Start the API and web app:

```bash
npm run dev
```

- Web application: <http://localhost:5173>
- API root: <http://localhost:4000/api/v1>
- Health: <http://localhost:4000/api/v1/health>
- OpenAPI JSON: <http://localhost:4000/api/v1/openapi.json>
- Swagger UI: <http://localhost:4000/api/docs>

The demo seed refuses to run in production, never creates blockchain anchors, and marks every seeded account, project and file as demonstration data. Seeded accounts share the `SEED_DEMO_PASSWORD` you set; there is no built-in default in the application.

### Demonstration accounts

| Role | Email |
| --- | --- |
| Platform administrator | `admin@demo.proofofimpact.test` |
| Project owner | `meera.iyer@demo.proofofimpact.test` |
| Project owner | `arjun.deshmukh@demo.proofofimpact.test` |
| Independent reviewer | `ananya.menon@demo.proofofimpact.test` |
| Independent reviewer | `rohan.gupta@demo.proofofimpact.test` |
| Public observer | `samira.khan@demo.proofofimpact.test` |

All six use the `SEED_DEMO_PASSWORD` from your local `.env`. Credentials are never printed by the seed or displayed by the application.

### Using an existing PostgreSQL server

```bash
createdb proof_of_impact
# Set DATABASE_URL=postgres://user:password@host:5432/proof_of_impact in .env
npm run db:migrate
npm run db:seed        # development/demonstration only
```

The seed requires `SEED_DEMO=true` and a `SEED_DEMO_PASSWORD`; it is rejected when `NODE_ENV=production`.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and web dev servers together |
| `npm run dev:db` | Start the embedded PostgreSQL 17 development server |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Seed demonstration data (development only) |
| `npm run create-admin` | Provision an initial administrator from `ADMIN_PASSWORD` |
| `npm run build` | Build the API bundle and the web production assets |
| `npm start` | Run the built API |
| `npm run typecheck` | Typecheck shared, API and web workspaces |
| `npm test` | Run shared, contract, API and web tests |
| `npm run test:contracts` | Run the Solidity test suite on an ephemeral Hardhat network |
| `npm run compile:contracts` | Compile the Solidity contract |
| `npm run export:abi` | Regenerate the shared registry ABI module |

The full suite currently reports **72 passing tests**: 24 shared, 13 contract, 17 API integration and 18 web tests.

The API integration suite is a real database test. It derives an isolated `proof_of_impact_test` database from `DATABASE_URL`, drops and recreates it, runs the real migrations, disables rate limiting, clears chain configuration and removes test uploads. PostgreSQL must be running. Point `DATABASE_URL` at a development or test cluster only.

## Configuration

All server configuration is read from environment variables. See `.env.example` for the complete documented template. Secrets must remain server-side; only `VITE_*` values are exposed to the browser, and the project deliberately exposes none.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `WEB_ORIGIN` | Comma-separated allowed browser origins for CORS and origin checks |
| `COOKIE_SECURE` | Send cookies over HTTPS only; enable in production |
| `TRUST_PROXY` | Honour one trusted proxy hop for client IPs |
| `DEMO_MODE` | Show demonstration-data labels |
| `SEED_DEMO` | Allow demonstration seeding; rejected in production |
| `SEED_DEMO_PASSWORD` | Shared password for demo accounts only |
| `CHAIN_ID`, `CHAIN_NAME`, `RPC_URL` | Network used for verification and reconciliation |
| `CONTRACT_ADDRESS` | Deployed registry address; empty means anchoring unavailable |
| `ANCHOR_CONFIRMATIONS` | Confirmations required before an anchor is marked confirmed |
| `SERVE_WEB`, `WEB_DIST_PATH` | Optionally serve the built web app from the API |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, request lifecycle, roles, workflows, data model and API inventory.
- [Security](docs/SECURITY.md) — authentication, authorization, visibility, uploads, audit integrity and key handling.
- [Deployment](docs/DEPLOYMENT.md) — local, production and Sepolia/MetaMask procedures.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common local and chain configuration failures.
- [Engineering report](docs/ENGINEERING_REPORT.md) — implemented scope, actual test/build results, deployment status and limitations.

## Limitations

- No Sepolia deployment has been performed. Contract address, transaction hashes and confirmations are intentionally absent.
- There is no email verification, self-service password reset, multi-factor authentication or account deletion.
- Rate limiters are in-process and assume a single API instance; a shared store is required for horizontal scaling.
- Evidence is stored on the local filesystem, without malware scanning, object storage or signed URLs.
- The audit hash chain detects tampering inside the database it protects; it becomes independently tamper-evident only when its head is anchored on-chain.
- Printed accountability reports are browser print views; no PDF renderer is bundled.
- The web bundle is currently a single large chunk with a Vite size warning; code splitting is a future optimisation.

This is a CSE major project. It is not a certified government transparency system, a legal record, or a financial audit.
