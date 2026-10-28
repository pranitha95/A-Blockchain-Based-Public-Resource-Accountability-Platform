export function localeForCurrency(currency: string): string {
  return currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
}

export function formatCurrency(
  amount: string | number,
  currency: string,
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return `${currency} —`;
  }
  const formatter = new Intl.NumberFormat(localeForCurrency(currency), {
    style: 'currency',
    currency,
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits:
      options.maximumFractionDigits ?? (options.compact ? 1 : currency.toUpperCase() === 'INR' ? 0 : 2),
  });
  return formatter.format(numeric);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

export function daysBetween(from: string, to: Date = new Date()): number {
  const start = new Date(from.length === 10 ? `${from}T00:00:00Z` : from);
  return Math.floor((to.getTime() - start.getTime()) / 86_400_000);
}

export function daysOverdue(dueDate: string, now: Date = new Date()): number {
  const due = new Date(`${dueDate}T00:00:00Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
}
