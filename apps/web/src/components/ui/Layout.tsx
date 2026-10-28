import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function Card({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' }) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel = 'Back',
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <header className="page-header">
      {backTo ? (
        <Link to={backTo} className="back-link">
          <ArrowLeft size={15} aria-hidden="true" /> {backLabel}
        </Link>
      ) : null}
      <div className="page-header__row">
        <div className="page-header__text">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h1>{title}</h1>
          {description ? <div className="page-header__description">{description}</div> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = 'teal',
}: {
  value: number;
  label: string;
  tone?: 'teal' | 'blue' | 'amber';
}) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div className="progress">
      <div className="progress__meta">
        <span>{label}</span>
        <strong>{safe}%</strong>
      </div>
      <div
        className={`progress__track progress__track--${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safe}
        aria-label={label}
      >
        <span className="progress__fill" style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

export function DetailGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <dl className={`detail-grid ${className}`.trim()}>{children}</dl>;
}

export function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'detail-grid__item detail-grid__item--wide' : 'detail-grid__item'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
  noun = 'records',
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
  noun?: string;
}) {
  if (totalPages <= 1) {
    return <p className="pagination__summary">{total} {noun}</p>;
  }
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__summary">
        Page {page} of {totalPages} · {total} {noun}
      </span>
      <div className="pagination__buttons">
        <button type="button" className="button button--secondary button--sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button type="button" className="button button--secondary button--sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Project sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`tab${active === tab.key ? ' tab--active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="tab__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function CalloutLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link to={to} className="callout-link">
      <span className="callout-link__icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </Link>
  );
}
