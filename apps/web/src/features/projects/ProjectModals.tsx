import type {
  ClaimView,
  EvidenceView,
  MilestoneView,
  ProjectDetail,
  ProjectStatus,
  ReviewerAssignmentView,
} from '@poi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Plus, UserPlus } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge, EvidenceBadge } from '../../components/ui/Badges';
import { Button } from '../../components/ui/Button';
import { FormErrorSummary } from '../../components/ui/Feedback';
import { Field, SelectField } from '../../components/ui/Primitives';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../ui/ToastProvider';
import { api, errorMessage } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import {
  allowedTransitions,
  formatDate,
  formatMoney,
  isoToday,
  labelFor,
  shortHash,
} from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { ReviewerOption } from '../../types';

function useInvalidateProject(projectId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.milestones(projectId) });
    void queryClient.invalidateQueries({ queryKey: ['claims', projectId] });
  };
}

export function StatusChangeModal({
  project,
  role,
  open,
  onClose,
}: {
  project: ProjectDetail;
  role: 'ADMIN' | 'PROJECT_OWNER' | 'REVIEWER' | 'OBSERVER';
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const invalidate = useInvalidateProject(project.id);
  const options = allowedTransitions(project.status, role);
  const [status, setStatus] = useState(options[0] ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setStatus(options[0] ?? '');
      setReason('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.patch<ProjectDetail>(`/projects/${project.id}/status`, {
      status,
      reason: reason.trim() || undefined,
    }),
    onSuccess: async () => {
      await invalidate();
      notify(`Project status changed to ${labelFor(status)}.`, 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Change project status"
      description="Status changes are recorded in project history and the append-only audit chain."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!status || options.length === 0}>
            Update status
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        {options.length === 0 ? (
          <p className="muted-note">Your role cannot move this project from its current status.</p>
        ) : (
          <>
            <div className="current-status">
              <span>Current status</span>
              <StatusBadge value={project.status} dot />
            </div>
            <SelectField
              id="status-target"
              label="New status"
              value={status}
              onChange={setStatus}
              options={options.map((value) => ({ value, label: labelFor(value) }))}
              required
              error={fieldError(error, 'status')}
            />
            <Field
              label="Reason"
              htmlFor="status-reason"
              hint="Required when returning a submitted project for revision or reopening a completed project. Otherwise optional context is encouraged."
              error={fieldError(error, 'reason')}
            >
              <textarea id="status-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
            </Field>
            {status === 'APPROVED' ? (
              <p className="form-note">Approval requires at least one milestone. Authorisation is re-checked by the API.</p>
            ) : null}
            {status === 'COMPLETED' ? (
              <p className="form-note">Completion requires all milestones approved and no pending claim or submission reviews.</p>
            ) : null}
          </>
        )}
      </form>
    </Modal>
  );
}

export function BudgetChangeModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const invalidate = useInvalidateProject(project.id);
  const [amount, setAmount] = useState(project.budgetAmount);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setAmount(project.budgetAmount);
      setReason('');
      setError(null);
    }
  }, [open, project.budgetAmount]);

  const mutation = useMutation({
    mutationFn: () => api.patch<ProjectDetail>(`/projects/${project.id}/budget`, {
      amount,
      currency: project.currency,
      reason,
    }),
    onSuccess: async () => {
      await invalidate();
      notify('Budget change recorded in a new version.', 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Change approved budget"
      description="A budget change is versioned and requires a documented reason. It never rewrites earlier amounts."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>Record budget change</Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <div className="current-status">
          <span>Current approved budget</span>
          <strong>{formatMoney(project.budgetAmount, project.currency)}</strong>
        </div>
        <Field label={`New amount (${project.currency})`} htmlFor="new-budget" required error={fieldError(error, 'amount')}>
          <input id="new-budget" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </Field>
        <Field
          label="Reason for change"
          htmlFor="budget-reason"
          required
          hint="At least 10 characters. This appears in budget history and the audit chain."
          error={fieldError(error, 'reason')}
        >
          <textarea id="budget-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} required />
        </Field>
      </form>
    </Modal>
  );
}

export function MilestoneCreateModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const invalidate = useInvalidateProject(project.id);
  const [values, setValues] = useState({
    title: '',
    description: '',
    expectedCompletionDate: project.endDate,
    deliverables: '',
    allocatedBudget: '',
    responsibleParty: project.organization.name,
  });
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setValues({
        title: '',
        description: '',
        expectedCompletionDate: project.endDate,
        deliverables: '',
        allocatedBudget: '',
        responsibleParty: project.organization.name,
      });
      setError(null);
    }
  }, [open, project.endDate, project.organization.name]);

  const mutation = useMutation({
    mutationFn: () => api.post<MilestoneView>(`/projects/${project.id}/milestones`, {
      ...values,
      allocatedBudget: values.allocatedBudget.trim() || null,
    }),
    onSuccess: async (milestone) => {
      await invalidate();
      notify(`Milestone ${milestone.sequence} created.`, 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Add a milestone"
      description="Milestones make delivery observable. They must fall on or before the project’s target completion date."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}><Plus size={15} aria-hidden="true" /> Create milestone</Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <Field label="Milestone title" htmlFor="milestone-title" required error={fieldError(error, 'title')}>
          <input id="milestone-title" value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} minLength={4} maxLength={140} required />
        </Field>
        <Field label="Description" htmlFor="milestone-description" required error={fieldError(error, 'description')}>
          <textarea id="milestone-description" rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} minLength={20} maxLength={3000} required />
        </Field>
        <Field label="Deliverables" htmlFor="milestone-deliverables" required hint="What tangible outputs will be submitted for review?" error={fieldError(error, 'deliverables')}>
          <textarea id="milestone-deliverables" rows={3} value={values.deliverables} onChange={(event) => setValues({ ...values, deliverables: event.target.value })} minLength={10} maxLength={3000} required />
        </Field>
        <div className="field-grid field-grid--two">
          <Field label="Expected completion" htmlFor="milestone-date" required error={fieldError(error, 'expectedCompletionDate')}>
            <input id="milestone-date" type="date" min={project.startDate} max={project.endDate} value={values.expectedCompletionDate} onChange={(event) => setValues({ ...values, expectedCompletionDate: event.target.value })} required />
          </Field>
          <Field label={`Allocated budget (${project.currency}, optional)`} htmlFor="milestone-budget" error={fieldError(error, 'allocatedBudget')}>
            <input id="milestone-budget" inputMode="decimal" value={values.allocatedBudget} onChange={(event) => setValues({ ...values, allocatedBudget: event.target.value })} placeholder="Leave blank if not allocated" />
          </Field>
        </div>
        <Field label="Responsible party" htmlFor="milestone-owner" required error={fieldError(error, 'responsibleParty')}>
          <input id="milestone-owner" value={values.responsibleParty} onChange={(event) => setValues({ ...values, responsibleParty: event.target.value })} minLength={2} maxLength={160} required />
        </Field>
      </form>
    </Modal>
  );
}

