# Engineering report

**Project:** Proof of Impact — a blockchain-based public resource accountability system
**Report date:** 26 October 2026
**Repository:** local CSE major-project implementation in this workspace
**Status:** functional full-stack demonstration; not deployed to Sepolia and not production-certified

This report records what was actually built, what was executed, and what remains incomplete. It deliberately separates demonstrated facts from design intentions. No transaction hashes, contract addresses, users, approvals or deployment results are invented.

## 1. Status at a glance

| Area | Status | Evidence |
| --- | --- | --- |
| PostgreSQL schema | Implemented and exercised | 24 domain tables + `schema_migrations`; real migrations applied to PostgreSQL 17.10 |
| REST API | Implemented | Express 5 + TypeScript; 60 documented paths / 72 operations |
| Web application | Implemented | React 19 + Vite 8.3.5; production build succeeds |
| Authentication and RBAC | Implemented | Argon2id, opaque sessions, CSRF, four server-enforced roles |
| Accountability workflows | Implemented | Projects, budgets, milestones, claims, evidence, reviews, reports, notifications, audit |
| Audit hash chain | Implemented | SHA-256 chain + append-only/immutability triggers; 56 events in the dev database |
| Solidity registry | Implemented and compiled | `ProofOfImpactRegistry`, solc 0.8.28, 13 passing contract tests |
| Sepolia deployment | **Not performed** | `CONTRACT_ADDRESS` empty; no address or transaction hash exists in this project |
| On-chain anchors | **Zero** | `blockchain_anchors` has 0 rows; UI/API report anchoring unavailable |
| Automated tests | 72 passing | 24 shared + 13 contract + 17 API integration + 18 web |
| Type checking | Passing | shared, API and web `tsc --noEmit` all pass |
| Production build | Passing with warnings | API 294.75 KB; web main JS 1,323.56 kB (395.17 kB gzip), CSS 97.36 kB (18.43 kB gzip) |
| Independent security audit | **Not performed** | No penetration test or external review |

## 2. Scope delivered

The implementation covers the master specification's accountability lifecycle rather than a static mockup:

- Public discovery: landing page, project directory with search, category/status filters, sorting, pagination, overdue filtering and public detail pages.
- Project records: identity, problem statement, objectives, location, organisations, owners, budget, milestones, status history and versioned budget history.
- Delivery evidence: milestone submissions with evidence, expenditure claims with receipts, immutable submission/claim versions, discrepancy statuses.
- Independent review: administrator-assigned reviewers, conflict notes, assignment-scoped decisions, self-review and owner-review prevention, review history that cannot be edited.
- Accountability reports: point-in-time snapshots, JSON checksum recomputation, print-oriented views and access restrictions.
- Notifications and settings: per-recipient notifications, administrator platform settings, public demonstration-data label.
- Blockchain commitments: deterministic canonical payloads, digest and domain-bound commitment construction, versioned anchors, explicit supersession, wallet submission, receipt/event verification and public verification.
- Transparency surfaces: audit trail, audit-chain verification, chain explorer page, public verification page.
- Operations: OpenAPI 3.1 document, Swagger UI, structured logs, health endpoint, migrations, demo seed, admin provisioning CLI, deployment scripts and this documentation set.

## 3. Stack and environment

### Runtime verified during this build

| Component | Version |
| --- | --- |
| Node.js | v26.3.0 |
| npm | 11.16.0 |
| PostgreSQL | 17.10 (embedded development server on `127.0.0.1:55432`) |
| Operating system | Windows, x64 (Git Bash shell) |

### Application stack

