import type { Capabilities, UserRole } from './domain.js';

export function capabilitiesForRole(role: UserRole): Capabilities {
  switch (role) {
    case 'ADMIN':
      return {
        manageUsers: true,
        manageOrganizations: true,
        manageCategories: true,
        manageSettings: true,
        createProjects: true,
        approveProjects: true,
        assignReviewers: true,
        editOwnProjects: false,
        submitClaims: false,
        reviewClaims: false,
        anchorRecords: true,
        viewAudit: true,
      };
    case 'PROJECT_OWNER':
      return {
        manageUsers: false,
        manageOrganizations: false,
        manageCategories: false,
        manageSettings: false,
        createProjects: false,
        approveProjects: false,
        assignReviewers: false,
        editOwnProjects: true,
        submitClaims: true,
        reviewClaims: false,
        anchorRecords: true,
        viewAudit: false,
      };
    case 'REVIEWER':
      return {
        manageUsers: false,
        manageOrganizations: false,
        manageCategories: false,
        manageSettings: false,
        createProjects: false,
        approveProjects: false,
        assignReviewers: false,
        editOwnProjects: false,
        submitClaims: false,
        reviewClaims: true,
        anchorRecords: false,
        viewAudit: false,
      };
    case 'OBSERVER':
      return {
        manageUsers: false,
        manageOrganizations: false,
        manageCategories: false,
        manageSettings: false,
        createProjects: false,
        approveProjects: false,
        assignReviewers: false,
        editOwnProjects: false,
        submitClaims: false,
        reviewClaims: false,
        anchorRecords: false,
        viewAudit: false,
      };
  }
}

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Platform administrator',
  PROJECT_OWNER: 'Project owner',
  REVIEWER: 'Independent reviewer',
  OBSERVER: 'Public observer',
};

export function canAccessAdminArea(role: UserRole): boolean {
  return role === 'ADMIN';
}
