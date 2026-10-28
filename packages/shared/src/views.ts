import type {
  AnchorRecordType,
  AnchorStatus,
  ClaimStatus,
  EvidenceVisibility,
  MilestoneStatus,
  ProjectStatus,
  ProjectVisibility,
  ReviewDecision,
  ReviewTargetType,
  SubmissionStatus,
  UserRole,
} from './domain.js';

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface EvidenceFileView {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface EvidenceView {
  id: string;
  projectId: string;
  milestoneId: string | null;
  claimId: string | null;
  title: string;
  description: string | null;
  visibility: EvidenceVisibility;
  createdAt: string;
  uploaderName: string | null;
  file: EvidenceFileView;
  downloadUrl: string;
}

export interface ReviewView {
  id: string;
  projectId: string;
  targetType: ReviewTargetType;
  targetId: string;
  targetVersion: number;
  decision: ReviewDecision;
  rationale: string;
  createdAt: string;
  reviewerName: string;
  reviewerRole: UserRole;
}

export interface SubmissionView {
  id: string;
  milestoneId: string;
  version: number;
  summary: string;
  status: SubmissionStatus;
  submittedAt: string;
  decidedAt: string | null;
  submittedByName: string | null;
  evidence: EvidenceView[];
  review: ReviewView | null;
}

export interface MilestoneView {
  id: string;
  projectId: string;
  sequence: number;
  title: string;
  description: string;
  expectedCompletionDate: string;
  deliverables: string;
  allocatedBudget: string | null;
  responsibleParty: string;
  status: MilestoneStatus;
  version: number;
  isOverdue: boolean;
  submissionCount: number;
  latestSubmission: SubmissionView | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimView {
  id: string;
  projectId: string;
  reference: string;
  version: number;
  previousClaimId: string | null;
  isCurrent: boolean;
  amount: string;
  currency: string;
  claimedDate: string;
  category: string;
  description: string;
  supplierName: string | null;
  supplierReference: string | null;
  status: ClaimStatus;
  overBudget: boolean;
  budgetExplanation: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  createdAt: string;
  evidence: EvidenceView[];
  reviews: ReviewView[];
}

export interface ReviewerAssignmentView {
  id: string;
  reviewer: PersonRef;
  reviewerEmail: string | null;
  conflictNote: string | null;
  assignedAt: string;
  active: boolean;
  removedAt: string | null;
}

export interface ProjectPermissions {
  canEditProject: boolean;
  canSubmitRecords: boolean;
  canUploadEvidence: boolean;
  canReview: boolean;
  canManageReviewers: boolean;
  canApproveProject: boolean;
  canAnchor: boolean;
  canGenerateReport: boolean;
  canSeeRestrictedData: boolean;
}

export interface BudgetChangeView {
  version: number;
  amount: string;
  currency: string;
  reason: string;
  changedByName: string | null;
  createdAt: string;
}

export interface ProjectStatusChangeView {
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus;
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

export interface ProjectDetail {
  id: string;
  code: string;
  title: string;
  description: string;
  problemStatement: string;
  objectives: string[];
  categoryId: string;
  categoryLabel: string;
  organization: { id: string; name: string; website: string | null };
  owner: PersonRef | null;
  locationName: string;
  latitude: number;
  longitude: number;
  budgetAmount: string;
  currency: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  version: number;
  approvedAt: string | null;
  completedAt: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  claimedAmount: string;
  approvedClaimAmount: string;
  pendingReviewCount: number;
  openDiscrepancies: number;
  milestoneStats: { total: number; completed: number; overdue: number; completionPercent: number };
  latestBudgetChange: BudgetChangeView | null;
  permissions: ProjectPermissions;
}

export interface AnchorTransactionView {
  txHash: string;
  fromAddress: string | null;
  status: string;
  submittedAt: string;
  checkedAt: string | null;
  blockNumber: number | null;
  failureReason: string | null;
}

export interface AnchorDetailView {
  id: string;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number;
  recordLabel: string;
  contentDigest: string;
  commitment: string;
  status: AnchorStatus;
  chainId: number | null;
  contractAddress: string | null;
  txHash: string | null;
  blockNumber: number | null;
  confirmations: number | null;
  anchoredAt: string | null;
  lastCheckedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  createdByName: string;
  explorerUrl: string | null;
  previousAnchorId: string | null;
  projectIdBytes32: string;
  recordIdBytes32: string;
  recordTypeCode: number;
  previousKey: string;
  payload: Record<string, unknown> | null;
  transactions: AnchorTransactionView[];
  verification: {
    localDigestMatches: boolean;
    localCommitmentMatches: boolean;
    onChainDigest: string | null;
    onChainChecked: boolean;
    explanation: string;
  };
}

export interface AuditEventView {
  id: string;
  seq: number;
  projectId: string | null;
  actorName: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  recordVersion: number | null;
  eventHash: string;
  prevHash: string | null;
  createdAt: string;
}

export interface AuditIntegrityView {
  valid: boolean;
  checkedEvents: number;
  firstBrokenSeq: number | null;
  headHash: string | null;
  checkedAt: string;
}

export interface ReportSummaryView {
  id: string;
  projectId: string;
  title: string;
  format: 'JSON' | 'PRINT';
  checksum: string;
  generatedByName: string | null;
  createdAt: string;
}

export interface ReportDetailView extends ReportSummaryView {
  snapshot: Record<string, unknown>;
}

export interface ProjectListPage {
  items: {
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
  }[];
}