| Layer | Choices |
| --- | --- |
| Monorepo | npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `contracts` |
| Frontend | React 19.3, TypeScript 5.9.3, Vite 8.3.5, React Router 7.18, TanStack Query 5.104, React Hook Form 7.91, Recharts 3.10, Lucide React, Inter variable font |
| Backend | Express 5.3, TypeScript ESM, Zod 4.6, `pg` 8.23, pino 10 / pino-http 11, helmet 8.3, CORS, express-rate-limit 8.7, Multer 2.5, `file-type` 22.2, `@node-rs/argon2` 2.2, ethers 6.17 |
| Database | PostgreSQL 17, numbered SQL migration, `numeric(18,2)` money with ISO-4217 currency constraints |
| Contracts | Solidity 0.8.28, Hardhat 3.21, OpenZeppelin Contracts 5.6, Mocha/Ethers tests |
| Testing | Vitest 5.0.5, Supertest 7.1, Testing Library 16.3, jsdom 28 |
| API documentation | OpenAPI 3.1 + Swagger UI |

## 4. Implemented features

### 4.1 Public transparency

- Project directory only lists publicly visible projects; draft, cancelled/private/non-public cases are excluded or return `404` rather than leaking existence.
- Filters and sorting are applied server-side; pagination is capped at 100 per page.
- Public project detail exposes overview, milestones, expenditure summaries, public evidence, reviews, status/budget history and audit highlights while withholding owner/reviewer identities, restricted evidence and internal detail.
- Public claim and milestone detail pages use the same API projection as authenticated pages; restricted fields are nulled or omitted server-side.
- Verification page distinguishes `MATCH`, `MISMATCH`, `NOT_FOUND` and `VERIFICATION_ERROR`, and explicitly states that verification does not prove invoices, delivery, spending or reviewer trustworthiness.
- The blockchain page enumerates real anchor rows (currently zero) and states the exact missing configuration instead of showing a fictional contract.

### 4.2 Four roles and server-enforced separation of duties

| Role | Implemented abilities |
| --- | --- |
| Platform Administrator | Create/manage projects, users, organisations, categories and settings; assign reviewers; approve projects; manage lifecycle; review assigned records; anchor records; view audit |
| Project Owner | Edit own editable projects; submit milestones and claims; upload evidence; prepare anchors; cannot approve own project/claims; cannot review own records |
| Independent Reviewer | Review only records on projects with an active assignment; cannot review own projects; decisions are one-per-target-version and immutable |
| Public Observer | Browse public records; self-register; own profile/password/notifications only |

Authorization is re-evaluated in the API on every request. Hidden UI controls are not treated as a security boundary. Specific enforced rules include:

- Only administrators can create projects, assign reviewers, approve projects or mark them completed.
- Owner status transitions are limited to `DRAFT → SUBMITTED` and `APPROVED → IN_PROGRESS` and `IN_PROGRESS → UNDER_REVIEW`; everything else requires an administrator.
- `APPROVED` requires at least one milestone; `COMPLETED` requires all milestones approved and no pending submissions or claims.
- Returning a project to `DRAFT` or reopening a completed project requires a documented reason of at least 10 characters.
- Reviews require an active assignment, a target in a reviewable state and no existing decision for that target version; self/owner review returns `403`.
- Claim amounts are validated against the project budget and remaining claimed totals; a claim submission creates a notification and an audit event.
- Report generation is restricted to administrators, owners and assigned reviewers and creates an immutable snapshot.

### 4.3 Versioning and history

- Project budget changes are explicit versioned rows; the project carries the current amount.
- Claims and milestone submissions preserve prior versions instead of overwriting them; amendments create new versions.
- Reviews are immutable at both application and database levels.
- Project status changes have a dedicated history table with actor, reason and timestamp.
- Blockchain anchors are versioned by `recordVersion`; supersession references the active prior key and is recorded as an event.
- Audit events are append-only and chained; no endpoint updates or deletes them.

### 4.4 Evidence and reports

- Evidence uploads accept PDF, PNG, JPEG and WebP after magic-byte inspection, store random UUID filenames in dated shards with mode `0600`, and record SHA-256 checksums.
- Downloads are authorised per request and sent as attachments with `private, no-store` caching.
- Report snapshots contain the project's current accountability state and a recomputable SHA-256 checksum over canonical JSON.
- A print-optimised report view is provided; no PDF renderer is bundled.

