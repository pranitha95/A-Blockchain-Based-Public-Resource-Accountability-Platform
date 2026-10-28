import { canonicalJson } from '@poi/shared';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import {
  ApiClient,
  CHANGED_TEST_PASSWORD,
  ONE_PIXEL_PNG,
  TEST_PASSWORD,
  seedUser,
  todayIso,
  type SeededUser,
} from './helpers.js';

const app = createApp();
const anonymous = new ApiClient(app);
const admin = new ApiClient(app);
const owner = new ApiClient(app);
const reviewer = new ApiClient(app);
const unassignedReviewer = new ApiClient(app);
const observer = new ApiClient(app);

let adminUser: SeededUser;
let ownerUser: SeededUser;
let reviewerUser: SeededUser;
let unassignedReviewerUser: SeededUser;
let observerUser: SeededUser;
let registeredClient: ApiClient;
let registeredEmail = '';

let categoryId = '';
let organizationId = '';
let projectId = '';
let projectCode = '';
let milestoneId = '';
let publicEvidenceId = '';
let restrictedEvidenceId = '';
let milestoneSubmissionId = '';
let claimId = '';
let overBudgetClaimId = '';
let reportId = '';
let reviewerNotificationId = '';

function assertStatus(response: { status: number; body: unknown }, expected: number): void {
  expect(response.status, JSON.stringify(response.body)).toBe(expected);
}

function projectPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Test District Water Access Programme',
    description: 'A test programme rehabilitating community boreholes and improving safe water access in the district.',
    problemStatement: 'Several communities in the test district rely on damaged boreholes and unsafe surface water.',
    objectives: ['Rehabilitate the northern community borehole', 'Train a local water committee in pump maintenance'],
    categoryId: 'test-community',
    organizationId,
    ownerId: ownerUser.id,
    locationName: 'Test District, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    budgetAmount: '2500000.00',
    currency: 'INR',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    visibility: 'PRIVATE',
    ...overrides,
  };
}

beforeAll(async () => {
  [adminUser, ownerUser, reviewerUser, unassignedReviewerUser, observerUser] = await Promise.all([
    seedUser({ email: 'admin@integration.test', fullName: 'Integration Administrator', role: 'ADMIN' }),
    seedUser({ email: 'owner@integration.test', fullName: 'Integration Project Owner', role: 'PROJECT_OWNER' }),
    seedUser({ email: 'reviewer@integration.test', fullName: 'Integration Reviewer', role: 'REVIEWER' }),
    seedUser({
      email: 'reviewer.unassigned@integration.test',
      fullName: 'Unassigned Integration Reviewer',
      role: 'REVIEWER',
    }),
    seedUser({ email: 'observer@integration.test', fullName: 'Integration Observer', role: 'OBSERVER' }),
  ]);

  assertStatus(await admin.login(adminUser.email), 200);
  assertStatus(await owner.login(ownerUser.email), 200);
  assertStatus(await reviewer.login(reviewerUser.email), 200);
  assertStatus(await unassignedReviewer.login(unassignedReviewerUser.email), 200);
  assertStatus(await observer.login(observerUser.email), 200);

  const createdCategory = await admin.post('/api/v1/categories', {
    id: 'test-community',
    label: 'Test community infrastructure',
    description: 'Category reserved for automated integration tests',
  });
  if (createdCategory.status !== 201) {
    throw new Error(`Could not create the integration-test category: ${JSON.stringify(createdCategory.body)}`);
  }
  categoryId = createdCategory.body.data.id;
});

