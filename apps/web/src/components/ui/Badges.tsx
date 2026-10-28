import type { ReactNode } from 'react';
import { CheckCircle2, Circle, LockKeyhole } from 'lucide-react';
import { labelFor, roleLabel, statusTone } from '../../lib/format';

export function StatusBadge({ value, dot = false }: { value: string | null | undefined; dot?: boolean }) {
  const tone = statusTone(value);
  return (
    <span className={`badge badge--${tone}`}>
      {dot ? <span className={`badge__dot badge__dot--${tone}`} aria-hidden="true" /> : null}
      {labelFor(value)}
    </span>
  );
}

export function ToneBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'info' | 'warning' | 'danger';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  const tone =
    role === 'ADMIN' ? 'danger' : role === 'REVIEWER' ? 'info' : role === 'PROJECT_OWNER' ? 'positive' : 'neutral';
  return <span className={`badge badge--${tone}`}>{roleLabel(role)}</span>;
}

export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="badge badge--demo" title="This record belongs to the labelled demonstration dataset.">
      <Circle size={8} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      {compact ? 'Demo' : 'Demonstration record'}
    </span>
  );
}

export function EvidenceBadge({ visibility }: { visibility: 'PUBLIC' | 'RESTRICTED' }) {
  return (
    <span className={`badge ${visibility === 'PUBLIC' ? 'badge--neutral' : 'badge--warning'}`}>
      {visibility !== 'PUBLIC' ? <LockKeyhole size={12} aria-hidden="true" /> : null}
      {visibility === 'PUBLIC' ? 'Public evidence' : 'Restricted evidence'}
    </span>
  );
}

export function ChainStateBadge({ available }: { available: boolean }) {
  return (
    <span className={`badge ${available ? 'badge--positive' : 'badge--warning'}`}>
      {available ? <CheckCircle2 size={13} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
      {available ? 'Chain anchoring available' : 'Anchoring not configured'}
    </span>
  );
}

export function OutcomeBadge({ decision }: { decision: string }) {
  return <StatusBadge value={decision} dot />;
}

export function PrivateBadge() {
  return <span className="badge badge--warning"><LockKeyhole size={12} aria-hidden="true" />Private working record</span>;
}