export function MilestoneSubmitModal({
  milestone,
  evidence,
  open,
  onClose,
  onRequestUpload,
}: {
  milestone: MilestoneView;
  evidence: EvidenceView[];
  open: boolean;
  onClose: () => void;
  onRequestUpload: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const available = evidence.filter((item) => !item.milestoneId && !item.claimId);

  useEffect(() => {
    if (open) {
      setSummary('');
      setSelected([]);
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/milestones/${milestone.id}/submit`, { summary, evidenceIds: selected }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.milestone(milestone.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.milestones(milestone.projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(milestone.projectId) });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify('Milestone submission added to the independent review queue.', 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={`Submit milestone ${milestone.sequence}`}
      description="A submission creates a new version and enters independent review. It does not approve itself."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={available.length === 0}>
            Submit for review
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <Field label="Completion summary" htmlFor="submission-summary" required hint="At least 30 characters. Describe what was delivered and where evidence supports it." error={fieldError(error, 'summary')}>
          <textarea id="submission-summary" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} minLength={30} maxLength={4000} required />
        </Field>
        <div className="selection-list">
          <div className="selection-list__head">
            <span>Supporting evidence <strong>({selected.length} selected)</strong></span>
            <Button size="sm" variant="secondary" onClick={onRequestUpload} disabled={mutation.isPending}>
              Upload more evidence
            </Button>
          </div>
          {available.length === 0 ? (
            <div className="state-panel state-panel--empty state-panel--inline">
              <div>
                <h3>No unassigned evidence available</h3>
                <p>Upload a document first, then return to this submission.</p>
              </div>
            </div>
          ) : (
            available.map((item) => (
              <label key={item.id} className={`select-card${selected.includes(item.id) ? ' select-card--selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
                />
                <span className="select-card__check" aria-hidden="true"><Check size={13} /></span>
                <span className="select-card__body">
                  <strong>{item.title}</strong>
                  <small>{item.file.originalName} · {shortHash(item.file.sha256, 10, 6)}</small>
                </span>
                <EvidenceBadge visibility={item.visibility} />
              </label>
            ))
          )}
        </div>
        {selected.length === 0 ? <p className="form-note">Select at least one evidence record. The server also enforces this rule.</p> : null}
      </form>
    </Modal>
  );
}

