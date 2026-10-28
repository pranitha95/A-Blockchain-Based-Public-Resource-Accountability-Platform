import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectDetail } from '@poi/shared';
import { ArrowLeft, Landmark, Plus, Save, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AdminUserView, CategoryView, OrganizationView } from '../types';
import { Button } from '../components/ui/Button';
import { ErrorState, FormErrorSummary, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader } from '../components/ui/Layout';
import { Field, SelectField } from '../components/ui/Primitives';
import { useMeta } from '../features/meta/MetaProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { fieldError } from '../lib/forms';
import { isoToday } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

interface ProjectValues {
  title: string;
  description: string;
  problemStatement: string;
  categoryId: string;
  organizationId: string;
  ownerId: string;
  locationName: string;
  latitude: string;
  longitude: string;
  budgetAmount: string;
  currency: string;
  startDate: string;
  endDate: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="form-section">
      <div className="form-section__head">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="form-section__body">{children}</div>
    </Card>
  );
}

export function ProjectFormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const editing = Boolean(projectId);
  usePageTitle(editing ? 'Edit project' : 'Register project');

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? 'new'),
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
    enabled: editing,
  });

  if (editing && projectQuery.isLoading) {
    return <div className="page-stack"><LoadingCard label="Loading project record…" /></div>;
  }
  if (editing && (projectQuery.isError || !projectQuery.data)) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Administration" title="Project could not be loaded" backTo="/projects" backLabel="Projects" />
        <ErrorState error={projectQuery.error} />
      </div>
    );
  }

  return <ProjectForm project={projectQuery.data} />;
}