### 4.5 Notifications and settings

- Notifications are generated for review assignments, decisions, project status changes and similar events.
- Users can mark one or all of their own notifications read; there is no cross-user access.
- Public settings expose the directory toggle and demo label; administrators see and update the full settings record.

## 5. Database

### 5.1 Tables

24 domain tables, plus `schema_migrations`:

`users`, `sessions`, `organizations`, `organization_memberships`, `project_categories`, `platform_settings`, `projects`, `project_objectives`, `project_budgets`, `project_status_history`, `milestones`, `milestone_submissions`, `expenditure_claims`, `stored_files`, `evidence`, `milestone_submission_evidence`, `expenditure_claim_evidence`, `reviewer_assignments`, `reviews`, `audit_events`, `blockchain_anchors`, `blockchain_transactions`, `notifications`, `reports`.

### 5.2 Integrity design

- Money uses `numeric(18,2)` and a three-letter uppercase currency code; amounts are non-negative where applicable. Claims use a composite foreign key on `(project_id, currency)` so claims cannot silently change currency.
- `reviews_one_decision_per_version` is a unique constraint on `(target_type, target_id, target_version)`.
- Check constraints cover status values, text lengths, version positivity, currency format, non-negative amounts and hash formats.
- Foreign keys restrict deletion of referenced projects/users; history rows are not cascade-deleted silently.
- Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events`.
- Triggers reject `UPDATE` and `DELETE` on `reviews`.
- `updated_at` triggers exist for mutable core tables.
- Migration files are applied in lexical order, recorded in `schema_migrations`, under a lock.

### 5.3 Audit chain construction

For each event:

```text
body      = canonical JSON of event fields (sorted object keys)
eventHash = SHA-256( prevHash + ":" + body )   // prevHash or 64 zeros for genesis
```

Appends acquire `pg_advisory_xact_lock(hashtext('proof_of_impact_audit_chain'))` inside the business transaction. The verification endpoint recomputes sequence, linkage and hashes and reports the first failure. The development database currently has **56 audit events, seq 1–56**.

### 5.4 Current development data

As of 26 October 2026 (after the final test run):

| Record | Count |
| --- | --- |
| Projects | 5 (4 public) |
| Users | 6 (all seeded demonstration accounts) |
| Milestones | 9 |
| Expenditure claims | 3 |
| Reviews | 3 |
| Evidence records | 6 |
| Audit events | 56 |
| Blockchain anchors | **0** |

All seeded rows are labelled demonstration data. The seed never creates anchors and refuses to run in production.

## 6. Solidity contract

File: [`contracts/contracts/ProofOfImpactRegistry.sol`](../contracts/contracts/ProofOfImpactRegistry.sol)

- Solidity 0.8.28, optimizer enabled (200 runs), `cancun` EVM target.
- Inherits OpenZeppelin `AccessControl`; `ANCHOR_ROLE` is required to anchor, `DEFAULT_ADMIN_ROLE` manages roles.
- No proxy, no upgrade path, no stored documents or personal data.
- Record types: `PROJECT` (0), `MILESTONE_SUBMISSION` (1), `REVIEW` (2), `EXPENDITURE_CLAIM` (3), `AUDIT_BATCH` (4).
- Commitment:

```text
keccak256(abi.encode(
  keccak256("PROOF_OF_IMPACT_RECORD_V1"),
  block.chainid,
  address(this),
  projectId,
  recordType,
  recordId,
  recordVersion,
  contentDigest
))
```

### Functions

| Function | Purpose |
| --- | --- |
| `canAnchor(address)` | View whether an address holds `ANCHOR_ROLE` |
| `recordKey(projectId, recordType, recordId, recordVersion)` | Deterministic per-version key |
| `logicalKey(projectId, recordType, recordId)` | Key for the logical record |
| `computeCommitment(...)` | Recompute the domain-bound commitment |
| `anchorRecord(AnchorInput)` | Role-gated append with version/supersession validation |
| `getRecord(key)` | Return the stored `AnchorRecord` |
| `recordExists(key)` | Existence check |
| `activeKey(projectId, recordType, recordId)` | Current non-superseded key |
| `verify(key, expectedCommitment)` | Compare stored and expected commitment |

### Events and errors

- Events: `RecordAnchored`, `RecordSuperseded`.
- Custom errors: `ZeroAddress`, `ZeroProjectId`, `ZeroRecordId`, `ZeroDigest`, `InvalidRecordVersion`, `InvalidRecordType`, `DuplicateRecord`, `ActiveRecordExists`, `PreviousRecordNotFound`, `PreviousRecordAlreadySuperseded`, `PreviousRecordMismatch`, `InvalidVersionProgression`.

### Verified contract results

- Latest forced compile: **Compiled 1 Solidity file with solc 0.8.28 (evm target: cancun)**.
- Contract tests: **13 passing** on the ephemeral Hardhat network.

Test coverage:

- Deployment/access control: zero-address rejection; deployer receives admin but not anchor rights; only administrators can grant/revoke.
- Commitment computation: matches the shared off-chain scheme; every field and domain separator is bound into the hash.
- Validation: invalid inputs and unknown record types are rejected; all declared record types are accepted.
- Anchoring history: immutable commitments and events; duplicate rejection; second unversioned anchor rejection; explicit supersession with the current key; stale/mismatched/non-increasing supersession rejection; project isolation; unknown record reads revert.

**No Sepolia deployment occurred.** No contract address, deployment transaction, block number or on-chain event is claimed by this report.

## 7. Blockchain integration and its honest current state

Implemented server-side:

- Canonical JSON payloads with sorted keys and `keccak256` content digests.
- Commitments bound to the registry domain, chain ID, contract address, project, record type/id, version and digest.
- Anchor preparation state machine: `AWAITING_WALLET → TRANSACTION_SUBMITTED → PENDING_CONFIRMATION → CONFIRMED`, with `FAILED` and `VERIFICATION_ERROR` paths.
- Duplicate/active-anchor conflicts and version progression checks before preparation.
- Wallet submission records the transaction hash; reconciliation fetches the receipt, requires status `1`, verifies the configured registry address and decodes the expected `RecordAnchored` event, then counts confirmations.
- Background reconciliation when `RPC_URL` and `CONTRACT_ADDRESS` are configured.
- Public verification recomputes the local digest and, when configured, compares it with on-chain state.
- UI states exactly which configuration is missing and disables anchoring; no placeholder address or fake transaction is used.

Actual current configuration reported by `GET /api/v1/meta`:

```json
{
  "chainId": 11155111,
  "chainName": "Sepolia",
  "contractAddress": null,
  "rpcConfigured": true,
  "explorerBaseUrl": "https://sepolia.etherscan.io",
  "requiredConfirmations": 2,
  "anchoringAvailable": false
}
```

Consequences:

- `/blockchain` shows **0 commitments** and an unavailable-anchoring notice citing the missing registry address.
- Record detail tabs state that anchoring is unavailable; no transaction CTA is enabled.
- `/verify` returns `NOT_FOUND` for unanchored records; this is displayed as a factual result, not a failure that implies truth or fraud.
- The audit chain remains internally verifiable but has no external on-chain head.

## 8. API surface

60 paths / **72 operations** (paths relative to `/api/v1`), all represented in the OpenAPI document served at `/api/v1/openapi.json` and browsable at `/api/docs`. Access below summarises the enforced policy; authentication is session-based.

### System

`GET /health`, `GET /meta`, `GET /openapi.json` — public.

### Auth

`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`.

### Projects and categories

`GET /projects`, `POST /projects`, `GET /projects/{projectId}`, `PATCH /projects/{projectId}`, `PATCH /projects/{projectId}/status`, `PATCH /projects/{projectId}/budget`, `GET /projects/{projectId}/status-history`, `GET /projects/{projectId}/budget-history`, `GET /projects/{projectId}/reviewers`, `POST /projects/{projectId}/reviewers`, `GET /projects/{projectId}/eligible-reviewers`, `DELETE /projects/{projectId}/reviewers/{assignmentId}`, `GET /stats/overview`, `GET /categories`, `POST /categories`, `PATCH /categories/{id}`.

### Milestones

`GET /projects/{projectId}/milestones`, `POST /projects/{projectId}/milestones`, `GET /milestones/{milestoneId}`, `PATCH /milestones/{milestoneId}`, `POST /milestones/{milestoneId}/start`, `POST /milestones/{milestoneId}/submit`, `GET /milestones/{milestoneId}/submissions`.

### Expenditure claims

`GET /projects/{projectId}/claims`, `POST /projects/{projectId}/claims`, `GET /claims/{claimId}`, `POST /claims/{claimId}/amend`, `GET /claims/{claimId}/versions`.

### Evidence

`GET /projects/{projectId}/evidence`, `POST /projects/{projectId}/evidence`, `GET /evidence/{evidenceId}/download`.

### Reviews

`GET /projects/{projectId}/reviews`, `GET /reviews/queue`, `POST /reviews`.

### Reports

`POST /projects/{projectId}/reports`, `GET /reports`, `GET /reports/{reportId}`.

### Audit

`GET /projects/{projectId}/audit`, `GET /audit`, `GET /audit/integrity`.

### Blockchain and verification

`GET /anchors`, `GET /anchors/chain-info`, `POST /anchors/prepare`, `GET /anchors/{anchorId}`, `POST /anchors/{anchorId}/transaction`, `POST /anchors/{anchorId}/reconcile`, `POST /verify`, `GET /verify/{anchorId}`.

### Notifications

`GET /notifications`, `PATCH /notifications/{notificationId}/read`, `POST /notifications/read-all`.

### Administration

`GET /settings`, `GET /admin/settings`, `PATCH /admin/settings`, `GET /users`, `POST /users`, `GET /users/reviewers`, `PATCH /users/{id}`, `GET /organizations`, `POST /organizations`, `PATCH /organizations/{id}`, `GET /organizations/{id}/members`, `POST /organizations/{id}/members`, `DELETE /organizations/{id}/members/{userId}`.

Requests are validated with Zod; errors use a stable `{ error: { code, message, details?, requestId } }` shape. Pagination metadata is returned for collections. Detailed access rules and request bodies are in [ARCHITECTURE.md](ARCHITECTURE.md) and the OpenAPI document.

## 9. Security implementation

A full account is in [SECURITY.md](SECURITY.md). Key verified controls:

- Argon2id (`memoryCost 19456`, `timeCost 2`, `parallelism 1`), 10–128 character password policy.
- Opaque 32-byte session tokens stored only as SHA-256 hashes; `HttpOnly`, `SameSite=Lax`, optional `Secure`; 12-hour default TTL; session revocation on logout and all-session revocation on password change.
- CSRF double-submit token bound to the session, compared in constant time; origin allowlist for all mutating requests.
- Server-enforced roles and project-level access matrix; self-review and unassigned review rejected.
- File type detection by magic bytes, randomised storage names, path traversal rejection, restrictive file mode, authorised downloads.
- Append-only audit and immutable review triggers.
- No server-side blockchain private key; wallet signing occurs in the browser; receipt and event verification before confirmation.
- Secrets only in server environment; no secrets in `VITE_*`; demo seeding blocked in production; no default password.
- Helmet CSP/headers, CORS allowlist, bounded JSON and upload payloads, rate limits and structured logs with redaction.

## 10. Verification results

### 10.1 Type checking

Command: `npm run typecheck`
Result: **pass** for `@poi/shared`, `@poi/api` and `@poi/web` (26 October 2026).

### 10.2 Automated tests

Command: `npm test` (final run 26 October 2026, after fixing an intermittent testing-library timeout)
Result: **72 passing, 0 failing**

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| Shared logic | 3 | 24 | pass |
| Solidity contract | 1 | 13 | pass |
| API integration (real PostgreSQL) | 1 | 17 | pass |
| Web components/pages | 4 | 18 | pass |

The API integration suite creates an isolated `proof_of_impact_test` database, applies real migrations and exercises:

- Self-registration cannot choose a role; unauthenticated writes are rejected.
- Administrator-only project creation; drafts remain hidden.
- Approval requires a milestone; owners cannot approve; private projects remain hidden.
- Evidence magic-byte validation, randomised storage and restricted-file protection.
- Milestone submission and assigned-reviewer decisions.
- Budget rules and reviewer independence for expenditure claims.
- Participant-only, immutable report snapshots with verifiable checksums.
- Password changes require the current password, revoke sessions and store Argon2id hashes.
- Public-directory settings gate listing but not direct public pages.
- Administrator user management is server-enforced.

The contract tests run on an in-memory EDR network, not Sepolia.

### 10.3 Build

Command: `npm run build`
Result: **success with two size-related warnings**

| Artifact | Size |
| --- | --- |
| `apps/api/dist/index.js` | 294.75 KB (source map 558.36 KB) |
| `apps/web/dist/index-*.js` | 1,323.56 KB, gzip 395.17 KB (map 6,270.64 KB) |
| `apps/web/dist/index-*.css` | 97.36 KB, gzip 18.43 kB |
| Web modules transformed | 2,861 |
| Vite build duration | 12.80 s |

Warnings:

1. The main web chunk exceeds 1,100 KB; code splitting is not implemented.
2. Vite reports an ineffective dynamic import of ethers because `packages/shared` imports it statically.

Both are performance issues, not build failures.

### 10.4 Contract compile

Command: `npx hardhat compile --force`
Result: **Compiled 1 Solidity file with solc 0.8.28 (evm target: cancun)**.

### 10.5 Manual browser checks

Verified in the running application through browser automation accessibility snapshots and DOM measurements (not screenshots; the automation environment could not capture a native screenshot):

- Landing page renders; public project directory loads real seeded projects.
- Directory filter `?q=water&status=IN_PROGRESS` returned one matching project.
- Project detail tabs (overview, milestones, expenditure, evidence, reviews, activity/audit, chain) opened without error.
- Public/anonymous claim detail works; restricted evidence is withheld with an explanatory message.
- Public views display withheld identity labels rather than "Unknown user"; a check found 5 withheld labels and 0 "Unknown user" strings.
- `/verify` produces an explicit empty state and a factual `NOT_FOUND` result for an unanchored project code; it does not claim a match.
- `/blockchain` shows 0 commitments and reports anchoring unavailable because no registry address is configured (RPC is configured); no placeholder data is shown.
- Swagger UI at `/api/docs` returns HTTP 200 and exposes the documented endpoints.
- `/dashboard` redirects an anonymous visitor to sign-in; route guards show a restriction notice for mismatched roles.
- Mobile navigation overlay was exercised at the automation viewport (638×570); no horizontal overflow was measured.

Not done in the browser: signing in with the seeded demonstration accounts. The seed password was intentionally not extracted into the browser session to avoid exposing a credential. Authenticated behavior is covered by the API integration suite and route-guard component tests, not by an authenticated browser walkthrough. Anchoring was not exercised in a browser because no deployment exists.

## 11. Honest deployment status

- The Solidity registry has **not** been deployed to Sepolia or any public network.
- `CONTRACT_ADDRESS` is empty. No contract address is published in this repository or UI.
- There are **zero** blockchain anchors and **zero** anchor transactions.
- No transaction hash, block number, confirmation count or on-chain event is reported as real.
- The API and UI report anchoring as unavailable; the verification endpoints return `NOT_FOUND` for records with no anchor.
- The only execution of the contract is the ephemeral Hardhat test network during `npm run test:contracts`.
- The project does not claim that blockchain anchoring proves truth, completion, payment or reviewer independence.

Deployment instructions, including how to perform a real Sepolia deployment and the configuration changes required afterwards, are in [DEPLOYMENT.md](DEPLOYMENT.md). Compliance with those steps would produce new, real values that must be recorded by the operator; none are fabricated here.

## 12. Limitations and known gaps

### Functional

- No email verification, self-service password reset, multi-factor authentication, account deletion or user-facing session management.
- Reviewer independence is enforced by assignment and ownership rules, not by an external conflict-of-interest registry.
- Reports are immutable snapshots rendered for print; no server-side PDF generation or digital signature.
- Project creation is administrator-only; there is no owner application workflow.
- No email/SMS delivery for notifications; they are in-app only.
- No bulk import/export or public data API beyond the documented REST endpoints.
- Public observers cannot comment, follow projects or file disputes.

### Blockchain

- No deployment, so the wallet integration has not been validated against a real Sepolia transaction end-to-end.
- No automated Sepolia test; contract tests only cover the ephemeral network.
- No chain reorg handling beyond surfacing missing receipts/verification errors; confirmation depth is the configured mitigation.
- The registry is not upgradeable; logic changes require a new deployment and explicit configuration change.
- On-chain data is limited to commitments; documents remain off-chain and depend on platform availability.

### Security and operations

- No independent security audit, penetration test, fuzzing or dependency-audit report is included.
- Rate limiting is in-process and assumes one API instance.
- Evidence is stored on local disk with no malware scanning, encryption at rest, object storage or signed URLs.
- The audit chain is tamper-evident only within PostgreSQL until a head is anchored; a database superuser could rewrite it.
- No metrics/tracing/alerting stack; logs are structured but must be shipped by an operator.
- No backups, restore drills or disaster recovery automation are included.
- No CSRF token rotation during a session; token lifetime matches the session.

### Frontend and quality

- The web bundle is a single large chunk with a size warning; no route-level code splitting.
- No screenshot-based visual regression or cross-browser E2E suite.
- No formal accessibility audit; semantic markup and keyboard focus styles are implemented but not certified.
- The authenticated UI was not exercised end-to-end in a browser during this verification; API and component tests cover the rules.

### Deployment

- No production deployment exists. No domain, TLS certificate, managed database, object storage, monitoring or CI/CD pipeline was provisioned.
- No CI configuration is included; commands were run locally.
- No load, soak or concurrency testing beyond the test suite's transactional checks.

## 13. How to run

See the [README](../README.md) for prerequisites, environment setup, demo accounts, commands and URLs, and [DEPLOYMENT.md](DEPLOYMENT.md) for production/Sepolia procedures. The shortest local path:

```bash
npm install
cp .env.example .env      # set SEED_DEMO_PASSWORD and review DATABASE_URL
npm run dev:db            # terminal 1
npm run db:setup          # terminal 2
npm run dev               # terminal 3
```

Web: <http://localhost:5173> — API: <http://localhost:4000/api/v1> — Swagger: <http://localhost:4000/api/docs>.

## 14. Conclusion

This repository contains a working, tested implementation of the specified accountability platform: a real PostgreSQL-backed API, a role-aware React front end, an append-only audit chain, a compiled and tested Solidity registry, a complete MetaMask transaction-verification path, and documentation aligned with the code.

It does **not** contain a Sepolia deployment or any on-chain anchor. It is suitable as a CSE major-project demonstration and as a foundation for further work, but it is not a certified government transparency system, a financial audit system, or a legal record. Any claim of production readiness would require deployment, independent security review, operational hardening and real-world validation that have not been performed.
