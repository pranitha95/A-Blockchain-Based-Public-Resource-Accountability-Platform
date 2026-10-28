import { ApiError } from './api';

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const issue of error.validationIssues) {
    if (!issue.field || !issue.message) continue;
    if (!result[issue.field]) result[issue.field] = issue.message;
  }
  return result;
}

export function fieldError(error: unknown, field: string): string | undefined {
  return fieldErrors(error)[field];
}

export function messageFor(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}
