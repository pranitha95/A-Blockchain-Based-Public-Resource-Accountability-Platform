# Security design

This document describes the security controls that are actually implemented in the Proof of Impact codebase, the trust boundaries they assume, and the gaps that remain. It is written to be checked against the code, not read as a marketing claim.

> This is a CSE major project. It has not received an independent security audit or penetration test. Do not present it as certified, government-approved or production-hardened.

## 1. Trust boundaries and threat model

| Boundary | Trusted? | Notes |
| --- | --- | --- |
| Browser | No | Every role, capability, project access and visibility decision is re-evaluated by the API. Hiding a button is a usability measure only. |
| API process | Yes, for policy decisions | Holds the database URL and session/CSRF secrets in memory. Never holds a blockchain private key. |
| PostgreSQL | Yes, for integrity within its own boundary | Enforces constraints, append-only triggers and transactional locking. A database superuser can still disable protections. |
| Local evidence filesystem | Partially | Files are written with restrictive permissions and opaque names; the API authorises every download. |
| Injected wallet (MetaMask) | No | Treated as an untrusted signer. The API verifies the transaction receipt, contract address and emitted event before confirming an anchor. |
| Sepolia / JSON-RPC provider | No | Read responses are verified against the configured contract and expected commitment. Reorgs and provider errors surface as verification errors, not silent success. |
| Seeded demonstration data | Unverified | Clearly labelled; it is not real government, financial or procurement data. |

### Assets

- Account credentials and active sessions.
- Restricted project data: owner identity, reviewer identities/conflict notes, non-public evidence, internal audit details, draft budgets.
- Integrity of the audit trail and immutable review decisions.
- Integrity of on-chain commitments and their linkage to off-chain records.
- Server secrets: database URL, session tokens, deployment configuration, wallet keys (which must never reach this system).

### Adversaries considered

- An anonymous visitor attempting to read restricted data or act without a session.
- An authenticated owner attempting to approve their own claims, bypass review, or edit submitted history.
- An authenticated reviewer attempting to review a project they own or were not assigned to, or to replace a prior decision.
- A malicious uploader attempting to store executable/HTML content, traverse paths, or infer other users' files.
- A request-forgery attacker on another origin attempting state changes through a logged-in browser.
- A tamperer with ordinary database access attempting to rewrite audit history or reviews.
- A wallet holder presenting a transaction hash that does not correspond to the prepared commitment.

Not fully addressed: a compromised server host, a malicious database administrator, a compromised dependency or browser extension, and long-term key compromise. These are outside an academic project's control scope and are listed in [Residual risks](#12-residual-risks).

## 2. Authentication

Implemented in [`apps/api/src/modules/auth/auth.service.ts`](../apps/api/src/modules/auth/auth.service.ts), [`auth.routes.ts`](../apps/api/src/modules/auth/auth.routes.ts) and [`middleware/auth.ts`](../apps/api/src/middleware/auth.ts).