function ProjectForm({ project }: { project?: ProjectDetail }) {
  const editing = Boolean(project);
  const { meta } = useMeta();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ProjectValues>({
    title: project?.title ?? '',
    description: project?.description ?? '',
    problemStatement: project?.problemStatement ?? '',
    categoryId: project?.categoryId ?? '',
    organizationId: project?.organization.id ?? '',
    ownerId: project?.owner?.id ?? '',
    locationName: project?.locationName ?? '',
    latitude: project ? String(project.latitude) : '',
    longitude: project ? String(project.longitude) : '',
    budgetAmount: project?.budgetAmount ?? '',
    currency: project?.currency ?? 'INR',
    startDate: project?.startDate ?? isoToday(),
    endDate: project?.endDate ?? '',
    visibility: project?.visibility ?? 'PUBLIC',
  });
  const [objectives, setObjectives] = useState<string[]>(project?.objectives.length ? project.objectives : ['']);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const organizationsQuery = useQuery({
    queryKey: queryKeys.organizations({ scope: 'form' }),
    queryFn: () => api.get<OrganizationView[]>('/organizations'),
  });
  const ownersQuery = useQuery({
    queryKey: queryKeys.users({ role: 'PROJECT_OWNER', status: 'ACTIVE', pageSize: 100 }),
    queryFn: async () => {
      const result = await api.getPage<AdminUserView>('/users', {
        role: 'PROJECT_OWNER',
        status: 'ACTIVE',
        pageSize: 100,
      });
      return result.data;
    },
  });

  const categoryOptions = (meta?.categories ?? [])
    .filter((category) => category.isActive || category.id === project?.categoryId)
    .map((category: CategoryView) => ({ value: category.id, label: category.label }));

  const organizationOptions = (organizationsQuery.data ?? []).map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));
  if (project && !organizationOptions.some((option) => option.value === project.organization.id)) {
    organizationOptions.unshift({ value: project.organization.id, label: project.organization.name });
  }

  const ownerOptions = (ownersQuery.data ?? []).map((owner) => ({
    value: owner.id,
    label: `${owner.fullName} (${owner.email})`,
  }));
  if (project?.owner && !ownerOptions.some((option) => option.value === project.owner?.id)) {
    ownerOptions.unshift({ value: project.owner.id, label: project.owner.fullName });
  }

  function set<K extends keyof ProjectValues>(key: K, value: ProjectValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    const cleanedObjectives = objectives.map((objective) => objective.trim()).filter(Boolean);
    if (cleanedObjectives.length === 0) {
      setLocalError('Add at least one objective. Each objective should explain a concrete intended result.');
      return;
    }
    if (values.endDate < values.startDate) {
      setLocalError('The target completion date cannot be before the start date.');
      return;
    }
    if (!values.categoryId || !values.organizationId || !values.ownerId) {
      setLocalError('Select a category, an implementing organization and a project owner.');
      return;
    }
    const payload = {
      title: values.title.trim(),
      description: values.description.trim(),
      problemStatement: values.problemStatement.trim(),
      objectives: cleanedObjectives,
      categoryId: values.categoryId,
      organizationId: values.organizationId,
      ownerId: values.ownerId,
      locationName: values.locationName.trim(),
      latitude: Number(values.latitude),
      longitude: Number(values.longitude),
      currency: values.currency,
      startDate: values.startDate,
      endDate: values.endDate,
      visibility: values.visibility,
    };
    setSubmitting(true);
    try {
      const saved = editing && project
        ? await api.patch<ProjectDetail>(`/projects/${project.id}`, payload)
        : await api.post<ProjectDetail>('/projects', { ...payload, budgetAmount: values.budgetAmount.trim() });
      notify(editing ? 'Project record updated.' : 'Project registered as a draft.', 'success');
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects({}) });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.setQueryData(queryKeys.project(saved.id), saved);
      navigate(`/projects/${saved.id}`);
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title={editing ? `Edit ${project!.code}` : 'Register a public project'}
        description={
          editing
            ? 'Changes create a new project record version and an audit event. The approved budget has a separate history-preserving control.'
            : 'New projects start as private-by-default drafts only if you choose private visibility. Public directory visibility begins only after approval.'
        }
        backTo={editing ? `/projects/${project!.id}` : '/projects'}
        backLabel={editing ? 'Back to project' : 'Back to projects'}
        actions={
          <Link to="/projects" className="button button--ghost">
            <ArrowLeft size={15} aria-hidden="true" /> Projects
          </Link>
        }
      />

      <form className="form-layout" onSubmit={submit}>
        <FormErrorSummary error={error} />
        {localError ? <div className="form-error-summary" role="alert">{localError}</div> : null}

        <Section title="Project basics" description="The public identity and problem statement for this record.">
          <Field label="Project title" htmlFor="project-title" required error={fieldError(error, 'title')}>
            <input
              id="project-title"
              value={values.title}
              onChange={(event) => set('title', event.target.value)}
              minLength={4}
              maxLength={140}
              required
              placeholder="e.g. Clean water for the eastern wards"
            />
          </Field>
          <Field
            label="Short description"
            htmlFor="project-description"
            required
            hint="20–5,000 characters. This appears in the public project directory."
            error={fieldError(error, 'description')}
          >
            <textarea
              id="project-description"
              rows={4}
              value={values.description}
              onChange={(event) => set('description', event.target.value)}
              minLength={20}
              maxLength={5000}
              required
            />
          </Field>
          <Field
            label="Problem statement"
            htmlFor="project-problem"
            required
            hint="What public problem does this project address, and for whom?"
            error={fieldError(error, 'problemStatement')}
          >
            <textarea
              id="project-problem"
              rows={4}
              value={values.problemStatement}
              onChange={(event) => set('problemStatement', event.target.value)}
              minLength={20}
              maxLength={3000}
              required
            />
          </Field>
          <Field label="Location name" htmlFor="project-location" required error={fieldError(error, 'locationName')}>
            <input
              id="project-location"
              value={values.locationName}
              onChange={(event) => set('locationName', event.target.value)}
              minLength={2}
              maxLength={160}
              required
              placeholder="Ward, district, city or region"
            />
          </Field>
          <div className="field-grid field-grid--two">
            <Field label="Latitude" htmlFor="project-latitude" required error={fieldError(error, 'latitude')}>
              <input
                id="project-latitude"
                type="number"
                step="0.000001"
                min={-90}
                max={90}
                value={values.latitude}
                onChange={(event) => set('latitude', event.target.value)}
                required
                placeholder="e.g. 12.9716"
              />
            </Field>
            <Field label="Longitude" htmlFor="project-longitude" required error={fieldError(error, 'longitude')}>
              <input
                id="project-longitude"
                type="number"
                step="0.000001"
                min={-180}
                max={180}
                value={values.longitude}
                onChange={(event) => set('longitude', event.target.value)}
                required
                placeholder="e.g. 77.5946"
              />
            </Field>
          </div>
        </Section>

        <Section title="Accountability assignments" description="These assignments determine who may maintain and review the record. The API enforces the resulting permissions.">
          <div className="field-grid field-grid--two">
            <SelectField
              id="project-category"
              label="Category"
              value={values.categoryId}
              onChange={(value) => set('categoryId', value)}
              placeholder="Select a category"
              options={categoryOptions}
              required
              error={fieldError(error, 'categoryId')}
            />
            <SelectField
              id="project-organization"
              label="Implementing organization"
              value={values.organizationId}
              onChange={(value) => set('organizationId', value)}
              placeholder={organizationsQuery.isLoading ? 'Loading organizations…' : 'Select an organization'}
              options={organizationOptions}
              required
              disabled={organizationsQuery.isLoading}
              hint="Organizations are administered centrally to keep names consistent."
              error={fieldError(error, 'organizationId')}
            />
          </div>
          <SelectField
            id="project-owner"
            label="Project owner"
            value={values.ownerId}
            onChange={(value) => set('ownerId', value)}
            placeholder={ownersQuery.isLoading ? 'Loading project owners…' : 'Select a project owner'}
            options={ownerOptions}
            required
            disabled={ownersQuery.isLoading}
            hint="Only the selected owner can submit evidence and expenditure records while the project is active."
            error={fieldError(error, 'ownerId')}
          />
          {organizationsQuery.data && organizationsQuery.data.length === 0 ? (
            <p className="form-note">No organizations exist yet. An administrator must register one before creating a project.</p>
          ) : null}
          {ownersQuery.data && ownersQuery.data.length === 0 ? (
            <p className="form-note">No active project-owner accounts exist yet. Create one from Administration → Users first.</p>
          ) : null}
          <SelectField
            id="project-visibility"
            label="Directory visibility"
            value={values.visibility}
            onChange={(value) => set('visibility', value as 'PUBLIC' | 'PRIVATE')}
            options={[
              { value: 'PUBLIC', label: 'Public — visible in the directory once approved' },
              { value: 'PRIVATE', label: 'Private — internal working record only' },
            ]}
            hint="Draft and submitted projects are never exposed in the public directory, even when marked public."
            required
            error={fieldError(error, 'visibility')}
          />
        </Section>

        <Section title="Objectives" description="Add measurable intended results. At least one objective is required.">
          <div className="objective-list">
            {objectives.map((objective, index) => (
              <div className="objective-row" key={index}>
                <span className="objective-row__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <Field
                  label={`Objective ${index + 1}`}
                  htmlFor={`objective-${index}`}
                  className="objective-row__field"
                  error={fieldError(error, `objectives.${index}`)}
                >
                  <input
                    id={`objective-${index}`}
                    value={objective}
                    onChange={(event) => {
                      const next = [...objectives];
                      next[index] = event.target.value;
                      setObjectives(next);
                    }}
                    minLength={8}
                    maxLength={300}
                    placeholder="Describe an intended, observable result"
                  />
                </Field>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  aria-label={`Remove objective ${index + 1}`}
                  disabled={objectives.length === 1}
                  onClick={() => setObjectives(objectives.filter((_, position) => position !== index))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setObjectives([...objectives, ''])}
            disabled={objectives.length >= 12}
          >
            <Plus size={15} aria-hidden="true" /> Add objective
          </Button>
        </Section>

        <Section title="Budget and schedule" description="Financial figures are stored as fixed-precision decimals with an explicit ISO currency.">
          {editing && project ? (
            <div className="read-only-figure">
              <span className="read-only-figure__icon" aria-hidden="true"><Landmark size={20} /></span>
              <div>
                <strong>{project.currency} {project.budgetAmount}</strong>
                <span>Approved budget · version {project.latestBudgetChange?.version ?? project.version}</span>
              </div>
              <span className="badge badge--neutral">Change through budget control</span>
            </div>
          ) : (
            <div className="field-grid field-grid--two">
              <Field
                label="Initial approved budget"
                htmlFor="project-budget"
                required
                hint="A positive amount with up to two decimal places."
                error={fieldError(error, 'budgetAmount')}
              >
                <input
                  id="project-budget"
                  inputMode="decimal"
                  value={values.budgetAmount}
                  onChange={(event) => set('budgetAmount', event.target.value)}
                  required
                  placeholder="e.g. 2500000.00"
                />
              </Field>
              <SelectField
                id="project-currency"
                label="Currency"
                value={values.currency}
                onChange={(value) => set('currency', value)}
                options={[
                  { value: 'INR', label: 'INR — Indian rupee' },
                  { value: 'USD', label: 'USD — US dollar' },
                  { value: 'EUR', label: 'EUR — Euro' },
                  { value: 'GBP', label: 'GBP — Pound sterling' },
                ]}
                required
                hint="Currency cannot be changed after financial records may exist."
                error={fieldError(error, 'currency')}
              />
            </div>
          )}
          <div className="field-grid field-grid--two">
            <Field label="Start date" htmlFor="project-start" required error={fieldError(error, 'startDate')}>
              <input
                id="project-start"
                type="date"
                value={values.startDate}
                onChange={(event) => set('startDate', event.target.value)}
                required
              />
            </Field>
            <Field label="Target completion" htmlFor="project-end" required error={fieldError(error, 'endDate')}>
              <input
                id="project-end"
                type="date"
                value={values.endDate}
                onChange={(event) => set('endDate', event.target.value)}
                min={values.startDate}
                required
              />
            </Field>
          </div>
          <p className="form-note">
            New projects are created in Draft. At least one milestone must exist before an administrator can approve the
            project and make it publicly visible.
          </p>
        </Section>

        <div className="form-actions form-actions--sticky">
          <Link to={editing ? `/projects/${project!.id}` : '/projects'} className="button button--secondary">Cancel</Link>
          <Button type="submit" loading={submitting}>
            <Save size={16} aria-hidden="true" /> {editing ? 'Save project record' : 'Register draft project'}
          </Button>
        </div>
      </form>
    </div>
  );
}
