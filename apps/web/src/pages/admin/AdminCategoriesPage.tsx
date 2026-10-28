import type { CategoryView } from '../../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleOff,
  Pencil,
  Plus,
  RotateCcw,
  Tags,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { AdminTabs } from '../../components/domain/AdminTabs';
import { ToneBadge } from '../../components/ui/Badges';
import { Button } from '../../components/ui/Button';
import { Alert, EmptyState, ErrorState, FormErrorSummary, LoadingBlock } from '../../components/ui/Feedback';
import { Card, PageHeader, SectionHeading } from '../../components/ui/Layout';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Primitives';
import { useToast } from '../../features/ui/ToastProvider';
import { api } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import { queryKeys } from '../../lib/queryKeys';
import { usePageTitle } from '../../lib/usePageTitle';

export function AdminCategoriesPage() {
  usePageTitle('Project categories');
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryView | null>(null);
  const [deactivating, setDeactivating] = useState<CategoryView | null>(null);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categoriesAdmin,
    queryFn: () => api.get<CategoryView[]>('/categories?includeInactive=true'),
  });

  const categories = categoriesQuery.data ?? [];
  const activeCount = categories.filter((category) => category.isActive).length;
  const inactiveCount = categories.length - activeCount;

  function refreshCategories() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.categoriesAdmin });
    void queryClient.invalidateQueries({ queryKey: queryKeys.meta });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  }

  const toggleMutation = useMutation({
    mutationFn: (category: CategoryView) =>
      api.patch<CategoryView>(`/categories/${category.id}`, { isActive: !category.isActive }),
    onSuccess: (saved) => {
      refreshCategories();
      notify(`${saved.label} is now ${saved.isActive ? 'active' : 'inactive'}.`, 'success');
      setDeactivating(null);
    },
    onError: (error) => notify(error instanceof Error ? error.message : 'The category could not be updated.', 'error'),
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Project categories"
        description="Categories structure project discovery and reporting. An inactive category remains attached to historical projects but is not offered for new ones."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} aria-hidden="true" /> New category
          </Button>
        }
      />
      <AdminTabs />

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Categories</span>
          <strong>{categories.length}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span>Inactive</span>
          <strong>{inactiveCount}</strong>
        </div>
        <div>
          <span>Identifier changes</span>
          <strong>Not allowed</strong>
        </div>
        <div className="metric-strip__note">
          <Tags size={15} aria-hidden="true" />
          <span>Category identifiers are permanent keys used by project records; labels and descriptions can be corrected.</span>
        </div>
      </div>

      <Card>
        <SectionHeading
          title="All categories"
          description="Including inactive categories. This screen requires an administrator account; the API enforces that requirement."
          action={<ToneBadge tone="neutral">{categories.length} total</ToneBadge>}
        />
        {categoriesQuery.isLoading ? (
          <LoadingBlock label="Loading categories…" />
        ) : categoriesQuery.isError ? (
          <ErrorState
            error={categoriesQuery.error}
            title="Categories could not be loaded"
            action={<Button size="sm" variant="secondary" onClick={() => void categoriesQuery.refetch()}>Try again</Button>}
          />
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories configured"
            description="Create at least one category before registering a project."
            action={<Button size="sm" onClick={() => setCreateOpen(true)}>Create category</Button>}
          />
        ) : (
          <ul className="category-list">
            {categories.map((category) => (
              <li key={category.id} className={`category-row${category.isActive ? '' : ' category-row--inactive'}`}>
                <div className="category-row__body">
                  <div className="badge-row">
                    <strong>{category.label}</strong>
                    <ToneBadge tone={category.isActive ? 'positive' : 'neutral'}>
                      {category.isActive ? 'Active' : 'Inactive'}
                    </ToneBadge>
                  </div>
                  <code className="category-row__id">{category.id}</code>
                  <p>{category.description ?? 'No description recorded.'}</p>
                </div>
                <div className="category-row__actions">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(category)}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </Button>
                  {category.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => setDeactivating(category)}>
                      <CircleOff size={14} aria-hidden="true" /> Deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={toggleMutation.isPending && toggleMutation.variables?.id === category.id}
                      onClick={() => toggleMutation.mutate(category)}
                    >
                      <RotateCcw size={14} aria-hidden="true" /> Activate
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Alert tone="info" title="Deactivation is not deletion">
        Project records keep their category reference permanently. Deactivating a category does not rewrite history or
        remove it from existing projects, reports or anchors. This build deliberately offers no category deletion.
      </Alert>

      <CategoryFormModal open={createOpen} category={null} onClose={() => setCreateOpen(false)} />
      <CategoryFormModal open={Boolean(editing)} category={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => { if (!toggleMutation.isPending) setDeactivating(null); }}
        onConfirm={() => { if (deactivating) toggleMutation.mutate(deactivating); }}
        title="Deactivate this category?"
        description="It will no longer be offered when creating projects. Existing project records keep their reference and are not altered."
        confirmLabel="Deactivate category"
        tone="danger"
        loading={toggleMutation.isPending}
      >
        {deactivating ? (
          <p>
            <strong>{deactivating.label}</strong> <code>({deactivating.id})</code>
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function CategoryFormModal({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: CategoryView | null;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setId(category?.id ?? '');
    setLabel(category?.label ?? '');
    setDescription(category?.description ?? '');
    setIsActive(category?.isActive ?? true);
    setError(null);
    setLocalError(null);
  }, [open, category]);

  const mutation = useMutation({
    mutationFn: () =>
      category
        ? api.patch<CategoryView>(`/categories/${category.id}`, {
            label,
            description: description.trim() || null,
            isActive,
          })
        : api.post<CategoryView>('/categories', {
            id,
            label,
            description: description.trim() || null,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categoriesAdmin });
      void queryClient.invalidateQueries({ queryKey: queryKeys.meta });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify(category ? `${saved.label} updated.` : `${saved.label} created.`, 'success');
      onClose();
    },
    onError: setError,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (!category && !/^[a-z0-9-]{2,60}$/.test(id.trim())) {
      setLocalError('Use 2–60 lowercase letters, numbers or hyphens for the identifier.');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={category ? 'Edit category' : 'New project category'}
      description={
        category
          ? 'The identifier is permanent because project records and reports reference it.'
          : 'The identifier becomes a permanent key in project records. Choose it carefully.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={submit}>
        <FormErrorSummary error={error} />
        {localError ? <div className="form-error-summary" role="alert">{localError}</div> : null}
        <Field
          label="Identifier"
          htmlFor="category-id"
          required
          hint={category ? 'Permanent identifier. It cannot be changed by this form.' : 'Lowercase letters, numbers and hyphens, e.g. water-sanitation.'}
          error={fieldError(error, 'id') ?? localError ?? undefined}
        >
          <input
            id="category-id"
            value={id}
            onChange={(event) => setId(event.target.value.toLowerCase())}
            required={!category}
            readOnly={Boolean(category)}
            disabled={Boolean(category)}
            minLength={2}
            maxLength={60}
            pattern="[a-z0-9-]+"
          />
        </Field>
        <Field label="Display label" htmlFor="category-label" required error={fieldError(error, 'label')}>
          <input id="category-label" value={label} onChange={(event) => setLabel(event.target.value)} required minLength={2} maxLength={80} />
        </Field>
        <Field
          label="Description"
          htmlFor="category-description"
          hint="Optional. Shown to help project creators choose the right category."
          error={fieldError(error, 'description')}
        >
          <textarea id="category-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
        </Field>
        {category ? (
          <label className="checkbox-field">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Category is active and available for new projects
          </label>
        ) : (
          <p className="form-note">New categories are created active. You can deactivate them later.</p>
        )}
      </form>
    </Modal>
  );
}