export function ClaimFormModal({
  project,
  evidence,
  claim,
  open,
  onClose,
  onRequestUpload,
}: {
  project: ProjectDetail;
  evidence: EvidenceView[];
  claim?: ClaimView;
  open: boolean;
  onClose: () => void;
  onRequestUpload?: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const initial = claim ?? null;
  const [values, setValues] = useState({
    amount: initial?.amount ?? '',
    claimedDate: initial?.claimedDate ?? isoToday(),
    category: initial?.category ?? '',
    description: initial?.description ?? '',
    supplierName: initial?.supplierName ?? '',
    supplierReference: initial?.supplierReference ?? '',
    overBudgetExplanation: initial?.budgetExplanation ?? '',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setValues({
      amount: claim?.amount ?? '',
      claimedDate: claim?.claimedDate ?? isoToday(),
      category: claim?.category ?? '',
      description: claim?.description ?? '',
      supplierName: claim?.supplierName ?? '',
      supplierReference: claim?.supplierReference ?? '',
      overBudgetExplanation: claim?.budgetExplanation ?? '',
    });
    setSelected(claim?.evidence.map((item) => item.id) ?? []);
    setError(null);
  }, [open, claim]);

  const available = [
    ...(claim?.evidence ?? []),
    ...evidence.filter((item) => !item.milestoneId && !item.claimId),
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        amount: values.amount,
        claimedDate: values.claimedDate,
        category: values.category,
        description: values.description,
        supplierName: values.supplierName.trim() || null,
        supplierReference: values.supplierReference.trim() || null,
        overBudgetExplanation: values.overBudgetExplanation.trim() || null,
        evidenceIds: selected,
      };
      return claim
        ? api.post<ClaimView>(`/claims/${claim.id}/amend`, payload)
        : api.post<ClaimView>(`/projects/${project.id}/claims`, payload);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['claims', project.id] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify(claim ? 'Corrective claim version submitted.' : 'Expenditure claim submitted for independent review.', 'success');
      onClose();
      if (!claim) navigate(`/claims/${saved.id}`);
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={claim ? `Amend claim ${claim.reference}` : 'Record an expenditure claim'}
      description={
        claim
          ? 'The amendment creates a new version. The earlier version remains in history and cannot be overwritten.'
          : 'Submitting a claim places it in the independent review queue. It is not an approval and not a payment.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={available.length === 0}>
            {claim ? 'Submit new version' : 'Submit claim'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <div className="field-grid field-grid--two">
          <Field label={`Amount (${project.currency})`} htmlFor="claim-amount" required error={fieldError(error, 'amount')}>
            <input id="claim-amount" inputMode="decimal" value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} required placeholder="e.g. 125000.00" />
          </Field>
          <Field label="Expenditure date" htmlFor="claim-date" required error={fieldError(error, 'claimedDate')}>
            <input id="claim-date" type="date" max={isoToday()} value={values.claimedDate} onChange={(event) => setValues({ ...values, claimedDate: event.target.value })} required />
          </Field>
        </div>
        <div className="field-grid field-grid--two">
          <Field label="Expense category" htmlFor="claim-category" required error={fieldError(error, 'category')}>
            <input id="claim-category" list="claim-category-options" value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })} minLength={2} maxLength={80} required />
            <datalist id="claim-category-options">
              <option value="Works and construction" />
              <option value="Equipment" />
              <option value="Supplies" />
              <option value="Professional services" />
              <option value="Transport" />
              <option value="Personnel" />
            </datalist>
          </Field>
          <Field label="Supplier name" htmlFor="claim-supplier" error={fieldError(error, 'supplierName')}>
            <input id="claim-supplier" value={values.supplierName} onChange={(event) => setValues({ ...values, supplierName: event.target.value })} maxLength={160} />
          </Field>
        </div>
        <Field label="Supplier reference" htmlFor="claim-reference" error={fieldError(error, 'supplierReference')}>
          <input id="claim-reference" value={values.supplierReference} onChange={(event) => setValues({ ...values, supplierReference: event.target.value })} maxLength={120} placeholder="Invoice or purchase order reference, if any" />
        </Field>
        <Field label="Description" htmlFor="claim-description" required error={fieldError(error, 'description')}>
          <textarea id="claim-description" rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} minLength={10} maxLength={2000} required />
        </Field>
        <Field
          label="Over-budget explanation"
          htmlFor="claim-over-budget"
          hint="Required by the server if this claim would take recorded expenditure above the approved budget. At least 20 characters."
          error={fieldError(error, 'overBudgetExplanation')}
        >
          <textarea id="claim-over-budget" rows={3} value={values.overBudgetExplanation} onChange={(event) => setValues({ ...values, overBudgetExplanation: event.target.value })} maxLength={2000} />
        </Field>
        <div className="selection-list">
          <div className="selection-list__head">
            <span>Supporting evidence <strong>({selected.length} selected)</strong></span>
            {onRequestUpload ? (
              <Button size="sm" variant="secondary" onClick={onRequestUpload} disabled={mutation.isPending}>Upload more evidence</Button>
            ) : null}
          </div>
          {available.length === 0 ? (
            <p className="muted-note">Upload at least one supporting document before submitting a claim.</p>
          ) : (
            available.map((item) => (
              <label key={item.id} className={`select-card${selected.includes(item.id) ? ' select-card--selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
                />
                <span className="select-card__check" aria-hidden="true"><Check size={13} /></span>
                <span className="select-card__body">
                  <strong>{item.title}</strong>
                  <small>{item.file.originalName} · {shortHash(item.file.sha256, 10, 6)}</small>
                </span>
                <EvidenceBadge visibility={item.visibility} />
              </label>
            ))
          )}
        </div>
        {evidence.length === 0 && !claim ? (
          <p className="form-note">No evidence is currently available. The server requires at least one supporting document.</p>
        ) : null}
      </form>
    </Modal>
  );
}

export function ReportGenerateModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(`Accountability report — ${project.code}`);
  const [format, setFormat] = useState<'PRINT' | 'JSON'>('PRINT');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setTitle(`Accountability report — ${project.code}`);
      setFormat('PRINT');
      setError(null);
    }
  }, [open, project.code]);

  const mutation = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/projects/${project.id}/reports`, { format, title }),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify('Point-in-time accountability report generated.', 'success');
      onClose();
      navigate(`/reports/${report.id}`);
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Generate accountability report"
      description="A report freezes the records visible to you at this moment and records a checksum."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}><FileText size={15} aria-hidden="true" /> Generate report</Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <Field label="Report title" htmlFor="report-title" required error={fieldError(error, 'title')}>
          <input id="report-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={4} maxLength={160} required />
        </Field>
        <SelectField
          id="report-format"
          label="Presentation"
          value={format}
          onChange={(value) => setFormat(value as 'PRINT' | 'JSON')}
          options={[
            { value: 'PRINT', label: 'Print-ready accountability report' },
            { value: 'JSON', label: 'Structured JSON snapshot' },
          ]}
          hint="Both formats store the same immutable snapshot; the label documents intent."
          required
        />
        <p className="form-note">Reports do not prove completion or payment. They record what the platform held at generation time.</p>
      </form>
    </Modal>
  );
}

export function ReviewerAssignModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [reviewerId, setReviewerId] = useState('');
  const [conflictNote, setConflictNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const eligibleQuery = useQuery({
    queryKey: queryKeys.eligibleReviewers(projectId),
    queryFn: () => api.get<ReviewerOption[]>(`/projects/${projectId}/eligible-reviewers`),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setReviewerId('');
      setConflictNote('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post<ReviewerAssignmentView>(`/projects/${projectId}/reviewers`, {
      reviewerId,
      conflictNote: conflictNote.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviewers(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.eligibleReviewers(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify('Independent reviewer assigned.', 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Assign an independent reviewer"
      description="Only reviewers with an active assignment can decide records for this project. Owners can never review their own records."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!reviewerId}>
            <UserPlus size={15} aria-hidden="true" /> Assign reviewer
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        {eligibleQuery.isLoading ? <p className="muted-note">Loading eligible reviewers…</p> : null}
        {eligibleQuery.isError ? <p className="muted-note">{errorMessage(eligibleQuery.error)}</p> : null}
        <SelectField
          id="reviewer-id"
          label="Reviewer"
          value={reviewerId}
          onChange={setReviewerId}
          placeholder={eligibleQuery.data?.length === 0 ? 'No eligible reviewers available' : 'Select a reviewer'}
          options={(eligibleQuery.data ?? []).map((reviewer) => ({
            value: reviewer.id,
            label: `${reviewer.fullName} (${reviewer.email})`,
          }))}
          required
          error={fieldError(error, 'reviewerId')}
        />
        <Field
          label="Conflict declaration"
          htmlFor="reviewer-conflict"
          hint="Optional. Record any declared relationship or interest that could affect independence."
          error={fieldError(error, 'conflictNote')}
        >
          <textarea id="reviewer-conflict" rows={3} value={conflictNote} onChange={(event) => setConflictNote(event.target.value)} maxLength={1000} />
        </Field>
      </form>
    </Modal>
  );
}
