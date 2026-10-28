export const USER_ROLES = ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PROJECT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'COMPLETED',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const MILESTONE_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const SUBMISSION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const CLAIM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'DISPUTED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const REVIEW_DECISIONS = [
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'DISCREPANCY_OPENED',
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_TARGET_TYPES = ['MILESTONE_SUBMISSION', 'EXPENDITURE_CLAIM'] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

export const EVIDENCE_VISIBILITIES = ['PUBLIC', 'RESTRICTED'] as const;
export type EvidenceVisibility = (typeof EVIDENCE_VISIBILITIES)[number];

export const ANCHOR_RECORD_TYPES = [
  'PROJECT',
  'MILESTONE_SUBMISSION',
  'REVIEW',
  'EXPENDITURE_CLAIM',
  'AUDIT_BATCH',
] as const;
export type AnchorRecordType = (typeof ANCHOR_RECORD_TYPES)[number];

export const ANCHOR_STATUSES = [
  'AWAITING_WALLET',
  'TRANSACTION_SUBMITTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'FAILED',
  'VERIFICATION_ERROR',
] as const;
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number];

export const VERIFICATION_STATUSES = ['MATCH', 'MISMATCH', 'NOT_FOUND', 'VERIFICATION_ERROR'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const REPORT_FORMATS = ['JSON', 'PRINT'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const NOTIFICATION_TYPES = [
  'PROJECT_SUBMITTED',
  'PROJECT_APPROVED',
  'PROJECT_REJECTED',
  'MILESTONE_SUBMITTED',
  'CLAIM_SUBMITTED',
  'REVIEW_DECIDED',
  'REVIEWER_ASSIGNED',
  'ANCHOR_CONFIRMED',
  'ANCHOR_FAILED',
  'REPORT_GENERATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Capabilities {
  manageUsers: boolean;
  manageOrganizations: boolean;
  manageCategories: boolean;
  manageSettings: boolean;
  createProjects: boolean;
  approveProjects: boolean;
  assignReviewers: boolean;
  editOwnProjects: boolean;
  submitClaims: boolean;
  reviewClaims: boolean;
  anchorRecords: boolean;
  viewAudit: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  isDemo: boolean;
  capabilities: Capabilities;
}

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface ProjectListItem {
  id: string;
  code: string;
  title: string;
  category: string;
  categoryLabel: string;
  locationName: string;
  organizationName: string;
  budgetAmount: string;
  currency: string;
  claimedAmount: string;
  approvedClaimAmount: string;
  milestoneCompletionPercent: number;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  endDate: string;
  latestReviewDecision: ReviewDecision | null;
  openDiscrepancies: number;
  isDemo: boolean;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AnchorSummary {
  id: string;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number;
  contentDigest: string;
  commitment: string;
  status: AnchorStatus;
  chainId: number | null;
  contractAddress: string | null;
  txHash: string | null;
  blockNumber: number | null;
  confirmations: number | null;
  anchoredAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number | null;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  commitment: string | null;
  contentDigest: string | null;
  recomputedContentDigest: string | null;
  onChainContentDigest: string | null;
  onChainCommitment: string | null;
  digestMatches: boolean | null;
  commitmentMatches: boolean | null;
  anchorStatus: AnchorStatus | null;
  txHash: string | null;
  blockNumber: number | null;
  chainId: number | null;
  explorerUrl: string | null;
  payload: Record<string, unknown> | null;
  checkedAt: string;
  explanation: string;
}

export interface OverviewMetrics {
  totalProjects: number;
  totalApprovedBudget: CurrencyTotal[];
  recordedClaimTotal: CurrencyTotal[];
  approvedClaimTotal: CurrencyTotal[];
  projectsInProgress: number;
  completedMilestones: number;
  overdueMilestones: number;
  claimsAwaitingReview: number;
  anchoredRecords: number;
}

export interface OverviewResponse {
  scope: 'PUBLIC' | 'ASSIGNED' | 'OWNED' | 'ALL';
  scopeLabel: string;
  demoMode: boolean;
  generatedAt: string;
  metrics: OverviewMetrics;
  definitions: Record<string, string>;
  projectStatusDistribution: { status: ProjectStatus; count: number }[];
  budgetVsClaims: {
    projectId: string;
    code: string;
    title: string;
    currency: string;
    budget: string;
    claimed: string;
  }[];
  milestoneCompletionByMonth: { month: string; count: number }[];
  projectsByCategory: { category: string; label: string; count: number }[];
  anchoringActivity: { status: AnchorStatus; count: number }[];
  recentActivity: {
    id: string;
    action: string;
    summary: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    actorRole: UserRole | null;
  }[];
  reviewQueue: {
    id: string;
    targetType: ReviewTargetType;
    projectId: string;
    projectCode: string;
    title: string;
    submittedAt: string;
    ageDays: number;
  }[];
}
