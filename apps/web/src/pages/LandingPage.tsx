import { useQuery } from '@tanstack/react-query';
import type { OverviewResponse, ProjectListItem } from '@poi/shared';
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  FileCheck2,
  FolderKanban,
  Landmark,
  SearchCheck,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProjectCard } from '../components/domain/ProjectCard';
import { ChainStateBadge, DemoBadge } from '../components/ui/Badges';
import { buttonClass } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { PageHeader, SectionHeading } from '../components/ui/Layout';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import { api, errorMessage } from '../lib/api';
import { formatCompactMoney, formatMoney, pluralize } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

const steps = [
  {
    icon: FolderKanban,
    title: 'Projects are registered',
    body: 'Each public project has a code, an approved budget, a delivery location, milestones and named responsibilities.',
  },
  {
    icon: FileCheck2,
    title: 'Evidence and claims are recorded',
    body: 'Owners submit milestone evidence and expenditure claims. Every file is hashed and every record keeps its version history.',
  },
  {
    icon: SearchCheck,
    title: 'Independent review is enforced',
    body: 'An assigned reviewer, never the owner, records a decision. The API verifies independence and prevents self-approval.',
  },
  {
    icon: Blocks,
    title: 'Commitments can be anchored',
    body: 'An authorised wallet writes a versioned commitment to Ethereum Sepolia. Superseded records remain visible in the event history.',
  },
];

