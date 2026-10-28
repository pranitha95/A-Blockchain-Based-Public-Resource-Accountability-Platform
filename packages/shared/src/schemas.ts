import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  ANCHOR_RECORD_TYPES,
  CLAIM_STATUSES,
  EVIDENCE_VISIBILITIES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  REVIEW_DECISIONS,
  REVIEW_TARGET_TYPES,
  USER_ROLES,
} from './domain.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_REGEX, 'Must be a valid identifier');

export const isoDateSchema = z
  .string()
  .trim()
  .regex(DATE_REGEX, 'Use the YYYY-MM-DD date format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Enter an email address')
  .max(254, 'Email address is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Password is too long')
  .refine((value) => /[A-Za-z]/.test(value), 'Include at least one letter')
  .refine((value) => /\d/.test(value), 'Include at least one number');

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

export const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/, 'Enter an amount with up to two decimal places')
  .refine((value) => Number(value) > 0, 'Amount must be greater than zero');

export const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});

export const registerSchema = z.object({
  fullName: text('Full name', 2, 120),
  email: emailSchema,
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Choose a new password that differs from the current one',
    path: ['newPassword'],
  });

export const objectivesSchema = z
  .array(text('Objective', 8, 300))
  .min(1, 'Add at least one objective')
  .max(12, 'Add no more than 12 objectives');

const projectFields = z.object({
  title: text('Title', 4, 140),
  description: text('Description', 20, 5000),
  problemStatement: text('Problem statement', 20, 3000),
  objectives: objectivesSchema,
  categoryId: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Category identifier is invalid'),
  organizationId: uuidSchema,
  ownerId: uuidSchema,
  locationName: text('Location', 2, 160),
  latitude: z.coerce.number().min(-90, 'Latitude must be between -90 and 90').max(90),
  longitude: z.coerce.number().min(-180, 'Longitude must be between -180 and 180').max(180),
  budgetAmount: moneySchema,
  currency: currencySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  visibility: z.enum(PROJECT_VISIBILITIES),
});

export const createProjectSchema = projectFields.refine((value) => value.endDate >= value.startDate, {
  message: 'Expected completion date cannot be earlier than the start date',
  path: ['endDate'],
});

export const updateProjectSchema = projectFields.partial();

export const projectBudgetSchema = z.object({
  amount: moneySchema,
  currency: currencySchema,
  reason: text('Reason', 10, 1000),
});

export const projectStatusSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  reason: optionalText('Reason', 1000),
});

export const milestoneCreateSchema = z.object({
  title: text('Title', 4, 140),
  description: text('Description', 20, 3000),
  expectedCompletionDate: isoDateSchema,
  deliverables: text('Deliverables', 10, 3000),
  allocatedBudget: z
    .union([moneySchema, z.literal(''), z.null()])
    .optional()
    .transform((value) => (value === '' || value === null || value === undefined ? null : value)),
  responsibleParty: text('Responsible party', 2, 160),
});

export const milestoneUpdateSchema = milestoneCreateSchema.partial();

export const milestoneSubmissionSchema = z.object({
  summary: text('Completion summary', 30, 4000),
  evidenceIds: z.array(uuidSchema).min(1, 'Attach at least one evidence document').max(10),
});

export const expenditureClaimSchema = z.object({
  amount: moneySchema,
  claimedDate: isoDateSchema,
  category: text('Category', 2, 80),
  description: text('Description', 10, 2000),
  supplierName: optionalText('Supplier name', 160),
  supplierReference: optionalText('Supplier reference', 120),
  overBudgetExplanation: optionalText('Over-budget explanation', 2000),
  evidenceIds: z.array(uuidSchema).min(1, 'Attach at least one supporting document').max(10),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  rationale: text('Review explanation', 20, 4000),
});

export const createReviewSchema = z.object({
  targetType: z.enum(REVIEW_TARGET_TYPES),
  targetId: uuidSchema,
  decision: z.enum(REVIEW_DECISIONS),
  rationale: text('Review explanation', 20, 4000),
});

export const reportCreateSchema = z.object({
  format: z.enum(['JSON', 'PRINT']).default('PRINT'),
  title: z.string().trim().min(4).max(160).optional(),
});

export const evidenceMetadataSchema = z.object({
  title: text('Title', 3, 160),
  description: optionalText('Description', 2000),
  visibility: z.enum(EVIDENCE_VISIBILITIES),
  milestoneId: uuidSchema.optional().nullable(),
  claimId: uuidSchema.optional().nullable(),
});

export const anchorPrepareSchema = z.object({
  recordType: z.enum(ANCHOR_RECORD_TYPES),
  recordId: uuidSchema,
});

export const anchorTransactionSchema = z.object({
  txHash: z.string().trim().regex(/^0x[0-9a-f]{64}$/i, 'Enter a valid transaction hash'),
});

export const verificationRequestSchema = z
  .object({
    projectCode: z.string().trim().min(3).max(60).optional(),
    anchorId: uuidSchema.optional(),
    recordType: z.enum(ANCHOR_RECORD_TYPES).optional(),
    recordId: uuidSchema.optional(),
    recordVersion: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => Boolean(value.anchorId) || Boolean(value.projectCode && value.recordType), {
    message: 'Provide an anchor id, or a project code and record type',
  });

export const createUserSchema = z.object({
  fullName: text('Full name', 2, 120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES),
});

export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    fullName: text('Full name', 2, 120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createOrganizationSchema = z.object({
  name: text('Organization name', 2, 160),
  registrationNumber: optionalText('Registration number', 80),
  contactEmail: z.union([emailSchema, z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  website: optionalText('Website', 200),
  description: optionalText('Description', 2000),
});

export const createCategorySchema = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens'),
  label: text('Label', 2, 80),
  description: optionalText('Description', 500),
});

export const updateCategorySchema = z.object({
  label: text('Label', 2, 80).optional(),
  description: optionalText('Description', 500),
  isActive: z.boolean().optional(),
});

export const settingsUpdateSchema = z.object({
  publicDirectoryEnabled: z.boolean().optional(),
  showDemoData: z.boolean().optional(),
  reportFooterNote: z.string().trim().max(500).optional(),
});

export const assignReviewerSchema = z.object({
  reviewerId: uuidSchema,
  conflictNote: optionalText('Conflict declaration', 1000),
});

export const claimStatusesSchema = z.enum(CLAIM_STATUSES);

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectBudgetInput = z.infer<typeof projectBudgetSchema>;
export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;
export type MilestoneSubmissionInput = z.infer<typeof milestoneSubmissionSchema>;
export type ExpenditureClaimInput = z.infer<typeof expenditureClaimSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;
export type EvidenceMetadataInput = z.infer<typeof evidenceMetadataSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type AssignReviewerInput = z.infer<typeof assignReviewerSchema>;
export type VerificationRequestInput = z.infer<typeof verificationRequestSchema>;
