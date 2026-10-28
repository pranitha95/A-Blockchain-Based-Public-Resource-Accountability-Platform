const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string | number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(numeric);
}

export function formatCompactMoney(amount: string | number, currency = 'INR'): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return String(amount);
  const formatter = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return formatter.format(numeric);
}

export function sumCurrencies(items: { currency: string; amount: string }[]): { currency: string; amount: string }[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + Number(item.amount));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const divisions: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ];
  let duration = seconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        Math.round(duration),
        division.unit,
      );
    }
    duration /= division.amount;
  }
  return formatDate(value);
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In progress',
  UNDER_REVIEW: 'Under review',
  COMPLETED: 'Completed',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  PLANNED: 'Planned',
  REJECTED: 'Rejected',
  DISPUTED: 'Disputed',
  CHANGES_REQUESTED: 'Changes requested',
  DISCREPANCY_OPENED: 'Discrepancy opened',
  AWAITING_WALLET: 'Awaiting wallet',
  TRANSACTION_SUBMITTED: 'Transaction submitted',
  PENDING_CONFIRMATION: 'Pending confirmation',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
  VERIFICATION_ERROR: 'Verification error',
  MATCH: 'Match',
  MISMATCH: 'Mismatch',
  NOT_FOUND: 'Not found',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PUBLIC: 'Public',
  PRIVATE: 'Private',
  RESTRICTED: 'Restricted',
  ADMIN: 'Platform administrator',
  PROJECT_OWNER: 'Project owner',
  REVIEWER: 'Independent reviewer',
  OBSERVER: 'Public observer',
  MILESTONE_SUBMISSION: 'Milestone submission',
  EXPENDITURE_CLAIM: 'Expenditure claim',
  PROJECT: 'Project record',
  REVIEW: 'Review decision',
  AUDIT_BATCH: 'Audit batch',
  JSON: 'JSON',
  PRINT: 'Print report',
};

export function labelFor(value: string | null | undefined): string {
  if (!value) return '—';
  return statusLabels[value] ?? value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function roleLabel(role: string | null | undefined): string {
  return labelFor(role);
}

export function statusTone(value: string | null | undefined): string {
  switch (value) {
    case 'APPROVED':
    case 'CONFIRMED':
    case 'MATCH':
    case 'ACTIVE':
    case 'COMPLETED':
      return 'positive';
    case 'IN_PROGRESS':
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'PENDING_CONFIRMATION':
    case 'TRANSACTION_SUBMITTED':
    case 'AWAITING_WALLET':
      return 'info';
    case 'REJECTED':
    case 'CANCELLED':
    case 'MISMATCH':
    case 'DISPUTED':
    case 'FAILED':
    case 'VERIFICATION_ERROR':
      return 'danger';
    case 'CHANGES_REQUESTED':
    case 'DISCREPANCY_OPENED':
    case 'SUSPENDED':
    case 'PLANNED':
    case 'INACTIVE':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function decisionLabel(decision: string): string {
  return labelFor(decision);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

export function shortHash(value: string | null | undefined, prefix = 8, suffix = 6): string {
  if (!value) return '—';
  if (value.length <= prefix + suffix + 3) return value;
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
}

export function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 8);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((part * 100) / total)));
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return 'Activity';
  return action
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function downloadFilenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1].replaceAll('"', '')) : fallback;
}

export function isSafeInternalPath(path: string | null | undefined): path is string {
  return Boolean(path && path.startsWith('/') && !path.startsWith('//'));
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function allowedTransitions(
  status: string,
  role: 'ADMIN' | 'PROJECT_OWNER' | 'REVIEWER' | 'OBSERVER',
): string[] {
  if (role === 'ADMIN') {
    const admin: Record<string, string[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['DRAFT', 'APPROVED', 'CANCELLED'],
      APPROVED: ['IN_PROGRESS', 'SUSPENDED', 'CANCELLED'],
      IN_PROGRESS: ['UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED'],
      UNDER_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'SUSPENDED', 'CANCELLED'],
      COMPLETED: ['UNDER_REVIEW'],
      SUSPENDED: ['IN_PROGRESS', 'UNDER_REVIEW', 'CANCELLED'],
      CANCELLED: [],
    };
    return admin[status] ?? [];
  }
  if (role === 'PROJECT_OWNER') {
    const owner: Record<string, string[]> = {
      DRAFT: ['SUBMITTED'],
      SUBMITTED: [],
      APPROVED: ['IN_PROGRESS'],
      IN_PROGRESS: ['UNDER_REVIEW'],
      UNDER_REVIEW: [],
      COMPLETED: [],
      SUSPENDED: [],
      CANCELLED: [],
    };
    return owner[status] ?? [];
  }
  return [];
}
