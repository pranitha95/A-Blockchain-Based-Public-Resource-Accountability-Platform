# Architecture

## 1. System context

Proof of Impact is an npm-workspaces monorepo with four executable concerns:

| Component | Technology | Responsibility |
| --- | --- | --- |
| Web application | React 19, TypeScript, Vite, React Router, TanStack Query | Public discovery, role-aware workspaces, wallet interaction, print/report views |
| API | Express 5, TypeScript, Zod, pg, pino | Versioned REST API, sessions, CSRF, authorization, workflows, audit chain, OpenAPI |
| Database | PostgreSQL 17 | Normalized records, version history, review immutability, audit chain persistence |
| Registry contract | Solidity 0.8.28, OpenZeppelin AccessControl | Versioned commitments and explicit supersession on Ethereum Sepolia |

Shared TypeScript modules hold the domain enums, Zod request schemas, role capabilities, money formatting, commitment construction and the generated registry ABI. The API and web app therefore agree on validation and commitment rules without duplicating them.

## 2. Runtime topology

```
Browser
  |  HTTPS / cookies (poi_session, poi_csrf)
  v
Reverse proxy (TLS, optional)
  |
  v
Express API ---- pg pool ---- PostgreSQL
  |                              |
  |  JSON-RPC (read-only)        +-- audit_events (append-only)
  |                              +-- reviews (immutable)
  v
Sepolia RPC
  ^
  |  anchorRecord() signed in the browser
  |
MetaMask / injected wallet
```

- The API reads chain state to verify receipts and registry events.
- The API never holds a wallet key and cannot sign.
- The browser constructs the contract call from server-prepared bytes32 arguments, and MetaMask signs it.
- The API records the transaction hash, verifies the receipt and the expected `RecordAnchored` event, then updates the anchor state.

## 3. API request pipeline

Defined in `apps/api/src/app.ts`:

1. `attachRequestId` — accepts or creates a request id, echoed in logs and errors.
2. `pino-http` — structured request logging; health checks excluded.
3. `helmet` — CSP, no-referrer, frame denial, MIME sniffing protection and related headers.
4. `cors` — credentials allowed only for configured `WEB_ORIGIN` values.
5. JSON body parsing (1 MB API body limit) and cookie parsing.
6. General API rate limit (300 requests/minute).
7. `loadSession` — resolves the opaque session cookie to a server-side session and active user.
8. `csrfProtection` — validates the `Origin` header when present, then requires `X-CSRF-Token` on authenticated unsafe methods.
9. Versioned routers mounted under `/api/v1`.
10. `/api/docs` Swagger UI and `/api/v1/openapi.json`.
11. Centralized not-found and error handlers with codes, request ids and non-production details.

Validation uses Zod at the boundary. SQL is parameterized. Responses use one success/error envelope shape.

## 4. Roles and separation of duties

Capabilities are defined once in `packages/shared/src/permissions.ts` and enforced again in the API; the frontend uses them only to hide impossible actions.

| Capability | Administrator | Project Owner | Independent Reviewer | Public Observer |
| --- | --- | --- | --- | --- |
| Manage users, organisations, categories, settings | Yes | No | No | No |
| Create and approve projects, assign reviewers | Yes | No | No | No |
| Edit owned project records | No (not an owner) | Yes (owned, editable states) | No | No |
| Submit milestones and expenditure claims | No | Yes (owned) | No | No |
| Record review decisions | No | No | Yes, only while actively assigned and independent | No |
| Prepare anchors | Yes | Yes (owned) | No | No |
| View internal audit history | Yes | Yes (participant) | Yes (participant) | No |
| Submit to the public directory / public pages | Yes | Yes | Yes | Read-only |

Additional server rules:

- An owner cannot review any record on their own project.
- A reviewer cannot review a project they own or a record they submitted.
- Reviewer eligibility excludes inactive accounts and existing conflicts.
- Only administrators assign or remove reviewers.
- Review decisions require an active assignment at decision time, not just at page load.
- Administrators cannot submit claims or review records; owners cannot approve projects.
- Browser-supplied roles are ignored at registration and never used for authorization.

