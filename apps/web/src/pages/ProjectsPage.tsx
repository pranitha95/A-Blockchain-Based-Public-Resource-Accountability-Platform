import { useQuery } from '@tanstack/react-query';
import type { ProjectListItem } from '@poi/shared';
import { Filter, FolderKanban, Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ProjectCard } from '../components/domain/ProjectCard';
import { buttonClass, Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader, Pagination } from '../components/ui/Layout';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import { api } from '../lib/api';
import { labelFor } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

const statuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED'];

const sortOptions = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'budget', label: 'Largest budget' },
  { value: 'endDate', label: 'Nearest target date' },
  { value: 'progress', label: 'Highest milestone progress' },
  { value: 'title', label: 'Title A–Z' },
];

export function ProjectsPage() {
  usePageTitle('Projects');
  const { user } = useAuth();
  const { meta } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1) || 1;
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const category = searchParams.get('category') ?? '';
  const sort = searchParams.get('sort') ?? 'updated';
  const overdue = searchParams.get('overdue') === 'true';
  const visibility = searchParams.get('visibility') ?? '';
  const [searchText, setSearchText] = useState(q);

  useEffect(() => {
    setSearchText(q);
  }, [q]);

  const params = { page, pageSize: 12, q, status, category, sort, overdue, visibility };
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(params),
    queryFn: async () => {
      const result = await api.getPage<ProjectListItem>('/projects', {
        page,
        pageSize: 12,
        q: q || undefined,
        status: status || undefined,
        category: category || undefined,
        sort,
        direction: sort === 'title' || sort === 'endDate' ? 'asc' : 'desc',
        overdue: overdue ? 'true' : undefined,
        visibility: visibility || undefined,
      });
      return result;
    },
  });

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next, { replace: false });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    apply({ q: searchText.trim() || null });
  }

  function reset() {
    setSearchText('');
    setSearchParams(new URLSearchParams(), { replace: false });
  }

  const scopeCopy =
    user?.role === 'ADMIN'
      ? 'All registered projects, including private working drafts.'
      : user?.role === 'PROJECT_OWNER'
        ? 'Projects you own. Use each project record to manage milestones, evidence and expenditure.'
        : user?.role === 'REVIEWER'
          ? 'Projects with an active reviewer assignment. Unassigned projects are intentionally omitted.'
          : 'Approved public projects. Draft and private working records are not part of the public directory.';

  const hasFilters = Boolean(q || status || category || overdue || visibility);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Project directory"
        title="Public projects and their records"
        description={scopeCopy}
        actions={
          user?.role === 'ADMIN' ? (
            <Link to="/projects/new" className={buttonClass('primary')}>
              <Plus size={16} aria-hidden="true" /> Register project
            </Link>
          ) : (
            <Link to="/verify" className={buttonClass('secondary')}>
              Verify a commitment
            </Link>
          )
        }
      />

      <Card className="filter-panel">
        <form className="filter-panel__row" onSubmit={submitSearch}>
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search title, code, location or organization"
              aria-label="Search projects"
            />
          </div>
          <Button type="submit" variant="primary" size="sm">Search</Button>
          <div className="filter-panel__selects">
            <label className="inline-select">
              <span>Category</span>
              <select value={category} onChange={(event) => apply({ category: event.target.value || null })}>
                <option value="">All categories</option>
                {meta?.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="inline-select">
              <span>Status</span>
              <select value={status} onChange={(event) => apply({ status: event.target.value || null })}>
                <option value="">All statuses</option>
                {statuses
                  .filter((value) => user?.role === 'ADMIN' || (value !== 'DRAFT' && value !== 'SUBMITTED'))
                  .map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}
              </select>
            </label>
            <label className="inline-select">
              <span>Order</span>
              <select value={sort} onChange={(event) => apply({ sort: event.target.value })}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {user?.role === 'ADMIN' ? (
              <label className="inline-select">
                <span>Visibility</span>
                <select value={visibility} onChange={(event) => apply({ visibility: event.target.value || null })}>
                  <option value="">Any visibility</option>
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </label>
            ) : null}
            <label className="checkbox-field">
              <input type="checkbox" checked={overdue} onChange={(event) => apply({ overdue: event.target.checked ? 'true' : null })} />
              Overdue milestones
            </label>
          </div>
        </form>
        {hasFilters ? (
          <div className="filter-panel__foot">
            <span><Filter size={14} aria-hidden="true" />Filters are active.</span>
            <button type="button" className="text-link" onClick={reset}><RotateCcw size={14} aria-hidden="true" />Reset filters</button>
          </div>
        ) : null}
      </Card>

      {projectsQuery.isLoading ? (
        <div className="card-grid card-grid--three"><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /></div>
      ) : projectsQuery.isError ? (
        <ErrorState
          error={projectsQuery.error}
          title="Projects could not be loaded"
          action={<button type="button" className={buttonClass('secondary', 'sm')} onClick={() => void projectsQuery.refetch()}>Try again</button>}
        />
      ) : projectsQuery.data && projectsQuery.data.data.length > 0 ? (
        <>
          <div className="card-grid card-grid--three">
            {projectsQuery.data.data.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
          <Pagination
            page={Number(projectsQuery.data.meta.page ?? page)}
            totalPages={Number(projectsQuery.data.meta.totalPages ?? 1)}
            total={Number(projectsQuery.data.meta.total ?? projectsQuery.data.data.length)}
            onChange={(nextPage) => apply({ page: String(nextPage) })}
            noun="projects"
          />
        </>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title={hasFilters ? 'No projects match these filters' : 'No projects are visible to your role'}
          description={hasFilters ? 'Try a broader search or clear the filters.' : scopeCopy}
          action={hasFilters ? <button type="button" className={buttonClass('secondary', 'sm')} onClick={reset}>Reset filters</button> : undefined}
        />
      )}
    </div>
  );
}
