import { describe, expect, test } from 'vitest';
import {
  daysBetween,
  daysOverdue,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  localeForCurrency,
} from '../src/index.js';

describe('currency formatting', () => {
  test('selects the Indian grouping locale for INR and US grouping otherwise', () => {
    expect(localeForCurrency('INR')).toBe('en-IN');
    expect(localeForCurrency('inr')).toBe('en-IN');
    expect(localeForCurrency('USD')).toBe('en-US');
  });

  test('formats whole INR amounts without inventing paise', () => {
    const formatted = formatCurrency('2500000.00', 'INR');
    expect(formatted).toContain('25,00,000');
    expect(formatted).not.toContain('.00');
    expect(formatCurrency('2500000.00', 'INR', { maximumFractionDigits: 2 })).toContain('.00');
  });

  test('formats USD with two decimal places by default', () => {
    expect(formatCurrency('1234.5', 'USD')).toBe('$1,234.50');
  });

  test('never throws on unparseable amounts', () => {
    expect(formatCurrency('not-a-number', 'USD')).toBe('USD —');
    expect(formatCurrency(Number.POSITIVE_INFINITY, 'INR')).toBe('INR —');
  });
});

describe('number and percent formatting', () => {
  test('groups numbers and fixes percent precision', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatPercent(72)).toBe('72%');
    expect(formatPercent(72.456, 1)).toBe('72.5%');
  });
});

describe('calendar dates', () => {
  test('format date-only values in UTC without a timezone shift', () => {
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  test('format timestamps in UTC', () => {
    const formatted = formatDateTime('2026-03-05T14:30:00.000Z');
    expect(formatted).toContain('05 Mar 2026');
    expect(formatted).toContain('14:30');
    expect(formatDateTime(undefined)).toBe('—');
  });

  test('calculate elapsed and overdue days from UTC calendar dates', () => {
    expect(daysBetween('2026-01-01', new Date('2026-01-11T12:00:00Z'))).toBe(10);
    expect(daysOverdue('2026-01-01', new Date('2026-01-11T12:00:00Z'))).toBe(10);
    expect(daysOverdue('2026-02-01', new Date('2026-01-11T12:00:00Z'))).toBe(0);
  });
});