## 5. Domain workflows

### 5.1 Project lifecycle

Statuses: `DRAFT`, `SUBMITTED`, `APPROVED`, `IN_PROGRESS`, `UNDER_REVIEW`, `COMPLETED`, `SUSPENDED`, `CANCELLED`.

Administrator transitions:

| From | To |
| --- | --- |
| DRAFT | SUBMITTED, CANCELLED |
| SUBMITTED | DRAFT, APPROVED, CANCELLED |
| APPROVED | IN_PROGRESS, SUSPENDED, CANCELLED |
| IN_PROGRESS | UNDER_REVIEW, COMPLETED, SUSPENDED, CANCELLED |
| UNDER_REVIEW | IN_PROGRESS, COMPLETED, SUSPENDED, CANCELLED |
| COMPLETED | UNDER_REVIEW |
| SUSPENDED | IN_PROGRESS, UNDER_REVIEW, CANCELLED |
| CANCELLED | none |

Owner transitions are deliberately narrower: `DRAFT → SUBMITTED`, `APPROVED → IN_PROGRESS`, `IN_PROGRESS → UNDER_REVIEW`.

Guards:

- Approval requires at least one milestone.
- Completion requires every milestone approved and no pending submissions or claims.
- Returning a project to `DRAFT`, or reopening a completed project, requires a documented reason of at least 10 characters.
- Every transition writes version history and an audit event.

Visibility:

- `DRAFT` and `SUBMITTED` are never in the public directory.
- `APPROVED` (and later statuses) appear publicly only when `visibility = PUBLIC`.
- `PRIVATE` approved projects are hidden from the public directory and anonymous direct access.
- A public direct project page may still be reachable when the public directory listing is administratively disabled.
- Owner names, submitter names, reviewer names and restricted evidence are withheld from public projections.

### 5.2 Milestones

`PLANNED → IN_PROGRESS → SUBMITTED → APPROVED` or back to `IN_PROGRESS`/`REJECTED` through review.

- Only the project owner or an administrator creates milestones.
- Only the owner starts a milestone; starting the first milestone on an approved project advances the project to `IN_PROGRESS`.
- Only the owner submits completion with a summary and at least one evidence item.
- Submission moves the milestone to `SUBMITTED` and creates a review queue item.
- One decision is allowed per submission version.
- Approval marks the submission and milestone approved; `CHANGES_REQUESTED` and `REJECTED` return it to the owner; `DISCREPANCY_OPENED` records a disputed submission while the milestone returns to `IN_PROGRESS`.

### 5.3 Expenditure claims

Statuses: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `DISPUTED`.

- Owners submit claims to their projects; administrators cannot.
- Amounts are decimal strings in PostgreSQL `NUMERIC`, never JavaScript floats.
- A claim that would take the project's recorded claims above the approved budget requires an explanation of at least 20 characters and is flagged `over_budget`.
- Claims are versioned. Amendments create a new current claim and preserve earlier versions; approved claims cannot be silently edited.
- The same reviewer rules apply: active assignment, no self-review, no owner review, one decision per version.
- `APPROVED` is a review decision, not a payment confirmation and not proof that an invoice is genuine.

### 5.4 Reports

- Report generation is limited to project participants.
- A report is a point-in-time JSON or PRINT snapshot containing project, budget, milestone, claim, review, anchor and disclaimer data.
- A SHA-256 checksum is computed over canonical JSON of the snapshot and stored with it.
- The checksum can be recomputed by anyone with the snapshot; it proves byte integrity of that snapshot, not truthfulness of the contents.

## 6. Data model

One numbered migration creates 24 tables plus enums, constraints, indexes and triggers (`database/migrations/001_initial_schema.sql`).

### Identity and platform

