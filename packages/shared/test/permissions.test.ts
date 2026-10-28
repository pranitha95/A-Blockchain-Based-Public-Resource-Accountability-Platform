import { describe, expect, test } from 'vitest';
import { ROLE_LABEL, capabilitiesForRole, canAccessAdminArea } from '../src/index.js';

describe('role capabilities', () => {
  test('administrators manage the platform but cannot act as project owners or reviewers', () => {
    const capabilities = capabilitiesForRole('ADMIN');
    expect(capabilities.manageUsers).toBe(true);
    expect(capabilities.createProjects).toBe(true);
    expect(capabilities.approveProjects).toBe(true);
    expect(capabilities.assignReviewers).toBe(true);
    expect(capabilities.editOwnProjects).toBe(false);
    expect(capabilities.submitClaims).toBe(false);
    expect(capabilities.reviewClaims).toBe(false);
  });

  test('project owners submit records but cannot approve or review them', () => {
    const capabilities = capabilitiesForRole('PROJECT_OWNER');
    expect(capabilities.editOwnProjects).toBe(true);
    expect(capabilities.submitClaims).toBe(true);
    expect(capabilities.anchorRecords).toBe(true);
    expect(capabilities.approveProjects).toBe(false);
    expect(capabilities.reviewClaims).toBe(false);
    expect(capabilities.createProjects).toBe(false);
  });

  test('reviewers decide claims but cannot approve projects, submit claims or anchor records', () => {
    const capabilities = capabilitiesForRole('REVIEWER');
    expect(capabilities.reviewClaims).toBe(true);
    expect(capabilities.approveProjects).toBe(false);
    expect(capabilities.submitClaims).toBe(false);
    expect(capabilities.anchorRecords).toBe(false);
    expect(capabilities.viewAudit).toBe(false);
  });

  test('public observers have no privileged capabilities', () => {
    const capabilities = capabilitiesForRole('OBSERVER');
    expect(Object.values(capabilities).some(Boolean)).toBe(false);
  });

  test('separation of duties holds across every role', () => {
    for (const role of ['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER'] as const) {
      const capabilities = capabilitiesForRole(role);
      expect(capabilities.approveProjects && capabilities.reviewClaims).toBe(false);
      expect(capabilities.submitClaims && capabilities.reviewClaims).toBe(false);
      expect(capabilities.editOwnProjects && capabilities.approveProjects).toBe(false);
    }
  });

  test('only administrators can access the admin area', () => {
    expect(canAccessAdminArea('ADMIN')).toBe(true);
    expect(canAccessAdminArea('PROJECT_OWNER')).toBe(false);
    expect(canAccessAdminArea('REVIEWER')).toBe(false);
    expect(canAccessAdminArea('OBSERVER')).toBe(false);
    expect(ROLE_LABEL.REVIEWER).toBe('Independent reviewer');
  });
});
