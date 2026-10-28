import {
  CircleAlert,
  Inbox,
  LoaderCircle,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../lib/api';

export function LoadingBlock({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`loading-block${compact ? ' loading-block--compact' : ''}`} role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function LoadingCard({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card loading-card" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  error,
  title = 'This could not be loaded',
  action,
}: {
  error: unknown;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon" aria-hidden="true">
        <TriangleAlert size={22} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{errorMessage(error)}</p>
        {action ? <div className="state-panel__action">{action}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-panel--empty">
      <span className="state-panel__icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {action ? <div className="state-panel__action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  compact = false,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const Icon = tone === 'danger' || tone === 'warning' ? ShieldAlert : tone === 'success' ? CircleAlert : CircleAlert;
  return (
    <div className={`alert alert--${tone}${compact ? ' alert--compact' : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function FormErrorSummary({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="form-error-summary" role="alert">
      <TriangleAlert size={17} aria-hidden="true" />
      <span>{errorMessage(error)}</span>
    </div>
  );
}