- `users` — email, Argon2id password hash, role, status, demonstration flag.
- `sessions` — hashed session token, hashed CSRF token, expiry, revocation, IP, user agent.
- `organizations`, `organization_memberships` — organisations and membership roles.
- `project_categories` — active project categories.
- `platform_settings` — public-directory toggle, demonstration-data display, platform name, support contact.
- `notifications` — per-user notifications with read state and dedupe keys.

### Projects and planning

- `projects` — identity, status, visibility, owner, organisation, budget `NUMERIC`, currency, version, demonstration flag.
- `project_objectives` — ordered objective text.
- `project_budgets` — versioned budget history with reason and actor.
- `project_status_history` — every status transition, reason and actor.
- `milestones` — sequence, allocation, planned/actual dates, status, version.

### Delivery and accountability

- `milestone_submissions` — versioned completion declarations linked to milestones.
- `expenditure_claims` — versioned claims, supplier fields, over-budget flag and explanation, status.
- `stored_files` — original name, storage name, MIME type, size, SHA-256, uploader.
- `evidence` — metadata, visibility and project ownership.
- `milestone_submission_evidence`, `expenditure_claim_evidence` — evidence links.
- `reviewer_assignments` — assignment, conflict note and active/removed state.
- `reviews` — immutable decisions with target type, target version, reviewer and rationale.

### Integrity and chain

- `audit_events` — global sequence, actor, action, entity, metadata, record version, correlation id, `prev_hash`, `event_hash`.
- `blockchain_anchors` — record identity, version, canonical payload, content digest, commitment, record key, previous key, status, chain id, contract address, transaction hash, block number, confirmation time, failure reason.
- `blockchain_transactions` — every submitted transaction hash per anchor with sender and outcome.
- `reports` — generated snapshot, format, checksum, source version and generator.

### Invariants

- Money columns are `NUMERIC(18,2)`; currencies are explicit three-letter codes.
- Unique constraints cover project codes, claim references, record keys and audit sequence.
- `audit_events` rejects `UPDATE`, `DELETE` and `TRUNCATE` through database triggers.
- `reviews` rejects `UPDATE` and `DELETE`; a correction is a new record/version, never an edited decision.
- Record versions increase; supersession links are explicit.
- Demonstration records carry `is_demo` and are labelled in the UI.

## 7. Authentication and session design

- Passwords are hashed with Argon2id (memory 19,456 KiB, time cost 2, parallelism 1).
- Sessions are opaque random 32-byte tokens. Only the SHA-256 token hash is stored.
- The session cookie `poi_session` is HttpOnly, SameSite=Lax, path `/`, and Secure when configured.
- The readable `poi_csrf` cookie is not the session secret; it supplies the token echoed in `X-CSRF-Token`.
- The server stores only the SHA-256 CSRF hash and compares in constant time.
- Session lookup rejects expired, revoked and suspended/inactive users.
- Password change verifies the current password, rehashes, and revokes all sessions.
- Login returns a generic invalid-credentials error; password verification always performs work to reduce account enumeration timing differences.
- Registration always creates an `OBSERVER`, regardless of request body.

## 8. Audit hash chain

For each event:

```
body = { seq, projectId, actorId, actorRole, action, entityType, entityId,
         summary, metadata, recordVersion, correlationId, createdAt }
event_hash = SHA-256( (prev_hash or 64 zeros) + ":" + canonicalJson(body) )
```

- An advisory transaction lock serializes append operations.
- `prev_hash` links each row to the previous event hash.
- `GET /api/v1/audit/integrity` recomputes the whole chain and reports the head and count.
- Public viewers receive a filtered projection; reviewer-assignment and restricted-evidence events are omitted from public output.
- The integrity endpoint demonstrates internal consistency. It cannot make a centralized database independently tamper-proof; only periodically anchoring the chain head would provide external evidence.

## 9. Blockchain commitment design

Shared helpers (`packages/shared/src/commitments.ts`):