- **Password hashing.** Argon2id through `@node-rs/argon2` with `memoryCost = 19456 KiB`, `timeCost = 2`, `parallelism = 1`. Plaintext passwords are never stored, logged or returned.
- **Password policy.** 10–128 characters with at least one letter and one number ([`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts)). The same schema is used by registration, password change and administrator account creation.
- **Opaque server-side sessions.** 32 random bytes (base64url) are issued as `poi_session`; only its SHA-256 hash is stored in `sessions.token_hash`. A stolen database dump does not yield usable session tokens.
- **Cookie attributes.** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `COOKIE_SECURE=true`. The CSRF companion cookie is intentionally readable by JavaScript; it contains a separate random token, not the session token.
- **Session lifetime and revocation.** Default TTL is 12 hours (`SESSION_TTL_HOURS`, 1–720). Sessions are checked against `revoked_at` and `expires_at` on every request. Logout revokes the current session; password change revokes every active session for that account.
- **Account status.** A session belonging to a non-`ACTIVE` user is rejected and both cookies are cleared.
- **Enumeration resistance.** Unknown emails still incur an Argon2 verification against a lazily generated dummy hash, and the same generic message is returned for unknown email and wrong password.
- **No default credentials.** There is no built-in password. Demo accounts require an operator-supplied `SEED_DEMO_PASSWORD`; the initial administrator requires `ADMIN_PASSWORD` through a CLI.
- **Registration scope.** Self-service registration always creates an `OBSERVER`. Roles cannot be chosen by the registrant.
- **Brute force.** Authentication routes share a 20-requests-per-15-minutes limiter in addition to the general API limiter.

Not implemented: email verification, multi-factor authentication, self-service password reset, device/session listing, idle timeout enforcement, breach-password checks. Login does not revoke other sessions for the same user.

## 3. Session and CSRF protection

Implemented in [`middleware/csrf.ts`](../apps/api/src/middleware/csrf.ts), [`app.ts`](../apps/api/src/app.ts) and [`auth.service.ts`](../apps/api/src/modules/auth/auth.service.ts).

- **Origin check.** Every non-safe request that carries an `Origin` header must match `WEB_ORIGIN` or the request's own origin. Other origins receive `403 ORIGIN_REJECTED`.
- **Double-submit CSRF token.** After login, `poi_csrf` holds a random 32-byte token (readable by the front end). The API stores only `sha256(token)` in the session row. Mutating requests from authenticated sessions must send `X-CSRF-Token`; the hash is compared with `timingSafeEqual`.
- **Unauthenticated mutating routes.** Login and registration have no CSRF token yet by design; they rely on the origin check, strict JSON parsing, `SameSite=Lax` cookies and the authentication rate limiter.
- **CORS.** Credentials are allowed only for origins in `WEB_ORIGIN`; allowed request headers are an explicit allowlist (`Content-Type`, `X-CSRF-Token`, `X-Request-Id`).
- **No wildcard CORS.** `*` cannot be combined with credentials, and the configuration is read from the server environment, not the browser.

## 4. Authorization and separation of duties

Roles are defined once in [`packages/shared/src/permissions.ts`](../packages/shared/src/permissions.ts) and enforced in the API. The browser only receives the resulting capability map for UI rendering.

| Role | Core abilities |
| --- | --- |
| `ADMIN` | Manage users, organisations, categories, reviewers and projects; approve projects; resolve reviews; finalise reporting. Cannot review their own project records. |
| `PROJECT_OWNER` | Manage own projects, budgets, milestones, evidence and claims. Cannot approve own projects, submissions or claims. |
| `REVIEWER` | Review only records on projects where an active assignment exists. Cannot review projects they own or records outside their assignment. |
| `OBSERVER` | Read public data and their own notifications/profile. Cannot mutate accountability records. |

Server-side checks include:

- Route-level `requireAuth` / `requireRole` / `requireCapability` middleware.
- Project-level access resolution in [`project-access.ts`](../apps/api/src/modules/projects/project-access.ts): `canView`, `canEditProject`, `canSubmitRecords`, `canUploadEvidence`, `canReview`, `canManageReviewers`, `canApproveProject`, `canAnchor`, `canSeeRestrictedData`, `canSeeInternalAudit`.
- Reviewer decisions require an active assignment, target status `SUBMITTED`/`UNDER_REVIEW`, and reject self-review with `You cannot review a record on a project you own` plus `You are not an active independent reviewer for this project`.
- A unique constraint (`reviews_one_decision_per_version`) and an immutability trigger prevent recording a second decision for the same target version or rewriting a decision.
- Claim decisions are made through the review module; there is no owner-accessible "approve claim" endpoint. Project completion requires every milestone approved and no pending submissions/claims.
- Reviewers are assigned by administrators; reviewer identity and conflict notes are visible to administrators, the owner and the assigned reviewer, not to anonymous visitors.
- Organisation membership endpoints are administrator-only; owners cannot grant themselves access to another organisation's projects.

The API never accepts a role from the browser for authorization. `requireRole` reads the role from the session joined to the persisted user row.

## 5. Data visibility

- Public project discovery returns only projects with `visibility = 'PUBLIC'` and a publicly visible status. Private and draft projects return `404` to anonymous callers, not a redirect or an existence hint.
- Public project detail withholds owner identity and reviewer identity; restricted evidence is excluded from lists and downloads.
- Restricted data (non-public evidence, reviewer email/conflict notes, internal audit entries, change actor names) is available to administrators, the owning account and the actively assigned reviewer only.
- Public evidence has a stable download URL; restricted evidence returns `403`/`404` for unauthorised callers before the filesystem is touched.
- Claim detail is intentionally public for public projects, but the server nulls submitter identity, excludes restricted evidence and masks reviewer information when the caller is anonymous. The front end renders "Withheld from this view" rather than inventing a name.
- Notifications are scoped to the authenticated recipient. There is no endpoint that lists another user's notifications.

## 6. File uploads

Implemented in [`file-storage.ts`](../apps/api/src/modules/evidence/file-storage.ts) and [`evidence.service.ts`](../apps/api/src/modules/evidence/evidence.service.ts).

- Uploads are buffered in memory by Multer with `fileSize` from `MAX_UPLOAD_BYTES` (default 10 MB, max 50 MB), one file and a bounded field count.
- The declared MIME type is not trusted. `file-type` inspects magic bytes; only PDF, PNG, JPEG and WebP are accepted. Unknown or mismatched types are rejected.
- The stored extension is derived from the detected type, not the client filename.
- Original filenames are stripped of control characters and path separators, restricted to a safe character set, and truncated to 180 characters.
- Stored names are random UUIDs in a year/month shard, written with `wx` (no overwrite) and mode `0600`.
- Download resolves the stored relative name, rejects `..` and absolute paths, requires a database record, and re-checks project/evidence visibility.
- Downloads set `Cache-Control: private, no-store` and the detected content type, and use `Content-Disposition: attachment` via `res.download`.
- Uploads are rate limited separately (60 per 15 minutes per client) and require authentication plus owner access to the project.

Gaps: no malware scanning, no image re-encoding, no object storage or signed URLs, no per-file encryption at rest. The development filesystem is local; production operators must provide encrypted storage, backups and AV scanning.

## 7. Audit trail integrity

Implemented in [`audit.service.ts`](../apps/api/src/modules/audit/audit.service.ts), [`database/migrations/001_initial_schema.sql`](../database/migrations/001_initial_schema.sql) and [`crypto.ts`](../apps/api/src/lib/crypto.ts).

- `audit_events` is append-only. Database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` with exceptions, independently of application code.
- `reviews` are immutable. Triggers reject `UPDATE` and `DELETE`; corrections are recorded as new review events, never silent rewrites.
- Each event stores `seq`, `prev_hash`, `event_hash` and the canonical event body. The hash is `sha256(prev_hash + ':' + canonicalJson(body))`, where canonical JSON sorts object keys deterministically.
- Appends take `pg_advisory_xact_lock(hashtext('proof_of_impact_audit_chain'))` inside the surrounding transaction, so concurrent writers cannot fork the chain. A failed transaction rolls back its audit event together with the business change.
- `GET /api/v1/audit/verify` recomputes the chain from genesis and reports the first divergence, sequence and expected/actual hash. The project audit view exposes the chain head.
- Project status history, budget history, claim versions, submission versions and review events are additive. Historical records are not silently rewritten; supersession is explicit.
- Audit anchoring (when configured) binds the audit head to the on-chain registry, making the chain head externally tamper-evident.

Important limit: the chain detects tampering performed through normal database access. A database superuser who disables triggers and recomputes every hash can rewrite history; only the on-chain head (when one exists) can expose that. The development database has zero anchors, so the chain is currently tamper-evident only inside PostgreSQL.

## 8. Blockchain and wallet security

Implemented in [`blockchain.service.ts`](../apps/api/src/modules/blockchain/blockchain.service.ts), [`contracts/contracts/ProofOfImpactRegistry.sol`](../contracts/contracts/ProofOfImpactRegistry.sol) and [`apps/web/src/lib/wallet.ts`](../apps/web/src/lib/wallet.ts).

- **No server-side private key.** The API prepares a commitment and returns a transaction request. The browser wallet signs and submits it. The API never accepts, requests or stores a seed phrase or private key.
- **Role-gated anchoring.** The contract uses OpenZeppelin `AccessControl`; only accounts holding `ANCHOR_ROLE` can call `anchorRecord`. The administrator deploys and grants the role with `grant-anchorer.ts`.
- **Domain-bound commitments.** The commitment includes a domain separator, `block.chainid`, the registry address, project hash, record type, record hash, version and content digest. A commitment cannot be replayed on another chain, another contract or another record.
- **Explicit supersession.** A new version must reference the active prior key; the contract rejects duplicates, missing predecessors, mismatched predecessors and non-increasing versions. It emits `RecordAnchored` and `RecordSuperseded`.
- **Server-side reconciliation.** The API fetches the receipt, requires status `1`, verifies the configured registry address, decodes the expected `RecordAnchored` event and compares project, record, version, digest and commitment before marking an anchor confirmed. Confirmations are counted against `ANCHOR_CONFIRMATIONS`.
- **Failure states are real.** Missing configuration, missing receipt, reverted transaction, absent/mismatched event and RPC errors produce `FAILED` or `VERIFICATION_ERROR` with a factual reason; they are never converted into success.
- **UI honesty.** With no contract address or RPC, anchoring is disabled and the UI states the exact missing configuration. No address, hash or confirmation is fabricated. See [the engineering report](ENGINEERING_REPORT.md).

Limits: a confirmed anchor proves a digest was committed by an authorised address at a block. It does not prove the underlying document is authentic, the work was performed, the money was spent lawfully or the reviewer is independent in reality. The contract stores no personal data and is not a source of truth for the off-chain record.

## 9. Secrets and configuration

- All server configuration is environment-driven and validated at startup by Zod ([`env.ts`](../apps/api/src/config/env.ts)). Invalid URLs, malformed contract addresses, out-of-range values and `SEED_DEMO=true` under `NODE_ENV=production` abort startup.
- Only `VITE_*` variables reach the browser. This project deliberately defines none that carry secrets. `RPC_URL`, database credentials, session material and deployment keys are server-side only.
- `.env` is git-ignored; `.env.example` contains placeholders only. The development database and uploads live under `var/`, also ignored.
- The Sepolia deployer key belongs in `contracts/.env` (`SEPOLIA_PRIVATE_KEY`) and is read only by Hardhat deploy/grant scripts. It must never be placed in the API or web environment.
- Demo seeding refuses to run when `NODE_ENV=production`, requires explicit `SEED_DEMO=true` and a password of at least 10 characters. There is no default demo password in code.
- `npm run create-admin` requires `ADMIN_PASSWORD`; no password is embedded in the CLI.
- Logs redact cookies, authorization headers, CSRF headers, set-cookie responses and common secret field names. Passwords are never logged.
- Error responses include a request ID and a safe message. Internal details and Zod issue payloads are omitted for 5xx responses; generic Postgres errors are translated so constraints and SQL are not exposed.

## 10. Transport, headers and request handling

- Helmet sets a restrictive CSP (`default-src 'self'`, no framing, no objects, no external scripts), `Referrer-Policy: no-referrer`, and related headers. The inline Swagger bootstrap requires `'unsafe-inline'` for scripts in the CSP; the React app is served separately by Vite and does not depend on it.
- `x-powered-by` is disabled.
- CORS is an explicit origin allowlist with credentials.
- JSON bodies are limited to 1 MB; uploads are limited separately.
- Request IDs are attached and echoed in error responses for correlation.
- pino logs structured request metadata, with health checks excluded from automatic logging.
- `TRUST_PROXY` must be enabled only when one trusted reverse proxy actually sits in front of the API; otherwise client IPs and `express-rate-limit` can be spoofed.
- `COOKIE_SECURE=true` and HTTPS termination are required in production.

## 11. Rate limiting and abuse controls

| Scope | Limit | Implementation |
| --- | --- | --- |
| General API | 300 requests/minute per client IP | `generalApiLimiter` |
| Authentication | 20 requests/15 minutes per client IP | `authenticationLimiter` on `/auth` |
| Uploads | 60 uploads/15 minutes per client IP | `uploadLimiter` |
| Pagination | Page size capped at 100 | `paginationFromQuery` |

Limiters are in-process memory. Multiple API instances do not share counters; production scaling requires a shared store (e.g. Redis) or edge rate limiting. `RATE_LIMIT_ENABLED=false` is for tests only.

## 12. Residual risks

- No independent security review, penetration test or fuzzing campaign has been performed.
- Rate limiting is single-instance and IP-based; NAT and proxies can affect fairness.
- No MFA, password reset, email verification or account deletion; no dormant-account expiry.
- Sessions are bearer cookies; there is no device binding or session listing/revocation UI for end users.
- Uploads are type-sniffed but not malware-scanned or re-encoded. PDFs can contain active content; download is forced as an attachment, but user endpoint security is outside this system.
- Evidence and database backups are not encrypted by the application.
- The audit chain is only as strong as database access control until its head is anchored; no anchors exist in the current environment.
- The web bundle is a single large chunk; no Subresource Integrity is used for self-hosted assets beyond same-origin CSP.
- The API does not implement idempotency keys; duplicate submissions are prevented by domain constraints and status checks, not by a generic replay cache.
- No formal vulnerability disclosure programme exists for this academic project.

## 13. Security-relevant verification performed

- `npm run typecheck` passes for shared, API and web.
- API integration tests exercise authentication requirements, CSRF rejection, role restrictions, reviewer independence, public/restricted visibility, upload rejection, audit chain verification and anchor failure states against a real PostgreSQL test database.
- Manual browser checks confirmed public views withhold identities and restricted evidence, and that chain-unavailable messaging matches API-reported configuration.
- Contract tests cover role-gated anchoring, duplicate rejection, supersession rules and version progression on an ephemeral Hardhat network.

For setup and deployment procedures, see [DEPLOYMENT.md](DEPLOYMENT.md). For remaining functional limitations, see [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md).
