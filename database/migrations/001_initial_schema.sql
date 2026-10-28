-- Proof of Impact — initial relational schema
-- PostgreSQL 16+ required (uses gen_random_uuid(), enum types, expression indexes).
-- Target of the application: PostgreSQL is authoritative for application records;
-- the chain only stores commitments to selected records.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE org_member_role AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE project_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED');
CREATE TYPE project_visibility AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE milestone_status AS ENUM ('PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE submission_status AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED');
CREATE TYPE claim_status AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISPUTED');
CREATE TYPE review_target_type AS ENUM ('MILESTONE_SUBMISSION', 'EXPENDITURE_CLAIM');
CREATE TYPE review_decision AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'DISCREPANCY_OPENED');
CREATE TYPE evidence_visibility AS ENUM ('PUBLIC', 'RESTRICTED');
CREATE TYPE anchor_record_type AS ENUM ('PROJECT', 'MILESTONE_SUBMISSION', 'REVIEW', 'EXPENDITURE_CLAIM', 'AUDIT_BATCH');
CREATE TYPE anchor_status AS ENUM ('AWAITING_WALLET', 'TRANSACTION_SUBMITTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'VERIFICATION_ERROR');
CREATE TYPE blockchain_tx_status AS ENUM ('SUBMITTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'VERIFICATION_ERROR');
CREATE TYPE notification_type AS ENUM ('PROJECT_SUBMITTED', 'PROJECT_APPROVED', 'PROJECT_REJECTED', 'MILESTONE_SUBMITTED', 'CLAIM_SUBMITTED', 'REVIEW_DECIDED', 'REVIEWER_ASSIGNED', 'ANCHOR_CONFIRMED', 'ANCHOR_FAILED', 'REPORT_GENERATED');
CREATE TYPE report_format AS ENUM ('JSON', 'PRINT');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Human-readable reference counters. Codes such as POI-2026-000042 remain
-- stable for the lifetime of the record; the UUID stays the primary key.
CREATE SEQUENCE project_code_seq;
CREATE SEQUENCE expenditure_reference_seq;

-- ---------------------------------------------------------------------------
-- Identity, organizations, configuration
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'OBSERVER',
  status account_status NOT NULL DEFAULT 'ACTIVE',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT users_full_name_len CHECK (char_length(full_name) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  csrf_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);
CREATE UNIQUE INDEX sessions_token_hash_uidx ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  registration_number text,
  contact_email text,
  website text,
  description text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_name_lower_uidx ON organizations (lower(name));

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_member_role NOT NULL DEFAULT 'MEMBER',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id);

CREATE TABLE project_categories (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_categories_id_format CHECK (id ~ '^[a-z0-9-]{2,60}$')
);

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  problem_statement text NOT NULL,
  category_id text NOT NULL REFERENCES project_categories(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  location_name text NOT NULL,
  latitude numeric(9, 6) NOT NULL,
  longitude numeric(9, 6) NOT NULL,
  budget_amount numeric(18, 2) NOT NULL,
  currency text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status project_status NOT NULL DEFAULT 'DRAFT',
  visibility project_visibility NOT NULL DEFAULT 'PRIVATE',
  version integer NOT NULL DEFAULT 1,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_code_unique UNIQUE (code),
  CONSTRAINT projects_budget_nonnegative CHECK (budget_amount >= 0),
  CONSTRAINT projects_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT projects_dates_order CHECK (end_date >= start_date),
  CONSTRAINT projects_version_positive CHECK (version > 0),
  CONSTRAINT projects_latitude_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT projects_longitude_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT projects_id_currency_unique UNIQUE (id, currency)
);

CREATE TABLE project_objectives (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  objective text NOT NULL,
  PRIMARY KEY (project_id, position),
  CONSTRAINT project_objectives_position_positive CHECK (position > 0)
);

CREATE TABLE project_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  amount numeric(18, 2) NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_budgets_version_unique UNIQUE (project_id, version),
  CONSTRAINT project_budgets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT project_budgets_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT project_budgets_positive_version CHECK (version > 0)
);

CREATE TABLE project_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  from_status project_status,
  to_status project_status NOT NULL,
  reason text,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_status_history_project_idx ON project_status_history (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------
CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  expected_completion date NOT NULL,
  deliverables text NOT NULL,
  allocated_budget numeric(18, 2),
  responsible_party text NOT NULL,
  status milestone_status NOT NULL DEFAULT 'PLANNED',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_project_sequence_unique UNIQUE (project_id, sequence),
  CONSTRAINT milestones_sequence_positive CHECK (sequence > 0),
  CONSTRAINT milestones_allocated_budget_nonnegative CHECK (allocated_budget IS NULL OR allocated_budget >= 0),
  CONSTRAINT milestones_version_positive CHECK (version > 0)
);
CREATE INDEX milestones_project_idx ON milestones (project_id, sequence);
CREATE INDEX milestones_due_idx ON milestones (expected_completion) WHERE status IN ('PLANNED', 'IN_PROGRESS');