```
contentDigest = keccak256(utf8(canonicalJson(recordPayload)))
commitment    = keccak256(abi.encode(
                  keccak256("PROOF_OF_IMPACT_RECORD_V1"),
                  chainId,
                  registryAddress,
                  projectIdBytes32,
                  recordTypeCode,
                  recordIdBytes32,
                  recordVersion,
                  contentDigest
                ))
recordKey     = keccak256(abi.encode(projectId, recordType, recordId, recordVersion))
```

- UUIDs are converted to bytes32 with `keccak256(utf8(canonicalUuid))`.
- Canonical JSON sorts object keys, omits `undefined` and rejects non-finite numbers.
- The registry checks the domain, chain id and its own address, so a commitment from another network/contract cannot verify.
- A record version can have at most one current commitment.
- A superseding transaction must reference the current active record key; mismatches, stale keys and non-increasing versions revert.
- Event history is append-only; nothing is deleted or rewritten on-chain.

Anchor states:

`AWAITING_WALLET → TRANSACTION_SUBMITTED → PENDING_CONFIRMATION → CONFIRMED`, with `FAILED` or `VERIFICATION_ERROR` where appropriate.

The API only marks `CONFIRMED` after it observes the receipt and the expected registry event with the expected commitment and confirmations. A submitted transaction hash is never treated as confirmation.

## 10. Frontend architecture

- `AppShell` provides skip link, responsive navigation, notifications count, role-aware links, footer disclaimers.
- `AuthProvider` bootstraps `/auth/me`; `RequireAuth`, `RequireRole`, and `RedirectIfAuthenticated` guards handle routing.
- TanStack Query owns server state, with query-key namespaces and invalidation after mutations.
- Public pages: landing, project directory, project detail tabs, claim detail, blockchain explorer, anchor detail and verification studio.
- Authenticated pages: dashboard, review queue, review detail, reports and report detail, notifications, settings, administration.
- Public detail pages intentionally render "withheld" labels where the API nulls identities or restricted files.
- Verification presents stored payload digest, recorded content digest, on-chain digest, stored commitment and on-chain commitment separately; unavailable comparisons are labelled "Not compared".
- Print/report views use the browser print stylesheet.

## 11. API inventory (`/api/v1`)

### System

| Method | Path | Access |
| --- | --- | --- |
| GET | `/health` | Public |
| GET | `/meta` | Public |
| GET | `/openapi.json` | Public |

### Authentication

| Method | Path | Access |
| --- | --- | --- |
| POST | `/auth/register` | Public, rate-limited |
| POST | `/auth/login` | Public, rate-limited |
| POST | `/auth/logout` | Authenticated |
| GET | `/auth/me` | Public (returns `null` when signed out) |
| POST | `/auth/change-password` | Authenticated |

### Projects and participation

| Method | Path | Access |
| --- | --- | --- |
| GET | `/projects` | Public directory, role-filtered |
| POST | `/projects` | Administrator |
| GET | `/projects/:projectId` | Public/participant projection |
| PATCH | `/projects/:projectId` | Owner or administrator |
| PATCH | `/projects/:projectId/status` | Transition rules by role |
| PATCH | `/projects/:projectId/budget` | Owner or administrator |
| GET | `/projects/:projectId/status-history` | Public-safe projection |
| GET | `/projects/:projectId/budget-history` | Public-safe projection |
| GET | `/projects/:projectId/reviewers` | Authenticated participant |
| GET | `/projects/:projectId/eligible-reviewers` | Administrator |
| POST | `/projects/:projectId/reviewers` | Administrator |
| DELETE | `/projects/:projectId/reviewers/:assignmentId` | Administrator |
| GET | `/projects/:projectId/milestones` | Public/participant projection |
| POST | `/projects/:projectId/milestones` | Owner or administrator |
| GET | `/projects/:projectId/claims` | Public/participant projection |
| POST | `/projects/:projectId/claims` | Owner |
| GET | `/projects/:projectId/evidence` | Public/participant projection |
| POST | `/projects/:projectId/evidence` | Participant with submission rights |
| GET | `/projects/:projectId/reviews` | Public/participant projection |
| POST | `/projects/:projectId/reports` | Participant |
| GET | `/projects/:projectId/audit` | Participants only |
| GET | `/stats/overview` | Role-scoped |
| GET | `/categories` | Public (administrators may include inactive categories) |
| POST | `/categories` | Administrator |
| PATCH | `/categories/:id` | Administrator |

