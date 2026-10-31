// Roles, permissions and who may act on which org. The matrix below is the single source of truth;
// docs/v3.md prints the same table. Partner owners and admins act on the customer orgs their partner
// manages with the "admin" role; nobody else crosses an org boundary.

export const ROLES = ['owner', 'admin', 'engineer', 'reviewer', 'viewer'];

const ALL = ROLES;
const MANAGERS = ['owner', 'admin'];

export const MATRIX = {
  'org:read': ALL,
  'org:manage': MANAGERS,
  'members:read': ALL,
  'members:manage': MANAGERS,
  'keys:manage': MANAGERS,
  'deployments:read': ALL,
  'deployments:write': ['owner', 'admin', 'engineer'],
  'runs:read': ALL,
  'runs:create': ['owner', 'admin', 'engineer'],
  'drafts:read': ALL,
  'drafts:review': ['owner', 'admin', 'engineer', 'reviewer'],
  'audit:read': ['owner', 'admin', 'reviewer'],
  'usage:read': MANAGERS,
};

export const PERMISSIONS = Object.keys(MATRIX);

// The role a partner org's owners and admins get inside the customer orgs that partner manages.
export const PARTNER_ROLE = 'admin';

export const isRole = value => ROLES.includes(value);

export const roleAllows = (role, permission) => MATRIX[permission]?.includes(role) ?? false;

export const isManager = role => MANAGERS.includes(role);

// Effective role of a principal in an org, or null. principal: { userId, homeOrgId }.
export function roleIn(db, principal, orgId) {
  const member = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?');
  if (orgId === principal.homeOrgId) return member.get(orgId, principal.userId)?.role ?? null;
  const org = db.prepare('SELECT partner_org_id FROM orgs WHERE id = ?').get(orgId);
  if (!org?.partner_org_id || org.partner_org_id !== principal.homeOrgId) return null;
  return isManager(member.get(principal.homeOrgId, principal.userId)?.role) ? PARTNER_ROLE : null;
}

// Allowed when the role grants the permission and, for a restricted key, the key's scopes include it.
export function principalAllows(principal, role, permission) {
  if (!roleAllows(role, permission)) return false;
  return !principal.scopes || principal.scopes.includes(permission);
}