CREATE TABLE milestone_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  summary text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status submission_status NOT NULL DEFAULT 'SUBMITTED',
  decided_at timestamptz,
  CONSTRAINT milestone_submissions_version_unique UNIQUE (milestone_id, version),
  CONSTRAINT milestone_submissions_version_positive CHECK (version > 0)
);
CREATE INDEX milestone_submissions_milestone_idx ON milestone_submissions (milestone_id, version DESC);
CREATE INDEX milestone_submissions_status_idx ON milestone_submissions (status);

-- ---------------------------------------------------------------------------
-- Expenditure claims
-- ---------------------------------------------------------------------------
CREATE TABLE expenditure_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  reference text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  previous_claim_id uuid REFERENCES expenditure_claims(id) ON DELETE RESTRICT,
  is_current boolean NOT NULL DEFAULT true,
  amount numeric(18, 2) NOT NULL,
  currency text NOT NULL,
  claimed_date date NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  supplier_name text,
  supplier_reference text,
  status claim_status NOT NULL DEFAULT 'DRAFT',
  over_budget boolean NOT NULL DEFAULT false,
  budget_explanation text,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenditure_claims_project_currency_fk FOREIGN KEY (project_id, currency) REFERENCES projects(id, currency) ON DELETE RESTRICT,
  CONSTRAINT expenditure_claims_version_unique UNIQUE (project_id, reference, version),
  CONSTRAINT expenditure_claims_amount_positive CHECK (amount > 0),
  CONSTRAINT expenditure_claims_version_positive CHECK (version > 0),
  CONSTRAINT expenditure_claims_over_budget_explained CHECK (NOT over_budget OR budget_explanation IS NOT NULL)
);
CREATE UNIQUE INDEX expenditure_claims_current_reference_uidx ON expenditure_claims (project_id, reference) WHERE is_current;
CREATE INDEX expenditure_claims_project_idx ON expenditure_claims (project_id, created_at DESC);
CREATE INDEX expenditure_claims_status_idx ON expenditure_claims (status) WHERE is_current;

-- ---------------------------------------------------------------------------
-- Evidence and stored files
-- ---------------------------------------------------------------------------
CREATE TABLE stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_name text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stored_files_storage_name_unique UNIQUE (storage_name),
  CONSTRAINT stored_files_size_positive CHECK (size_bytes > 0),
  CONSTRAINT stored_files_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  milestone_id uuid REFERENCES milestones(id) ON DELETE RESTRICT,
  expenditure_claim_id uuid REFERENCES expenditure_claims(id) ON DELETE RESTRICT,
  file_id uuid NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  visibility evidence_visibility NOT NULL DEFAULT 'RESTRICTED',
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT evidence_one_parent CHECK (milestone_id IS NULL OR expenditure_claim_id IS NULL)
);
CREATE INDEX evidence_project_idx ON evidence (project_id, created_at DESC);
CREATE INDEX evidence_milestone_idx ON evidence (milestone_id);
CREATE INDEX evidence_claim_idx ON evidence (expenditure_claim_id);

