import type { AuditEventView } from '@poi/shared';
import { ShieldCheck } from 'lucide-react';
import { actionLabel, formatDateTime, roleLabel, shortHash } from '../../lib/format';

export function AuditTimeline({ events, emptyLabel }: { events: AuditEventView[]; emptyLabel: string }) {
  if (events.length === 0) {
    return <p className="muted-note">{emptyLabel}</p>;
  }
  return (
    <ol className="audit-timeline">
      {events.map((event) => (
        <li key={event.id} className="audit-timeline__item">
          <span className="audit-timeline__marker" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <div className="audit-timeline__body">
            <div className="audit-timeline__top">
              <strong>{actionLabel(event.action)}</strong>
              <span className="audit-timeline__seq">#{event.seq}</span>
            </div>
            <p>{event.summary}</p>
            <div className="audit-timeline__meta">
              <span>{formatDateTime(event.createdAt)}</span>
              {event.actorRole ? <span>{roleLabel(event.actorRole)}</span> : <span>System event</span>}
              {event.recordVersion ? <span>Record version {event.recordVersion}</span> : null}
              <span className="mono-inline" title={event.eventHash}>Hash {shortHash(event.eventHash)}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
