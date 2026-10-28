import type {
  AccountStatus,
  AnchorRecordType,
  AnchorStatus,
  AuditEventView,
  ClaimStatus,
  CurrencyTotal,
  EvidenceVisibility,
  MilestoneStatus,
  MilestoneView,
  NotificationType,
  ProjectDetail,
  ProjectStatus,
  ReviewDecision,
  ReviewTargetType,
  ReviewView,
  SessionUser,
  SubmissionView,
  UserRole,
} from '@poi/shared';

export type {
  AccountStatus,
  AnchorDetailView,
  AnchorRecordType,
  AnchorStatus,
  AnchorSummary,
  AuditEventView,
  AuditIntegrityView,
  BudgetChangeView,
  ClaimView,
  CurrencyTotal,
  EvidenceView,
  MilestoneView,
  NotificationType,
  ProjectDetail,
  ProjectListItem,
  ProjectStatus,
  ReportDetailView,
  ReportSummaryView,
  ReviewDecision,
  ReviewView,
  ReviewerAssignmentView,
  SessionUser,
  SubmissionView,
  UserRole,
  VerificationResult,
} from '@poi/shared';

export interface CapabilityMap {
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

export interface CategoryView {
  id: string;
  label: string;
  description: string | null;
  isActive: boolean;
}

export interface ChainInfo {
  chainId: number;
  chainName: string;
  contractAddress: string | null;
  rpcConfigured: boolean;
  explorerBaseUrl: string;
  requiredConfirmations: number;
  anchoringAvailable: boolean;
}

export interface PlatformSettings {
  publicDirectoryEnabled: boolean;
  showDemoData: boolean;
  reportFooterNote: string;
  demoMode: boolean;
}

export interface MetaResponse {
  apiVersion: string;
  serverTime: string;
  platform: PlatformSettings;
  chain: ChainInfo;
  categories: CategoryView[];
  capabilitiesByRole: Record<UserRole, CapabilityMap>;
  disclaimers: {
    anchoring: string;
    approvals: string;
  };
}

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  isDemo: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface OrganizationView {
  id: string;
  name: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  website: string | null;
  description: string | null;
  memberCount: number;
  isDemo: boolean;
  createdAt: string;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReviewQueueItem {
  targetType: ReviewTargetType;
  targetId: string;
  targetVersion: number;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  title: string;
  submittedAt: string;
  submittedByName: string | null;
  ageDays: number;
}

export interface MilestoneDetailView extends MilestoneView {
  submissions: SubmissionView[];
}

export interface ClaimVersionSummary {
  id: string;
  version: number;
  status: ClaimStatus;
  isCurrent: boolean;
  amount: string;
  currency: string;
  createdAt: string;
  submittedAt: string | null;
}

export interface ClaimStatusSummary {
  status: ClaimStatus;
  count: number;
}

export interface ReviewerOption {
  id: string;
  fullName: string;
  email: string;
}

export interface EvidenceMetadataForm {
  title: string;
  description: string;
  visibility: EvidenceVisibility;
}

export interface AuditPageQuery {
  projectId?: string;
  action?: string;
  entityType?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type ReportSnapshotProject = Omit<ProjectDetail, 'permissions'> & {
  permissions?: ProjectDetail['permissions'];
};

export interface ReportSnapshot {
  reportSchemaVersion: number;
  generatedAt: string;
  generatedBy: { id: string; role: UserRole; fullName: string };
  platform: { name: string; footerNote: string };
  project: ReportSnapshotProject;
  milestones: import('@poi/shared').MilestoneView[];
  expenditureClaims: { note: string; items: import('@poi/shared').ClaimView[] };
  reviews: ReviewView[];
  anchors: import('@poi/shared').AnchorSummary[];
  audit: { count: number; headHash: string; latestSeq: number };
  disclosures: string[];
}

export interface ProjectFormValues {
  title: string;
  description: string;
  problemStatement: string;
  objectives: string[];
  categoryId: string;
  organizationId: string;
  ownerId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  budgetAmount: string;
  currency: string;
  startDate: string;
  endDate: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export interface AuditLogItem extends AuditEventView {}

export interface AnchorStatusCount {
  status: AnchorStatus;
  count: number;
}

export interface CategoryTotals extends CurrencyTotal {}

export interface UserScopeSession extends SessionUser {}

export interface MilestoneBadgeInfo {
  status: MilestoneStatus;
}

export interface RecordAnchorTarget {
  recordType: AnchorRecordType;
  recordId: string;
  label: string;
}

export interface ReviewDecisionSummary {
  decision: ReviewDecision;
  count: number;
}