export function LandingPage() {
  usePageTitle();
  const { user } = useAuth();
  const { meta } = useMeta();

  const statsQuery = useQuery({
    queryKey: queryKeys.stats('anonymous'),
    queryFn: () => api.get<OverviewResponse>('/stats/overview'),
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects({ pageSize: 3, sort: 'updated', direction: 'desc', scope: 'landing' }),
    queryFn: async () => {
      const result = await api.getPage<ProjectListItem>('/projects', {
        page: 1,
        pageSize: 3,
        sort: 'updated',
        direction: 'desc',
      });
      return result.data;
    },
  });

  const metrics = statsQuery.data?.metrics;
  const budgets = metrics?.totalApprovedBudget ?? [];
  const primaryBudget = budgets[0];

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__content">
          <span className="hero__eyebrow">
            <ShieldCheck size={15} aria-hidden="true" />
            Civic accountability infrastructure
          </span>
          <h1>Public money should leave a public trail.</h1>
          <p className="hero__lead">
            Proof of Impact connects budgets, milestones, evidence, independent reviews and expenditure claims to
            inspectable records — with optional, versioned commitments on a public blockchain.
          </p>
          <div className="hero__actions">
            <Link to="/projects" className={buttonClass('primary', 'lg')}>
              Explore public projects <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link to={user ? '/dashboard' : '/login'} className={buttonClass('ghost', 'lg')}>
              {user ? 'Open your overview' : 'Sign in to participate'}
            </Link>
          </div>
          <div className="hero__trust">
            <span>
              <BadgeCheck size={15} aria-hidden="true" />
              Server-enforced roles
            </span>
            <span>
              <FileCheck2 size={15} aria-hidden="true" />
              Hash-chained audit log
            </span>
            <span>
              <Blocks size={15} aria-hidden="true" />
              Ethereum Sepolia anchoring
            </span>
          </div>
        </div>

        <aside className="hero__panel" aria-label="How accountability is recorded">
          <div className="hero__panel-head">
            <span className="brand-mark brand-mark--light" aria-hidden="true">
              <Landmark size={19} strokeWidth={1.8} />
            </span>
            <div>
              <strong>Accountability record</strong>
              <small>Each layer answers a different question</small>
            </div>
          </div>
          <ol className="hero-chain">
            <li>
              <span>01</span>
              <div><strong>What was promised?</strong><small>Project, budget and milestone record</small></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>What was submitted?</strong><small>Evidence with SHA-256 file checksums</small></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>Who decided?</strong><small>Independent reviewer assignment and rationale</small></div>
            </li>
            <li>
              <span>04</span>
              <div><strong>Did the record change?</strong><small>Version history and explicit supersession</small></div>
            </li>
          </ol>
          <div className="hero__panel-foot">
            <ChainStateBadge available={Boolean(meta?.chain.anchoringAvailable)} />
            <p>
              An on-chain commitment is evidence that a record existed in a particular form at a point in time. It is
              not proof that the underlying claim is true.
            </p>
          </div>
        </aside>
      </section>

      <section className="metric-strip" aria-label="Live platform totals">
        <div>
          <span>Public projects</span>
          <strong>{statsQuery.isError ? 'Unavailable' : metrics?.totalProjects ?? '—'}</strong>
        </div>
        <div>
          <span>Approved budget in view</span>
          <strong>{primaryBudget ? formatCompactMoney(primaryBudget.amount, primaryBudget.currency) : statsQuery.isError ? 'Unavailable' : '—'}</strong>
        </div>
        <div>
          <span>Completed milestones</span>
          <strong>{statsQuery.isError ? 'Unavailable' : metrics?.completedMilestones ?? '—'}</strong>
        </div>
        <div>
          <span>Confirmed anchors</span>
          <strong>{statsQuery.isError ? 'Unavailable' : metrics?.anchoredRecords ?? '—'}</strong>
        </div>
        <div className="metric-strip__note">
          <DemoBadge compact />
          <span>Demonstration records are labelled throughout the platform.</span>
        </div>
      </section>

      <section className="section-block">
        <SectionHeading
          eyebrow="The model"
          title="Four questions, four kinds of evidence"
          description="The platform separates what was promised, what was submitted, who reviewed it and whether a record changed. None of those steps is a substitute for the others."
        />
        <div className="step-grid">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <article className="step-card" key={title}>
              <div className="step-card__top">
                <span className="step-card__number">0{index + 1}</span>
                <span className="step-card__icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionHeading
          action={<Link to="/projects" className={buttonClass('secondary', 'sm')}>View all projects <ArrowRight size={15} aria-hidden="true" /></Link>}
          eyebrow="Public directory"
          title="Inspect a project record"
          description="Public projects expose their scope, budgets, milestone progress, public evidence, review outcomes and audit history. Restricted evidence remains withheld."
        />
        {projectsQuery.isLoading ? (
          <div className="card-grid card-grid--three"><LoadingCard /><LoadingCard /><LoadingCard /></div>
        ) : projectsQuery.isError ? (
          <ErrorState error={projectsQuery.error} title="Public projects could not be loaded" />
        ) : projectsQuery.data && projectsQuery.data.length > 0 ? (
          <div className="card-grid card-grid--three">
            {projectsQuery.data.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No public projects yet"
            description="Public projects appear here after an administrator registers and approves them."
          />
        )}
      </section>

      <section className="section-block split-panel">
        <div className="split-panel__text">
          <span className="eyebrow">Read the limits</span>
          <h2>A commitment is not a certificate of truth.</h2>
          <p>
            Blockchain anchoring can show that a project’s record existed and has not silently changed. It cannot tell
            you whether an invoice is genuine, whether work was completed, whether money was well spent or whether a
            reviewer is trustworthy. Those judgments remain human and institutional.
          </p>
          <p>
            Approved expenditure claims are independence-checked review decisions, not proof of payment. Demo records
            are seeded for evaluation and are never presented as real transactions.
          </p>
          <div className="hero__actions">
            <Link to="/verify" className={buttonClass('primary')}>Verify a record</Link>
            <Link to="/blockchain" className={buttonClass('secondary')}>Inspect the chain registry</Link>
          </div>
        </div>
        <aside className="limits-card">
          <h3>What each layer can show</h3>
          <dl>
            <div>
              <dt>Audit chain</dt>
              <dd>Whether the platform’s recorded event history is internally consistent.</dd>
            </div>
            <div>
              <dt>Independent review</dt>
              <dd>That an assigned reviewer, not the owner, recorded a decision and rationale.</dd>
            </div>
            <div>
              <dt>Blockchain anchor</dt>
              <dd>That a specific record digest was committed on-chain and superseded explicitly.</dd>
            </div>
          </dl>
          <div className="limits-card__foot">
            <Wallet size={17} aria-hidden="true" />
            <span>Transactions are signed in your wallet. The platform never asks for a seed phrase or private key.</span>
          </div>
        </aside>
      </section>

      {statsQuery.isError ? (
        <p className="muted-note">{errorMessage(statsQuery.error)} The public narrative above does not depend on live totals.</p>
      ) : metrics ? (
        <p className="landing__footnote">
          Public scope: {pluralize(metrics.totalProjects, 'project')} · {pluralize(metrics.completedMilestones, 'completed milestone')} ·{' '}
          {formatMoney(budgets[0]?.amount ?? '0', budgets[0]?.currency ?? 'INR')} approved budget in view.
        </p>
      ) : null}

      <PageHeader
        eyebrow="Independent participation"
        title="Roles are granted by the platform, not chosen in the browser."
        description="Public observers can register themselves. Project owners, independent reviewers and administrators are appointed by an administrator. Every protected API endpoint re-checks the stored role."
        actions={
          user ? (
            <Link to="/dashboard" className={buttonClass('primary')}>Go to your overview</Link>
          ) : (
            <Link to="/register" className={buttonClass('primary')}>Create an observer account</Link>
          )
        }
      />
    </div>
  );
}
