import type { EvidenceView } from '@poi/shared';
import { Download, FileImage, FileText, LockKeyhole } from 'lucide-react';
import { formatBytes, formatDateTime, shortHash } from '../../lib/format';
import { EvidenceBadge } from '../ui/Badges';
import { MonoValue } from '../ui/Primitives';

export function EvidenceCard({ evidence, showUploader = false }: { evidence: EvidenceView; showUploader?: boolean }) {
  const Icon = evidence.file.mimeType === 'application/pdf' ? FileText : FileImage;
  return (
    <article className="evidence-card">
      <span className="evidence-card__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <div className="evidence-card__body">
        <div className="evidence-card__heading">
          <h4>{evidence.title}</h4>
          <EvidenceBadge visibility={evidence.visibility} />
        </div>
        {evidence.description ? <p>{evidence.description}</p> : null}
        <p className="evidence-card__file">
          <span>{evidence.file.originalName}</span>
          <span>{formatBytes(evidence.file.sizeBytes)}</span>
          <span>{formatDateTime(evidence.createdAt)}</span>
          {showUploader && evidence.uploaderName ? <span>Uploaded by {evidence.uploaderName}</span> : null}
        </p>
        <div className="evidence-card__checksum">
          <span>SHA-256</span>
          <MonoValue value={evidence.file.sha256} display={shortHash(evidence.file.sha256, 12, 8)} />
        </div>
      </div>
      <a
        className="button button--secondary button--sm evidence-card__download"
        href={evidence.downloadUrl}
        download
        aria-label={`Download ${evidence.file.originalName}`}
      >
        {evidence.visibility === 'RESTRICTED' ? <LockKeyhole size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        Download
      </a>
    </article>
  );
}