describe('Proof of Impact API integration', () => {
  test('public metadata reports real chain configuration and no fabricated anchors', async () => {
    const health = await anonymous.get('/api/v1/health');
    assertStatus(health, 200);
    expect(health.body.data.database.ok).toBe(true);
    expect(health.body.data.chain.anchoringAvailable).toBe(false);
    expect(health.body.data.chain.contractConfigured).toBe(false);

    const meta = await anonymous.get('/api/v1/meta');
    assertStatus(meta, 200);
    expect(meta.body.data.apiVersion).toBe('v1');
    expect(meta.body.data.chain.chainId).toBe(11155111);
    expect(meta.body.data.chain.contractAddress).toBeNull();
    expect(meta.body.data.platform.demoMode).toBe(true);
    expect(meta.body.data.disclaimers.anchoring).toMatch(/does not prove/i);
    expect(meta.body.data.capabilitiesByRole.ADMIN).toBeTypeOf('object');

    const openapi = await anonymous.get('/api/v1/openapi.json');
    assertStatus(openapi, 200);
    expect(openapi.body.openapi).toBe('3.1.0');
    expect(openapi.body.paths['/projects']).toBeTypeOf('object');

    const anchors = await anonymous.get('/api/v1/anchors');
    assertStatus(anchors, 200);
    expect(anchors.body.data).toEqual([]);
    expect(anchors.body.meta.total).toBe(0);

    const integrity = await anonymous.get('/api/v1/audit/integrity');
    assertStatus(integrity, 200);
    expect(integrity.body.data.valid).toBe(true);
    expect(integrity.body.data.checkedEvents).toBeGreaterThan(0);
  });

  test('self-registration cannot choose a role and unauthenticated writes are rejected', async () => {
    const me = await anonymous.get('/api/v1/auth/me');
    assertStatus(me, 200);
    expect(me.body.data).toBeNull();

    expect(
      (
        await anonymous.post(
          '/api/v1/projects',
          { title: 'Anonymous project attempt' },
          { csrf: false },
        )
      ).status,
    ).toBe(401);

    registeredClient = new ApiClient(app);
    registeredEmail = 'self-registered@integration.test';
    const registration = await registeredClient.register({
      fullName: 'Self Registered Observer',
      email: registeredEmail,
      password: TEST_PASSWORD,
      role: 'ADMIN',
    });
    assertStatus(registration, 201);
    expect(registration.body.data.role).toBe('OBSERVER');
    expect(registration.body.data.capabilities.manageUsers).toBe(false);
    expect(registration.body.data.capabilities.approveProjects).toBe(false);

    const escalation = await registeredClient.post('/api/v1/projects', {});
    assertStatus(escalation, 403);

    const wrongPassword = new ApiClient(app);
    assertStatus(await wrongPassword.login(registeredEmail, 'Definitely-not-the-password-1'), 401);

    const stored = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      registration.body.data.id,
    ]);
    expect(stored.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  test('authenticated writes require a valid CSRF token and an allowed origin', async () => {
    const category = { id: 'csrf-test', label: 'CSRF test category' };

    const missingToken = await admin.post('/api/v1/categories', category, { csrf: false });
    assertStatus(missingToken, 403);
    expect(missingToken.body.error.message).toMatch(/CSRF token is required/i);

    const invalidToken = await admin.agent
      .post('/api/v1/categories')
      .set('X-CSRF-Token', 'not-the-real-token')
      .send(category);
    assertStatus(invalidToken, 403);
    expect(invalidToken.body.error.code).toBe('CSRF_INVALID');

    const rejectedOrigin = await admin.post('/api/v1/categories', category, {
      origin: 'https://attacker.example',
    });
    assertStatus(rejectedOrigin, 403);
    expect(rejectedOrigin.body.error.code).toBe('ORIGIN_REJECTED');

    const accepted = await admin.post(
      '/api/v1/categories',
      { id: 'test-sanitation', label: 'Sanitation and hygiene' },
      { origin: 'http://localhost:5173' },
    );
    assertStatus(accepted, 201);
  });

  test('only an administrator can register a project, and drafts stay hidden', async () => {
    const ownerAttempt = await owner.post('/api/v1/projects', {});
    assertStatus(ownerAttempt, 403);

    const organization = await admin.post('/api/v1/organizations', {
      name: 'Integration Test District Water Authority',
      registrationNumber: 'TEST-REG-001',
      contactEmail: 'water@integration.test',
      website: 'https://water.integration.test',
      description: 'A test organization created by the automated integration suite.',
    });
    assertStatus(organization, 201);
    organizationId = organization.body.data.id;

    const created = await admin.post('/api/v1/projects', projectPayload());
    assertStatus(created, 201);
    projectId = created.body.data.id;
    projectCode = created.body.data.code;
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.visibility).toBe('PRIVATE');
    expect(created.body.data.isDemo).toBe(false);
    expect(created.body.data.owner.id).toBe(ownerUser.id);

    const updated = await owner.patch(`/api/v1/projects/${projectId}`, {
      title: 'Test District Water Access Programme (Phase 1)',
    });
    assertStatus(updated, 200);
    expect(updated.body.data.title).toContain('Phase 1');

    assertStatus(await anonymous.get(`/api/v1/projects/${projectId}`), 404);
    assertStatus(await observer.get(`/api/v1/projects/${projectId}`), 404);
    assertStatus(await reviewer.get(`/api/v1/projects/${projectId}`), 404);

    const ownerView = await owner.get(`/api/v1/projects/${projectId}`);
    assertStatus(ownerView, 200);
    expect(ownerView.body.data.permissions.canEditProject).toBe(true);
    expect(ownerView.body.data.permissions.canSubmitRecords).toBe(false);
    expect(ownerView.body.data.permissions.canApproveProject).toBe(false);

    const anonymousList = await anonymous.get('/api/v1/projects');
    assertStatus(anonymousList, 200);
    expect(anonymousList.body.data.some((item: { id: string }) => item.id === projectId)).toBe(false);
  });

  test('approval requires a milestone, owners cannot approve, and approved private projects remain hidden', async () => {
    const submitted = await owner.patch(`/api/v1/projects/${projectId}/status`, { status: 'SUBMITTED' });
    assertStatus(submitted, 200);
    expect(submitted.body.data.status).toBe('SUBMITTED');

    const approvalWithoutMilestone = await admin.patch(`/api/v1/projects/${projectId}/status`, {
      status: 'APPROVED',
    });
    assertStatus(approvalWithoutMilestone, 422);
    expect(approvalWithoutMilestone.body.error.message).toMatch(/milestone/i);

    const ownerApproval = await owner.patch(`/api/v1/projects/${projectId}/status`, { status: 'APPROVED' });
    assertStatus(ownerApproval, 403);

    const milestone = await owner.post(`/api/v1/projects/${projectId}/milestones`, {
      title: 'Rehabilitate the northern borehole',
      description: 'Rehabilitate the borehole and install a solar-powered pump with the water committee.',
      expectedCompletionDate: '2027-06-30',
      deliverables: 'One rehabilitated borehole, a working solar pump, water-quality testing and operator training.',
      allocatedBudget: '900000.00',
      responsibleParty: 'Integration Test District Water Committee',
    });
    assertStatus(milestone, 201);
    milestoneId = milestone.body.data.id;
    expect(milestone.body.data.status).toBe('PLANNED');

    const approved = await admin.patch(`/api/v1/projects/${projectId}/status`, { status: 'APPROVED' });
    assertStatus(approved, 200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvedAt).toBeTruthy();

    assertStatus(await anonymous.get(`/api/v1/projects/${projectId}`), 404);

    const madePublic = await admin.patch(`/api/v1/projects/${projectId}`, { visibility: 'PUBLIC' });
    assertStatus(madePublic, 200);
    expect(madePublic.body.data.visibility).toBe('PUBLIC');

    const publicView = await anonymous.get(`/api/v1/projects/${projectId}`);
    assertStatus(publicView, 200);
    expect(publicView.body.data.status).toBe('APPROVED');
    expect(publicView.body.data.owner).toBeNull();

    const participantView = await owner.get(`/api/v1/projects/${projectId}`);
    assertStatus(participantView, 200);
    expect(participantView.body.data.owner.fullName).toBe(ownerUser.fullName);

    const publicList = await anonymous.get('/api/v1/projects');
    assertStatus(publicList, 200);
    expect(publicList.body.data.some((item: { id: string }) => item.id === projectId)).toBe(true);

    assertStatus(await anonymous.get(`/api/v1/projects/${projectId}/audit`), 403);
  });

  test('reviewer assignments are administrator-controlled and enforce project independence', async () => {
    assertStatus(await owner.post(`/api/v1/projects/${projectId}/reviewers`, { reviewerId: reviewerUser.id }), 403);

    const ownerAsReviewer = await admin.post(`/api/v1/projects/${projectId}/reviewers`, {
      reviewerId: ownerUser.id,
    });
    assertStatus(ownerAsReviewer, 422);
    expect(ownerAsReviewer.body.error.message).toMatch(/owner cannot be assigned/i);

    const assignment = await admin.post(`/api/v1/projects/${projectId}/reviewers`, {
      reviewerId: reviewerUser.id,
      conflictNote: 'No known conflicts; assigned by the automated test fixture.',
    });
    assertStatus(assignment, 201);

    assertStatus(
      await admin.post(`/api/v1/projects/${projectId}/reviewers`, { reviewerId: reviewerUser.id }),
      409,
    );

    const assignedView = await reviewer.get(`/api/v1/projects/${projectId}`);
    assertStatus(assignedView, 200);
    expect(assignedView.body.data.permissions.canReview).toBe(true);
    expect(assignedView.body.data.permissions.canSeeRestrictedData).toBe(true);

    const unassignedView = await unassignedReviewer.get(`/api/v1/projects/${projectId}`);
    assertStatus(unassignedView, 200);
    expect(unassignedView.body.data.permissions.canReview).toBe(false);
    expect(unassignedView.body.data.permissions.canSeeRestrictedData).toBe(false);

    assertStatus(await reviewer.get(`/api/v1/projects/${projectId}/reviewers`), 200);
    assertStatus(await unassignedReviewer.get(`/api/v1/projects/${projectId}/reviewers`), 403);
  });

  test('evidence uploads validate magic bytes, randomize storage and protect restricted files', async () => {
    const html = Buffer.from('<!doctype html><html><body>Not an accepted evidence file.</body></html>', 'utf8');
    const disguised = await owner.upload(
      `/api/v1/projects/${projectId}/evidence`,
      { title: 'Disguised HTML evidence', visibility: 'PUBLIC' },
      { buffer: html, filename: 'fake-evidence.pdf', contentType: 'application/pdf' },
    );
    assertStatus(disguised, 400);
    expect(disguised.body.error.message).toMatch(/PDF, PNG, JPEG or WebP/i);

    const adminUpload = await admin.upload(
      `/api/v1/projects/${projectId}/evidence`,
      { title: 'Administrator upload attempt', visibility: 'PUBLIC' },
      { buffer: ONE_PIXEL_PNG, filename: 'admin.png', contentType: 'image/png' },
    );
    assertStatus(adminUpload, 403);

    const publicEvidence = await owner.upload(
      `/api/v1/projects/${projectId}/evidence`,
      { title: 'Community site photograph', description: 'Photograph of the rehabilitated site.', visibility: 'PUBLIC' },
      { buffer: ONE_PIXEL_PNG, filename: 'community-site.png', contentType: 'image/png' },
    );
    assertStatus(publicEvidence, 201);
    publicEvidenceId = publicEvidence.body.data.id;
    expect(publicEvidence.body.data.file.originalName).toBe('community-site.png');
    expect(publicEvidence.body.data.file.mimeType).toBe('image/png');
    expect(publicEvidence.body.data.downloadUrl).toBe(`/api/v1/evidence/${publicEvidenceId}/download`);
    expect(publicEvidence.body.data).not.toHaveProperty('storageName');

    const restrictedEvidence = await owner.upload(
      `/api/v1/projects/${projectId}/evidence`,
      { title: 'Supplier banking confirmation', description: 'Restricted supplier document.', visibility: 'RESTRICTED' },
      { buffer: ONE_PIXEL_PNG, filename: 'supplier-bank.png', contentType: 'image/png' },
    );
    assertStatus(restrictedEvidence, 201);
    restrictedEvidenceId = restrictedEvidence.body.data.id;

    const stored = await query<{ storage_name: string }>(
      `SELECT f.storage_name FROM stored_files f JOIN evidence e ON e.file_id = f.id WHERE e.id = $1`,
      [restrictedEvidenceId],
    );
    expect(stored.rows[0]?.storage_name).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(stored.rows[0]?.storage_name).not.toContain('supplier-bank');

    const anonymousEvidence = await anonymous.get(`/api/v1/projects/${projectId}/evidence`);
    assertStatus(anonymousEvidence, 200);
    expect(anonymousEvidence.body.data.some((item: { id: string }) => item.id === publicEvidenceId)).toBe(true);
    expect(anonymousEvidence.body.data.some((item: { id: string }) => item.id === restrictedEvidenceId)).toBe(false);
    expect(anonymousEvidence.body.data[0].uploaderName).toBeNull();

    const ownerEvidence = await owner.get(`/api/v1/projects/${projectId}/evidence`);
    assertStatus(ownerEvidence, 200);
    expect(ownerEvidence.body.data.some((item: { id: string }) => item.id === restrictedEvidenceId)).toBe(true);
    expect(ownerEvidence.body.data[0].uploaderName).toBe(ownerUser.fullName);

    assertStatus(await anonymous.get(`/api/v1/evidence/${restrictedEvidenceId}/download`), 404);
    assertStatus(await unassignedReviewer.get(`/api/v1/evidence/${restrictedEvidenceId}/download`), 404);

    const assignedDownload = await reviewer.get(`/api/v1/evidence/${restrictedEvidenceId}/download`);
    assertStatus(assignedDownload, 200);
    expect(assignedDownload.headers['content-type']).toContain('image/png');
    expect(assignedDownload.headers['content-disposition']).toContain('supplier-bank.png');

    const publicDownload = await anonymous.get(`/api/v1/evidence/${publicEvidenceId}/download`);
    assertStatus(publicDownload, 200);
    expect(publicDownload.headers['content-type']).toContain('image/png');
  });

  test('milestones require owner submission and an assigned reviewer decision', async () => {
    const started = await owner.post(`/api/v1/milestones/${milestoneId}/start`);
    assertStatus(started, 200);
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const inProgress = await owner.get(`/api/v1/projects/${projectId}`);
    assertStatus(inProgress, 200);
    expect(inProgress.body.data.status).toBe('IN_PROGRESS');

    const submission = {
      summary: 'Rehabilitation works are complete; the solar pump was tested with the water committee present.',
      evidenceIds: [publicEvidenceId],
    };
    assertStatus(await anonymous.post(`/api/v1/milestones/${milestoneId}/submit`, submission, { csrf: false }), 401);
    assertStatus(await observer.post(`/api/v1/milestones/${milestoneId}/submit`, submission), 403);
    assertStatus(await reviewer.post(`/api/v1/milestones/${milestoneId}/submit`, submission), 403);

    const submitted = await owner.post(`/api/v1/milestones/${milestoneId}/submit`, submission);
    assertStatus(submitted, 200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.submissions).toHaveLength(1);
    expect(submitted.body.data.submissions[0].status).toBe('SUBMITTED');
    expect(submitted.body.data.submissions[0].evidence[0].id).toBe(publicEvidenceId);
    milestoneSubmissionId = submitted.body.data.submissions[0].id;

    const assignedQueue = await reviewer.get('/api/v1/reviews/queue');
    assertStatus(assignedQueue, 200);
    expect(
      assignedQueue.body.data.some((item: { targetId: string }) => item.targetId === milestoneSubmissionId),
    ).toBe(true);

    const unassignedQueue = await unassignedReviewer.get('/api/v1/reviews/queue');
    assertStatus(unassignedQueue, 200);
    expect(
      unassignedQueue.body.data.some((item: { targetId: string }) => item.targetId === milestoneSubmissionId),
    ).toBe(false);

    const reviewPayload = {
      targetType: 'MILESTONE_SUBMISSION',
      targetId: milestoneSubmissionId,
      decision: 'APPROVED',
      rationale: 'The completion evidence and the committee confirmation support approval of this milestone.',
    };
    assertStatus(await owner.post('/api/v1/reviews', reviewPayload), 403);
    assertStatus(await admin.post('/api/v1/reviews', reviewPayload), 403);
    assertStatus(await observer.post('/api/v1/reviews', reviewPayload), 403);
    assertStatus(await unassignedReviewer.post('/api/v1/reviews', reviewPayload), 403);

    const decision = await reviewer.post('/api/v1/reviews', reviewPayload);
    assertStatus(decision, 201);
    expect(decision.body.data.decision).toBe('APPROVED');
    expect(decision.body.data.reviewerName).toBe(reviewerUser.fullName);

    assertStatus(await reviewer.post('/api/v1/reviews', reviewPayload), 409);

    const milestoneDetail = await anonymous.get(`/api/v1/milestones/${milestoneId}`);
    assertStatus(milestoneDetail, 200);
    expect(milestoneDetail.body.data.status).toBe('APPROVED');
    expect(milestoneDetail.body.data.submissions[0].status).toBe('APPROVED');

    const publicReviews = await anonymous.get(`/api/v1/projects/${projectId}/reviews`);
    assertStatus(publicReviews, 200);
    expect(publicReviews.body.data[0].reviewerName).toBe('Independent reviewer');
    expect(publicReviews.body.data[0].reviewerRole).toBe('REVIEWER');
  });

  test('expenditure claims enforce budget rules and reviewer independence', async () => {
    const baseClaim = {
      claimedDate: todayIso(),
      category: 'Construction materials',
      description: 'Replacement pump components and installation consumables purchased for the borehole.',
      supplierName: 'Integration Test Supplier',
      supplierReference: 'INV-TEST-001',
      evidenceIds: [publicEvidenceId],
    };

    assertStatus(
      await anonymous.post(`/api/v1/projects/${projectId}/claims`, { ...baseClaim, amount: '100.00' }, { csrf: false }),
      401,
    );
    assertStatus(
      await observer.post(`/api/v1/projects/${projectId}/claims`, { ...baseClaim, amount: '100.00' }),
      403,
    );

    const firstClaim = await owner.post(`/api/v1/projects/${projectId}/claims`, {
      ...baseClaim,
      amount: '500000.00',
    });
    assertStatus(firstClaim, 201);
    claimId = firstClaim.body.data.id;
    expect(firstClaim.body.data.reference).toMatch(/^EXP-\d{4}-\d{5}$/);
    expect(firstClaim.body.data.status).toBe('SUBMITTED');
    expect(firstClaim.body.data.overBudget).toBe(false);
    expect(firstClaim.body.data.currency).toBe('INR');

    const overBudgetRejected = await owner.post(`/api/v1/projects/${projectId}/claims`, {
      ...baseClaim,
      amount: '2100000.00',
    });
    assertStatus(overBudgetRejected, 422);
    expect(overBudgetRejected.body.error.message).toMatch(/over-budget explanation/i);
    expect(overBudgetRejected.body.error.details.budget).toBe('2500000.00');

    const overBudgetClaim = await owner.post(`/api/v1/projects/${projectId}/claims`, {
      ...baseClaim,
      amount: '2100000.00',
      overBudgetExplanation:
        'The pump replacement exceeded the original allocation because the borehole required deeper casing and additional fittings.',
    });
    assertStatus(overBudgetClaim, 201);
    overBudgetClaimId = overBudgetClaim.body.data.id;
    expect(overBudgetClaim.body.data.overBudget).toBe(true);

    const claimReview = {
      targetType: 'EXPENDITURE_CLAIM',
      targetId: claimId,
      decision: 'APPROVED',
      rationale: 'The invoice, supplier reference and delivery evidence support this claimed expenditure.',
    };
    assertStatus(await owner.post('/api/v1/reviews', claimReview), 403);

    const firstDecision = await reviewer.post('/api/v1/reviews', claimReview);
    assertStatus(firstDecision, 201);
    const approvedClaim = await owner.get(`/api/v1/claims/${claimId}`);
    assertStatus(approvedClaim, 200);
    expect(approvedClaim.body.data.status).toBe('APPROVED');
    expect(approvedClaim.body.data.reviews[0].decision).toBe('APPROVED');

    assertStatus(await reviewer.post('/api/v1/reviews', claimReview), 409);

    const overBudgetReview = {
      targetType: 'EXPENDITURE_CLAIM',
      targetId: overBudgetClaimId,
      decision: 'APPROVED',
      rationale: 'The documented over-budget explanation and supporting supplier evidence justify approval.',
    };
    assertStatus(await unassignedReviewer.post('/api/v1/reviews', overBudgetReview), 403);
    assertStatus(await reviewer.post('/api/v1/reviews', overBudgetReview), 201);
  });

  test('accountability reports are participant-only immutable snapshots with verifiable checksums', async () => {
    assertStatus(await anonymous.post(`/api/v1/projects/${projectId}/reports`, {}, { csrf: false }), 401);
    assertStatus(await observer.post(`/api/v1/projects/${projectId}/reports`, {}), 403);
    assertStatus(await unassignedReviewer.post(`/api/v1/projects/${projectId}/reports`, {}), 403);

    const report = await owner.post(`/api/v1/projects/${projectId}/reports`, { format: 'PRINT' });
    assertStatus(report, 201);
    reportId = report.body.data.id;
    expect(report.body.data.format).toBe('PRINT');
    expect(report.body.data.checksum).toMatch(/^[0-9a-f]{64}$/);

    const snapshot = report.body.data.snapshot;
    expect(snapshot.reportSchemaVersion).toBe(1);
    expect(snapshot.project.code).toBe(projectCode);
    expect(snapshot.disclosures.join(' ')).toMatch(/does not prove/i);

    const recomputed = createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex');
    expect(recomputed).toBe(report.body.data.checksum);

    assertStatus(await anonymous.get(`/api/v1/reports/${reportId}`), 401);
    assertStatus(await observer.get('/api/v1/reports'), 403);
    assertStatus(await unassignedReviewer.get(`/api/v1/reports/${reportId}`), 404);
    assertStatus(await reviewer.get(`/api/v1/reports/${reportId}`), 200);

    const ownerReports = await owner.get(`/api/v1/reports?projectId=${projectId}`);
    assertStatus(ownerReports, 200);
    expect(ownerReports.body.data.some((item: { id: string }) => item.id === reportId)).toBe(true);
  });

  test('the audit chain is participant-only and append-only at the database level', async () => {
    const audit = await owner.get(`/api/v1/projects/${projectId}/audit?pageSize=100`);
    assertStatus(audit, 200);
    const actions = audit.body.data.map((event: { action: string }) => event.action);
    expect(actions).toContain('PROJECT_APPROVED');
    expect(actions).toContain('REVIEW_APPROVED');
    expect(actions).toContain('EXPENDITURE_CREATED');
    expect(audit.body.data.every((event: { eventHash: string }) => /^[0-9a-f]{64}$/.test(event.eventHash))).toBe(true);

    assertStatus(await reviewer.get(`/api/v1/projects/${projectId}/audit`), 200);
    assertStatus(await unassignedReviewer.get(`/api/v1/projects/${projectId}/audit`), 403);
    assertStatus(await observer.get(`/api/v1/projects/${projectId}/audit`), 403);
    assertStatus(await anonymous.get(`/api/v1/projects/${projectId}/audit`), 403);

    const integrity = await anonymous.get('/api/v1/audit/integrity');
    assertStatus(integrity, 200);
    expect(integrity.body.data.valid).toBe(true);
    expect(integrity.body.data.checkedEvents).toBeGreaterThanOrEqual(10);

    await expect(query("UPDATE audit_events SET summary = 'tampered by test'")).rejects.toThrow(/append-only/i);
    await expect(query('DELETE FROM audit_events')).rejects.toThrow(/append-only/i);
    await expect(query("UPDATE reviews SET rationale = 'tampered by test'")).rejects.toThrow(/immutable/i);

    const stillValid = await anonymous.get('/api/v1/audit/integrity');
    assertStatus(stillValid, 200);
    expect(stillValid.body.data.valid).toBe(true);
  });

  test('blockchain endpoints report an honest unconfigured state and never fabricate anchors', async () => {
    const chainInfo = await anonymous.get('/api/v1/anchors/chain-info');
    assertStatus(chainInfo, 200);
    expect(chainInfo.body.data.chainId).toBe(11155111);
    expect(chainInfo.body.data.contractAddress).toBeNull();
    expect(chainInfo.body.data.anchoringAvailable).toBe(false);

    const prepare = await owner.post('/api/v1/anchors/prepare', {
      recordType: 'PROJECT',
      recordId: projectId,
    });
    assertStatus(prepare, 503);
    expect(prepare.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(prepare.body.error.message).toMatch(/registry address is not configured/i);

    const anchorRows = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM blockchain_anchors');
    expect(anchorRows.rows[0]?.count).toBe('0');

    const verification = await anonymous.post('/api/v1/verify', {
      projectCode,
      recordType: 'PROJECT',
    });
    assertStatus(verification, 200);
    expect(verification.body.data.status).toBe('NOT_FOUND');
    expect(verification.body.data.commitment).toBeNull();
    expect(verification.body.data.anchorStatus).toBeNull();
    expect(verification.body.data.explanation).toMatch(/No anchored commitment exists/i);

    assertStatus(await anonymous.get(`/api/v1/verify/${randomUUID()}`), 404);

    const invalidVerification = await anonymous.post('/api/v1/verify', { projectCode });
    assertStatus(invalidVerification, 400);

    const anchors = await anonymous.get('/api/v1/anchors');
    assertStatus(anchors, 200);
    expect(anchors.body.data).toEqual([]);
  });

  test('notifications are scoped to the signed-in user and can be marked read', async () => {
    assertStatus(await anonymous.get('/api/v1/notifications'), 401);

    const reviewerNotifications = await reviewer.get('/api/v1/notifications');
    assertStatus(reviewerNotifications, 200);
    expect(reviewerNotifications.body.meta.unreadCount).toBeGreaterThan(0);
    expect(reviewerNotifications.body.data.length).toBeGreaterThan(0);
    const unread = reviewerNotifications.body.data.find((item: { readAt: string | null }) => item.readAt === null);
    expect(unread).toBeTruthy();
    reviewerNotificationId = unread.id;

    const observerNotifications = await observer.get('/api/v1/notifications');
    assertStatus(observerNotifications, 200);
    expect(observerNotifications.body.meta.total).toBe(0);

    assertStatus(await admin.patch(`/api/v1/notifications/${reviewerNotificationId}/read`, {}), 404);

    const readAll = await reviewer.post('/api/v1/notifications/read-all', {});
    assertStatus(readAll, 200);
    expect(readAll.body.data.updated).toBeGreaterThanOrEqual(1);

    const marked = await reviewer.patch(`/api/v1/notifications/${reviewerNotificationId}/read`, {});
    assertStatus(marked, 200);
    expect(marked.body.data.readAt).toBeTruthy();

    const unreadOnly = await reviewer.get('/api/v1/notifications?unreadOnly=true');
    assertStatus(unreadOnly, 200);
    expect(unreadOnly.body.meta.unreadCount).toBe(0);
    expect(unreadOnly.body.data).toEqual([]);
  });

  test('password changes require the current password, revoke sessions and store Argon2id hashes', async () => {
    const wrongCurrent = await registeredClient.post('/api/v1/auth/change-password', {
      currentPassword: 'Wrong-current-password-1',
      newPassword: CHANGED_TEST_PASSWORD,
      confirmPassword: CHANGED_TEST_PASSWORD,
    });
    assertStatus(wrongCurrent, 400);

    const changed = await registeredClient.post('/api/v1/auth/change-password', {
      currentPassword: TEST_PASSWORD,
      newPassword: CHANGED_TEST_PASSWORD,
      confirmPassword: CHANGED_TEST_PASSWORD,
    });
    assertStatus(changed, 200);
    expect(changed.body.data.changed).toBe(true);

    const afterChange = await registeredClient.get('/api/v1/auth/me');
    assertStatus(afterChange, 200);
    expect(afterChange.body.data).toBeNull();

    const oldLogin = new ApiClient(app);
    assertStatus(await oldLogin.login(registeredEmail, TEST_PASSWORD), 401);

    const newLogin = new ApiClient(app);
    assertStatus(await newLogin.login(registeredEmail, CHANGED_TEST_PASSWORD), 200);

    const stored = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE lower(email) = lower($1)',
      [registeredEmail],
    );
    expect(stored.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(stored.rows[0]?.password_hash).not.toContain(CHANGED_TEST_PASSWORD);
  });

  test('the public directory setting gates only anonymous listing, not direct public pages', async () => {
    const disabled = await admin.patch('/api/v1/admin/settings', { publicDirectoryEnabled: false });
    assertStatus(disabled, 200);
    expect(disabled.body.data.publicDirectoryEnabled).toBe(false);

    const anonymousList = await anonymous.get('/api/v1/projects');
    assertStatus(anonymousList, 404);
    expect(anonymousList.body.error.message).toMatch(/directory is currently disabled/i);

    assertStatus(await observer.get('/api/v1/projects'), 404);
    assertStatus(await owner.get('/api/v1/projects'), 200);
    assertStatus(await anonymous.get(`/api/v1/projects/${projectId}`), 200);

    const restored = await admin.patch('/api/v1/admin/settings', { publicDirectoryEnabled: true });
    assertStatus(restored, 200);
    assertStatus(await anonymous.get('/api/v1/projects'), 200);
  });

  test('completion requires resolved reviews and makes the project read-only', async () => {
    const completed = await admin.patch(`/api/v1/projects/${projectId}/status`, { status: 'COMPLETED' });
    assertStatus(completed, 200);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.completedAt).toBeTruthy();

    const publicView = await anonymous.get(`/api/v1/projects/${projectId}`);
    assertStatus(publicView, 200);
    expect(publicView.body.data.status).toBe('COMPLETED');

    const lateEvidence = await owner.upload(
      `/api/v1/projects/${projectId}/evidence`,
      { title: 'Late evidence upload', visibility: 'PUBLIC' },
      { buffer: ONE_PIXEL_PNG, filename: 'late.png', contentType: 'image/png' },
    );
    assertStatus(lateEvidence, 403);
    expect(lateEvidence.body.error.message).toMatch(/active/i);

    const lateClaim = await owner.post(`/api/v1/projects/${projectId}/claims`, {
      amount: '1000.00',
      claimedDate: todayIso(),
      category: 'Late claim',
      description: 'A claim submitted after the project was completed should be rejected.',
      evidenceIds: [publicEvidenceId],
    });
    assertStatus(lateClaim, 403);
  });

  test('administrator user management is server-enforced', async () => {
    assertStatus(await observer.get('/api/v1/users'), 403);
    assertStatus(await owner.get('/api/v1/users'), 403);

    const created = await admin.post('/api/v1/users', {
      fullName: 'Administratively Created Reviewer',
      email: 'new.reviewer@integration.test',
      password: TEST_PASSWORD,
      role: 'REVIEWER',
    });
    assertStatus(created, 201);
    expect(created.body.data.role).toBe('REVIEWER');

    const login = new ApiClient(app);
    assertStatus(await login.login('new.reviewer@integration.test'), 200);

    const duplicate = await admin.post('/api/v1/users', {
      fullName: 'Duplicate Reviewer Account',
      email: 'new.reviewer@integration.test',
      password: TEST_PASSWORD,
      role: 'REVIEWER',
    });
    assertStatus(duplicate, 409);

    const users = await admin.get('/api/v1/users?role=REVIEWER');
    assertStatus(users, 200);
    expect(users.body.data.some((user: { email: string }) => user.email === 'new.reviewer@integration.test')).toBe(true);
  });
});