### Milestones and claims

| Method | Path | Access |
| --- | --- | --- |
| GET | `/milestones/:milestoneId` | Public/participant projection |
| PATCH | `/milestones/:milestoneId` | Owner/administrator while editable |
| POST | `/milestones/:milestoneId/start` | Owner |
| POST | `/milestones/:milestoneId/submit` | Owner |
| GET | `/milestones/:milestoneId/submissions` | Public/participant projection |
| GET | `/claims/:claimId` | Public/participant projection |
| GET | `/claims/:claimId/versions` | Public/participant projection |
| POST | `/claims/:claimId/amend` | Owner |
| GET | `/evidence/:evidenceId/download` | Public for public evidence; participants for restricted |

### Reviews

| Method | Path | Access |
| --- | --- | --- |
| GET | `/reviews/queue` | Reviewer or administrator |
| POST | `/reviews` | Assigned independent reviewer |

### Blockchain

| Method | Path | Access |
| --- | --- | --- |
| GET | `/anchors` | Public role-filtered list |
| GET | `/anchors/chain-info` | Public |
| GET | `/anchors/:anchorId` | Public/participant projection |
| POST | `/anchors/prepare` | Administrator or project owner with anchor rights |
| POST | `/anchors/:anchorId/transaction` | Administrator or project owner |
| POST | `/anchors/:anchorId/reconcile` | Administrator or project owner |
| POST | `/verify` | Public |
| GET | `/verify/:anchorId` | Public |

### Reports, notifications, audit and administration

| Method | Path | Access |
| --- | --- | --- |
| GET | `/reports` | Authenticated participant |
| GET | `/reports/:reportId` | Authenticated participant |
| GET | `/notifications` | Authenticated, own records |
| PATCH | `/notifications/:notificationId/read` | Authenticated, own records |
| POST | `/notifications/read-all` | Authenticated, own records |
| GET | `/audit` | Public projection or administrator |
| GET | `/audit/integrity` | Public |
| GET | `/settings` | Public settings |
| GET | `/admin/settings` | Administrator |
| PATCH | `/admin/settings` | Administrator |
| GET | `/users` | Administrator |
| GET | `/users/reviewers` | Administrator |
| POST | `/users` | Administrator |
| PATCH | `/users/:id` | Administrator |
| GET | `/organizations` | Administrator |
| POST | `/organizations` | Administrator |
| PATCH | `/organizations/:id` | Administrator |
| GET | `/organizations/:id/members` | Administrator |
| POST | `/organizations/:id/members` | Administrator |
| DELETE | `/organizations/:id/members/:userId` | Administrator |

Paginated collections accept `page` and `pageSize`; responses include pagination metadata. Validation, error codes and request bodies are described in the OpenAPI document. The generated document enumerates all 72 implemented operations across 60 paths and is served at `/api/v1/openapi.json` with Swagger UI at `/api/docs`.

## 12. Operational characteristics

- API structured logs use pino with request ids; no passwords or tokens are logged.
- Global, authentication and upload rate limits are process-local and reset on restart.
- Uploads are held in memory only for validation, then written under a dated shard with a random UUID filename and mode `0600`.
- `SERVE_WEB=true` lets the API serve the built SPA for single-server deployments; otherwise host `apps/web/dist` separately.
- Migrations are applied in numeric filename order and recorded in `schema_migrations`.
