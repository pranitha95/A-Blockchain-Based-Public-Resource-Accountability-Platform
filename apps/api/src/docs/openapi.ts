const errorResponse = {
  description: 'Request failed',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
};

const unauthorized = { ...errorResponse, description: 'Authentication required or session expired' };
const forbidden = { ...errorResponse, description: 'Insufficient role or project permission' };
const notFound = { ...errorResponse, description: 'Resource not found or not visible to this caller' };
const validationError = { ...errorResponse, description: 'Request validation failed' };

const dataResponse = (description: string, schema: Record<string, unknown>) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { data: schema },
      },
    },
  },
});

const paginatedResponse = (description: string, itemSchema: Record<string, unknown>) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: itemSchema },
          meta: { $ref: '#/components/schemas/PaginationMeta' },
        },
      },
    },
  },
});

const projectIdParam = {
  name: 'projectId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const idParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});

const auth = [{ sessionCookie: [] }];

const projectBody = {
  type: 'object',
  required: [
    'title',
    'description',
    'problemStatement',
    'objectives',
    'categoryId',
    'organizationId',
    'ownerId',
    'locationName',
    'latitude',
    'longitude',
    'budgetAmount',
    'currency',
    'startDate',
    'endDate',
    'visibility',
  ],
  properties: {
    title: { type: 'string', minLength: 4, maxLength: 140 },
    description: { type: 'string', minLength: 20, maxLength: 5000 },
    problemStatement: { type: 'string', minLength: 20, maxLength: 3000 },
    objectives: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
    categoryId: { type: 'string' },
    organizationId: { type: 'string', format: 'uuid' },
    ownerId: { type: 'string', format: 'uuid' },
    locationName: { type: 'string' },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    budgetAmount: { type: 'string', example: '250000.00', description: 'Decimal string; never a floating-point number' },
    currency: { type: 'string', example: 'INR' },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
    visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] },
  },
} as const;

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Proof of Impact API',
    version: '1.0.0',
    description:
      'A public resource accountability platform. Projects, milestones, evidence, reviewed expenditure claims and blockchain commitments are exposed through a versioned REST API. Confirmed anchors prove that a commitment existed on-chain; they do not prove that the underlying records are true. All mutating session-authenticated requests require the X-CSRF-Token header copied from the readable poi_csrf cookie. Amounts are decimal strings in their explicit currency.',
  },
  servers: [{ url: '/api/v1', description: 'Versioned API root' }],
  tags: [
    { name: 'System' },
    { name: 'Auth' },
    { name: 'Projects' },
    { name: 'Milestones' },
    { name: 'Expenditure' },
    { name: 'Evidence' },
    { name: 'Reviews' },
    { name: 'Blockchain' },
    { name: 'Reports' },
    { name: 'Notifications' },
    { name: 'Audit' },
    { name: 'Administration' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'poi_session',
        description: 'Opaque HttpOnly session cookie issued by /auth/login or /auth/register.',
      },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'Read from the non-HttpOnly poi_csrf cookie. Required on authenticated mutating requests.',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              requestId: { type: 'string' },
            },
          },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      SessionUser: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: { type: 'string', enum: ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
          isDemo: { type: 'boolean' },
          capabilities: { type: 'object' },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', example: 'POI-2026-0001' },
          title: { type: 'string' },
          description: { type: 'string' },
          problemStatement: { type: 'string' },
          objectives: { type: 'array', items: { type: 'string' } },
          categoryId: { type: 'string' },
          categoryLabel: { type: 'string' },
          budgetAmount: { type: 'string' },
          currency: { type: 'string' },
          claimedAmount: { type: 'string' },
          approvedClaimAmount: { type: 'string' },
          status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED'] },
          visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] },
          isDemo: { type: 'boolean' },
          permissions: { type: 'object' },
        },
      },
      Anchor: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          recordType: { type: 'string', enum: ['PROJECT', 'MILESTONE_SUBMISSION', 'REVIEW', 'EXPENDITURE_CLAIM', 'AUDIT_BATCH'] },
          recordId: { type: 'string', format: 'uuid' },
          recordVersion: { type: 'integer' },
          contentDigest: { type: 'string', pattern: '^0x[0-9a-f]{64}$' },
          commitment: { type: 'string', pattern: '^0x[0-9a-f]{64}$' },
          status: { type: 'string', enum: ['AWAITING_WALLET', 'TRANSACTION_SUBMITTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'VERIFICATION_ERROR'] },
          txHash: { type: 'string', nullable: true },
          blockNumber: { type: 'integer', nullable: true },
          confirmations: { type: 'integer', nullable: true },
        },
      },
      VerificationResult: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['MATCH', 'MISMATCH', 'NOT_FOUND', 'VERIFICATION_ERROR'] },
          explanation: { type: 'string' },
          commitment: { type: 'string', nullable: true },
          recomputedContentDigest: { type: 'string', nullable: true },
          onChainContentDigest: { type: 'string', nullable: true },
          digestMatches: { type: 'boolean', nullable: true },
          commitmentMatches: { type: 'boolean', nullable: true },
          txHash: { type: 'string', nullable: true },
          explorerUrl: { type: 'string', nullable: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness and readiness check',
        responses: { '200': { description: 'Database reachable' }, '503': { description: 'Database unavailable' } },
      },
    },
    '/meta': {
      get: {
        tags: ['System'],
        summary: 'Public platform metadata, categories, chain configuration and disclaimers',
        responses: { '200': { description: 'Metadata' } },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['System'],
        summary: 'This OpenAPI document',
        responses: { '200': { description: 'OpenAPI 3.1 document' } },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a public observer account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fullName', 'email', 'password'],
                properties: {
                  fullName: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 10 },
                },
              },
            },
          },
        },
        responses: {
          '201': dataResponse('Observer account created and signed in', { $ref: '#/components/schemas/SessionUser' }),
          '400': validationError,
          '429': errorResponse,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': dataResponse('Session created', { $ref: '#/components/schemas/SessionUser' }),
          '401': errorResponse,
          '429': errorResponse,
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current session',
        security: auth,
        responses: { '200': { description: 'Signed out' }, '401': unauthorized },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current session user, or null',
        responses: { '200': dataResponse('Current user or null', { $ref: '#/components/schemas/SessionUser' }) },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change the current password and revoke other sessions',
        security: auth,
        responses: { '200': { description: 'Password changed' }, '400': validationError, '401': unauthorized },
      },
    },
    '/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects visible to the caller',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated project statuses' },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'organizationId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'overdue', in: 'query', schema: { type: 'boolean' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['updated', 'budget', 'deadline', 'title', 'claimed'] } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': paginatedResponse('Projects', { $ref: '#/components/schemas/Project' }) },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project (administrator only)',
        security: auth,
        requestBody: { required: true, content: { 'application/json': { schema: projectBody } } },
        responses: {
          '201': dataResponse('Project created', { $ref: '#/components/schemas/Project' }),
          '400': validationError,
          '403': forbidden,
        },
      },
    },
    '/projects/{projectId}': {
      get: {
        tags: ['Projects'],
        summary: 'Project detail with role-aware permissions',
        parameters: [projectIdParam],
        responses: { '200': dataResponse('Project', { $ref: '#/components/schemas/Project' }), '404': notFound },
      },
      patch: {
        tags: ['Projects'],
        summary: 'Update an editable project (owner or administrator)',
        security: auth,
        parameters: [projectIdParam],
        responses: { '200': dataResponse('Updated project', { $ref: '#/components/schemas/Project' }), '403': forbidden, '409': errorResponse },
      },
    },
    '/projects/{projectId}/status': {
      patch: {
        tags: ['Projects'],
        summary: 'Change project lifecycle status (server-enforced transition rules)',
        security: auth,
        parameters: [projectIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED'] },
                  reason: { type: 'string', maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: { '200': dataResponse('Updated project', { $ref: '#/components/schemas/Project' }), '403': forbidden, '422': errorResponse },
      },
    },
    '/projects/{projectId}/budget': {
      patch: {
        tags: ['Projects'],
        summary: 'Record an explicit, versioned budget change',
        security: auth,
        parameters: [projectIdParam],
        responses: { '200': dataResponse('Updated project', { $ref: '#/components/schemas/Project' }), '403': forbidden },
      },
    },
    '/projects/{projectId}/status-history': {
      get: {
        tags: ['Projects'],
        summary: 'Project lifecycle history; change-actor names are withheld from public callers',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Status history' }, '404': notFound },
      },
    },
    '/projects/{projectId}/budget-history': {
      get: {
        tags: ['Projects'],
        summary: 'Versioned budget history; change-actor names are withheld from public callers',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Budget history' }, '404': notFound },
      },
    },
    '/projects/{projectId}/milestones': {
      get: {
        tags: ['Milestones'],
        summary: 'List milestones and visible submissions',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Milestones' } },
      },
      post: {
        tags: ['Milestones'],
        summary: 'Create a milestone (owner or administrator)',
        security: auth,
        parameters: [projectIdParam],
        responses: { '201': { description: 'Milestone created' }, '403': forbidden },
      },
    },
    '/projects/{projectId}/claims': {
      get: {
        tags: ['Expenditure'],
        summary: 'List expenditure claims; restricted fields require participant access',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Claims' } },
      },
      post: {
        tags: ['Expenditure'],
        summary: 'Submit an expenditure claim with evidence (owner only)',
        security: auth,
        parameters: [projectIdParam],
        responses: { '201': { description: 'Claim submitted' }, '403': forbidden, '422': errorResponse },
      },
    },
    '/projects/{projectId}/evidence': {
      get: {
        tags: ['Evidence'],
        summary: 'List evidence visible to the caller',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Evidence metadata' } },
      },
      post: {
        tags: ['Evidence'],
        summary: 'Upload evidence (multipart: file plus title, visibility, optional milestoneId/claimId)',
        security: auth,
        parameters: [projectIdParam],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'title', 'visibility'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'PDF, PNG, JPEG or WebP, validated by magic bytes' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  visibility: { type: 'string', enum: ['PUBLIC', 'RESTRICTED'] },
                  milestoneId: { type: 'string', format: 'uuid' },
                  claimId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Evidence stored' }, '400': errorResponse, '413': errorResponse },
      },
    },
    '/projects/{projectId}/reviews': {
      get: {
        tags: ['Reviews'],
        summary: 'Reviews recorded for the project (reviewer names masked publicly)',
        parameters: [projectIdParam],
        responses: { '200': { description: 'Reviews' } },
      },
    },
    '/projects/{projectId}/reviewers': {
      get: {
        tags: ['Projects'],
        summary: 'Reviewer assignments for project participants',
        security: auth,
        parameters: [projectIdParam],
        responses: { '200': { description: 'Assignments' }, '403': forbidden },
      },
      post: {
        tags: ['Projects'],
        summary: 'Assign an independent reviewer (administrator only)',
        security: auth,
        parameters: [projectIdParam],
        responses: { '201': { description: 'Assigned' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/projects/{projectId}/eligible-reviewers': {
      get: {
        tags: ['Projects'],
        summary: 'Reviewer accounts eligible for assignment (administrator only)',
        security: auth,
        parameters: [projectIdParam, { name: 'search', in: 'query', schema: { type: 'string', maxLength: 120 } }],
        responses: { '200': { description: 'Eligible reviewers' }, '403': forbidden },
      },
    },
    '/projects/{projectId}/reviewers/{assignmentId}': {
      delete: {
        tags: ['Projects'],
        summary: 'Remove a reviewer assignment without deleting its review history (administrator only)',
        security: auth,
        parameters: [projectIdParam, idParam('assignmentId')],
        responses: { '200': { description: 'Assignment removed' }, '403': forbidden, '404': notFound },
      },
    },
    '/projects/{projectId}/reports': {
      post: {
        tags: ['Reports'],
        summary: 'Generate a point-in-time accountability report snapshot',
        security: auth,
        parameters: [projectIdParam],
        responses: { '201': { description: 'Report generated' }, '403': forbidden },
      },
    },
    '/projects/{projectId}/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Project audit events, filtered by caller permissions',
        security: auth,
        parameters: [projectIdParam],
        responses: { '200': { description: 'Audit events' }, '403': forbidden },
      },
    },
    '/milestones/{milestoneId}': {
      get: {
        tags: ['Milestones'],
        summary: 'Milestone detail and submissions',
        parameters: [idParam('milestoneId')],
        responses: { '200': { description: 'Milestone' }, '404': notFound },
      },
      patch: {
        tags: ['Milestones'],
        summary: 'Update a planned or in-progress milestone',
        security: auth,
        parameters: [idParam('milestoneId')],
        responses: { '200': { description: 'Updated milestone' }, '409': errorResponse },
      },
    },
    '/milestones/{milestoneId}/start': {
      post: {
        tags: ['Milestones'],
        summary: 'Start a planned milestone (owner; may advance an approved project)',
        security: auth,
        parameters: [idParam('milestoneId')],
        responses: { '200': { description: 'Started' }, '403': forbidden },
      },
    },
    '/milestones/{milestoneId}/submit': {
      post: {
        tags: ['Milestones'],
        summary: 'Submit milestone completion with evidence for independent review',
        security: auth,
        parameters: [idParam('milestoneId')],
        responses: { '200': { description: 'Submitted' }, '400': validationError, '409': errorResponse },
      },
    },
    '/milestones/{milestoneId}/submissions': {
      get: {
        tags: ['Milestones'],
        summary: 'Milestone submission versions with visibility filtered for the caller',
        parameters: [idParam('milestoneId')],
        responses: { '200': { description: 'Submissions' }, '404': notFound },
      },
    },
    '/claims/{claimId}': {
      get: {
        tags: ['Expenditure'],
        summary: 'Claim detail',
        parameters: [idParam('claimId')],
        responses: { '200': { description: 'Claim' }, '404': notFound },
      },
    },
    '/claims/{claimId}/amend': {
      post: {
        tags: ['Expenditure'],
        summary: 'Create a new version of an amendable claim; history is preserved',
        security: auth,
        parameters: [idParam('claimId')],
        responses: { '201': { description: 'New claim version' }, '409': errorResponse },
      },
    },
    '/claims/{claimId}/versions': {
      get: {
        tags: ['Expenditure'],
        summary: 'All versions of a claim visible to the caller',
        parameters: [idParam('claimId')],
        responses: { '200': { description: 'Claim versions' } },
      },
    },
    '/evidence/{evidenceId}/download': {
      get: {
        tags: ['Evidence'],
        summary: 'Download evidence when visible and permissioned',
        parameters: [idParam('evidenceId')],
        responses: { '200': { description: 'File bytes' }, '404': notFound, '409': errorResponse },
      },
    },
    '/reviews/queue': {
      get: {
        tags: ['Reviews'],
        summary: 'Review work queue for the signed-in role',
        security: auth,
        responses: { '200': { description: 'Queue items' }, '401': unauthorized },
      },
    },
    '/reviews': {
      post: {
        tags: ['Reviews'],
        summary: 'Record an independent review decision (assigned reviewers only)',
        security: auth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetType', 'targetId', 'decision', 'rationale'],
                properties: {
                  targetType: { type: 'string', enum: ['MILESTONE_SUBMISSION', 'EXPENDITURE_CLAIM'] },
                  targetId: { type: 'string', format: 'uuid' },
                  decision: { type: 'string', enum: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'DISCREPANCY_OPENED'] },
                  rationale: { type: 'string', minLength: 20 },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Review recorded' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/anchors': {
      get: {
        tags: ['Blockchain'],
        summary: 'List blockchain anchors visible to the caller',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'recordType', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': paginatedResponse('Anchors', { $ref: '#/components/schemas/Anchor' }) },
      },
    },
    '/anchors/chain-info': {
      get: {
        tags: ['Blockchain'],
        summary: 'Configured chain, registry address and anchoring availability',
        responses: { '200': { description: 'Chain configuration' } },
      },
    },
    '/anchors/prepare': {
      post: {
        tags: ['Blockchain'],
        summary: 'Prepare a deterministic commitment for wallet submission (administrator or owner)',
        security: auth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['recordType', 'recordId'],
                properties: {
                  recordType: { type: 'string', enum: ['PROJECT', 'MILESTONE_SUBMISSION', 'REVIEW', 'EXPENDITURE_CLAIM', 'AUDIT_BATCH'] },
                  recordId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { '201': dataResponse('Anchor awaiting a wallet transaction', { $ref: '#/components/schemas/Anchor' }), '409': errorResponse, '503': errorResponse },
      },
    },
    '/anchors/{anchorId}': {
      get: {
        tags: ['Blockchain'],
        summary: 'Anchor detail including locally prepared ABI arguments and verification state',
        parameters: [idParam('anchorId')],
        responses: { '200': { description: 'Anchor' }, '404': notFound },
      },
    },
    '/anchors/{anchorId}/transaction': {
      post: {
        tags: ['Blockchain'],
        summary: 'Record a wallet transaction hash and verify its receipt and registry event',
        security: auth,
        parameters: [idParam('anchorId')],
        responses: { '200': dataResponse('Anchor after verification', { $ref: '#/components/schemas/Anchor' }), '409': errorResponse },
      },
    },
    '/anchors/{anchorId}/reconcile': {
      post: {
        tags: ['Blockchain'],
        summary: 'Re-check a submitted transaction against the chain',
        security: auth,
        parameters: [idParam('anchorId')],
        responses: { '200': { description: 'Reconciled anchor' }, '403': forbidden },
      },
    },
    '/verify': {
      post: {
        tags: ['Blockchain'],
        summary: 'Verify a record commitment against the configured chain (public)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  anchorId: { type: 'string', format: 'uuid' },
                  projectCode: { type: 'string' },
                  recordType: { type: 'string' },
                  recordId: { type: 'string', format: 'uuid' },
                  recordVersion: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { '200': dataResponse('Verification result', { $ref: '#/components/schemas/VerificationResult' }) },
      },
    },
    '/verify/{anchorId}': {
      get: {
        tags: ['Blockchain'],
        summary: 'Verify one anchor by identifier (public)',
        parameters: [idParam('anchorId')],
        responses: { '200': dataResponse('Verification result', { $ref: '#/components/schemas/VerificationResult' }) },
      },
    },
    '/stats/overview': {
      get: {
        tags: ['Projects'],
        summary: 'Role-scoped dashboard metrics with per-currency monetary totals',
        responses: { '200': { description: 'Overview' } },
      },
    },
    '/reports': {
      get: {
        tags: ['Reports'],
        summary: 'List reports available to the signed-in user',
        security: auth,
        responses: { '200': { description: 'Reports' }, '403': forbidden },
      },
    },
    '/reports/{reportId}': {
      get: {
        tags: ['Reports'],
        summary: 'Report snapshot and checksum',
        security: auth,
        parameters: [idParam('reportId')],
        responses: { '200': { description: 'Report' }, '404': notFound },
      },
    },
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List notifications for the signed-in user',
        security: auth,
        responses: { '200': { description: 'Notifications' } },
      },
    },
    '/notifications/{notificationId}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark one notification read',
        security: auth,
        parameters: [idParam('notificationId')],
        responses: { '200': { description: 'Updated notification' } },
      },
    },
    '/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark all notifications read',
        security: auth,
        responses: { '200': { description: 'Count updated' } },
      },
    },
    '/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Public or role-scoped audit trail',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Audit events' } },
      },
    },
    '/audit/integrity': {
      get: {
        tags: ['Audit'],
        summary: 'Recompute the append-only audit hash chain',
        responses: { '200': { description: 'Integrity result' } },
      },
    },
    '/settings': {
      get: {
        tags: ['Administration'],
        summary: 'Public platform settings and demonstration-data label',
        responses: { '200': { description: 'Public settings' } },
      },
    },
    '/admin/settings': {
      get: {
        tags: ['Administration'],
        summary: 'Full platform settings (administrator)',
        security: auth,
        responses: { '200': { description: 'Settings' }, '403': forbidden },
      },
      patch: {
        tags: ['Administration'],
        summary: 'Update platform settings (administrator)',
        security: auth,
        responses: { '200': { description: 'Updated settings' }, '403': forbidden },
      },
    },
    '/users': {
      get: {
        tags: ['Administration'],
        summary: 'List platform users (administrator)',
        security: auth,
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 120 } },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Users' }, '403': forbidden },
      },
      post: {
        tags: ['Administration'],
        summary: 'Create a user with an explicit role (administrator)',
        security: auth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fullName', 'email', 'password', 'role'],
                properties: {
                  fullName: { type: 'string', minLength: 2, maxLength: 120 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 10, maxLength: 128 },
                  role: { type: 'string', enum: ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'User created' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/users/reviewers': {
      get: {
        tags: ['Administration'],
        summary: 'List reviewer accounts for assignment (administrator)',
        security: auth,
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string', maxLength: 120 } }],
        responses: { '200': { description: 'Reviewers' }, '403': forbidden },
      },
    },
    '/users/{id}': {
      patch: {
        tags: ['Administration'],
        summary: 'Update a user role, status or name (administrator)',
        security: auth,
        parameters: [idParam('id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string', minLength: 2, maxLength: 120 },
                  role: { type: 'string', enum: ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] },
                  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated user' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/organizations': {
      get: {
        tags: ['Administration'],
        summary: 'List organizations (administrator)',
        security: auth,
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string', maxLength: 160 } }],
        responses: { '200': { description: 'Organizations' }, '403': forbidden },
      },
      post: {
        tags: ['Administration'],
        summary: 'Create an organization (administrator)',
        security: auth,
        responses: { '201': { description: 'Organization created' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/organizations/{id}': {
      patch: {
        tags: ['Administration'],
        summary: 'Update an organization (administrator)',
        security: auth,
        parameters: [idParam('id')],
        responses: { '200': { description: 'Updated organization' }, '403': forbidden, '404': notFound },
      },
    },
    '/organizations/{id}/members': {
      get: {
        tags: ['Administration'],
        summary: 'List organization members (administrator)',
        security: auth,
        parameters: [idParam('id')],
        responses: { '200': { description: 'Members' }, '403': forbidden },
      },
      post: {
        tags: ['Administration'],
        summary: 'Add a user to an organization (administrator)',
        security: auth,
        parameters: [idParam('id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: {
                  userId: { type: 'string', format: 'uuid' },
                  role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Member added' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/organizations/{id}/members/{userId}': {
      delete: {
        tags: ['Administration'],
        summary: 'Remove a user from an organization (administrator)',
        security: auth,
        parameters: [idParam('id'), idParam('userId')],
        responses: { '200': { description: 'Member removed' }, '403': forbidden, '404': notFound },
      },
    },
    '/categories': {
      get: {
        tags: ['Projects'],
        summary: 'List project categories; administrators may request inactive categories',
        parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Categories' } },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project category (administrator)',
        security: auth,
        responses: { '201': { description: 'Category created' }, '403': forbidden, '409': errorResponse },
      },
    },
    '/categories/{id}': {
      patch: {
        tags: ['Projects'],
        summary: 'Update a category label, description or active state (administrator)',
        security: auth,
        parameters: [idParam('id')],
        responses: { '200': { description: 'Updated category' }, '403': forbidden, '404': notFound },
      },
    },
  },
};