CREATE TABLE milestone_submission_evidence (
  submission_id uuid NOT NULL REFERENCES milestone_submissions(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  PRIMARY KEY (submission_id, evidence_id)
);
CREATE INDEX milestone_submission_evidence_evidence_idx ON milestone_submission_evidence (evidence_id);

CREATE TABLE expenditure_claim_evidence (
  claim_id uuid NOT NULL REFERENCES expenditure_claims(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  PRIMARY KEY (claim_id, evidence_id)
);
CREATE INDEX expenditure_claim_evidence_evidence_idx ON expenditure_claim_evidence (evidence_id);

-- ---------------------------------------------------------------------------
-- Reviewer assignments and decisions
-- ---------------------------------------------------------------------------
CREATE TABLE reviewer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conflict_note text,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE UNIQUE INDEX reviewer_assignments_active_uidx ON reviewer_assignments (project_id, reviewer_id) WHERE active;
CREATE INDEX reviewer_assignments_reviewer_idx ON reviewer_assignments (reviewer_id) WHERE active;

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  target_type review_target_type NOT NULL,
  target_id uuid NOT NULL,
  target_version integer NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision review_decision NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_one_decision_per_version UNIQUE (target_type, target_id, target_version),
  CONSTRAINT reviews_target_version_positive CHECK (target_version > 0),
  CONSTRAINT reviews_rationale_len CHECK (char_length(rationale) >= 20)
);
CREATE INDEX reviews_project_idx ON reviews (project_id, created_at DESC);
CREATE INDEX reviews_reviewer_idx ON reviews (reviewer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only audit trail (hash chained at application level)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role user_role,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_version integer,
  correlation_id uuid,
  prev_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_seq_unique UNIQUE (seq),
  CONSTRAINT audit_events_hash_format CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_events_prev_hash_format CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX audit_events_project_idx ON audit_events (project_id, seq DESC);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

CREATE OR REPLACE FUNCTION reject_review_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reviews are immutable; record a new review event instead of %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER reviews_no_update BEFORE UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION reject_review_mutation();

-- ---------------------------------------------------------------------------
-- Blockchain anchoring records
-- ---------------------------------------------------------------------------
CREATE TABLE blockchain_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  record_type anchor_record_type NOT NULL,
  record_id uuid NOT NULL,
  record_version integer NOT NULL,
  content_digest text NOT NULL,
  commitment text NOT NULL,
  payload jsonb NOT NULL,
  status anchor_status NOT NULL DEFAULT 'AWAITING_WALLET',
  chain_id bigint,
  contract_address text,
  previous_anchor_id uuid REFERENCES blockchain_anchors(id) ON DELETE RESTRICT,
  tx_hash text,
  block_number bigint,
  confirmations integer,
  anchored_at timestamptz,
  last_checked_at timestamptz,
  failure_reason text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blockchain_anchors_record_version_unique UNIQUE (record_type, record_id, record_version),
  CONSTRAINT blockchain_anchors_version_positive CHECK (record_version > 0),
  CONSTRAINT blockchain_anchors_digest_format CHECK (content_digest ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT blockchain_anchors_commitment_format CHECK (commitment ~ '^0x[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX blockchain_anchors_tx_uidx ON blockchain_anchors (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX blockchain_anchors_project_idx ON blockchain_anchors (project_id, created_at DESC);
CREATE INDEX blockchain_anchors_status_idx ON blockchain_anchors (status);

CREATE TABLE blockchain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_id uuid NOT NULL REFERENCES blockchain_anchors(id) ON DELETE RESTRICT,
  tx_hash text NOT NULL,
  from_address text,
  status blockchain_tx_status NOT NULL DEFAULT 'SUBMITTED',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  block_number bigint,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT blockchain_transactions_tx_unique UNIQUE (tx_hash),
  CONSTRAINT blockchain_transactions_hash_format CHECK (tx_hash ~ '^0x[0-9a-f]{64}$')
);
CREATE INDEX blockchain_transactions_anchor_idx ON blockchain_transactions (anchor_id, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- Notifications and reports
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  link_path text,
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uidx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  generated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  format report_format NOT NULL DEFAULT 'PRINT',
  title text NOT NULL,
  snapshot jsonb NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$')
);
CREATE INDEX reports_project_idx ON reports (project_id, created_at DESC);
CREATE INDEX reports_generated_by_idx ON reports (generated_by);

-- ---------------------------------------------------------------------------
-- Indexes for common application queries
-- ---------------------------------------------------------------------------
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_visibility_idx ON projects (visibility);
CREATE INDEX projects_category_idx ON projects (category_id);
CREATE INDEX projects_organization_idx ON projects (organization_id);
CREATE INDEX projects_owner_idx ON projects (owner_id);
CREATE INDEX projects_end_date_idx ON projects (end_date);
CREATE INDEX projects_title_trgm_idx ON projects USING gin (title gin_trgm_ops);
CREATE INDEX projects_code_trgm_idx ON projects USING gin (code gin_trgm_ops);
CREATE INDEX projects_location_trgm_idx ON projects USING gin (location_name gin_trgm_ops);

CREATE INDEX project_budgets_project_idx ON project_budgets (project_id, version DESC);
CREATE INDEX reviews_target_idx ON reviews (target_type, target_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_categories_set_updated_at BEFORE UPDATE ON project_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER milestones_set_updated_at BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER expenditure_claims_set_updated_at BEFORE UPDATE ON expenditure_claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER blockchain_anchors_set_updated_at BEFORE UPDATE ON blockchain_anchors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
