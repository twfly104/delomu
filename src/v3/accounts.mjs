// Orgs, users and memberships. A partner org can manage customer orgs (partner_org_id); a customer org
// never manages another org. Validation lives here so the API, the web UI and the CLI share it.

import { newId } from './db.mjs';
import { invalid, forbidden } from './http.mjs';
import { isRole, isManager, ROLES } from './rbac.mjs';

const EMAIL = /^[^\s@<>()",;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw invalid('email must be a valid email address.', 'email');
  return email;
}

export function cleanName(value, param = 'name') {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100) throw invalid(`${param} must be 1 to 100 characters.`, param);
  return name;
}

export function checkRole(value, param = 'role') {
  if (!isRole(value)) throw invalid(`${param} must be one of: ${ROLES.join(', ')}.`, param);
  return value;
}

const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';

function uniqueSlug(db, name) {
  const base = slugify(name);
  const taken = db.prepare('SELECT 1 FROM orgs WHERE slug = ?');
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!taken.get(slug)) return slug;
  }
}

const orgObject = row => row && {
  object: 'org', id: row.id, name: row.name, slug: row.slug, kind: row.kind, partner_org_id: row.partner_org_id ?? null, created_at: row.created_at,
};

export function createOrg(db, { name, kind = 'customer', partnerOrgId = null }, now = new Date()) {
  name = cleanName(name);
  if (!['customer', 'partner'].includes(kind)) throw invalid('kind must be customer or partner.', 'kind');
  if (partnerOrgId) {
    if (kind !== 'customer') throw invalid('Only customer orgs can be managed by a partner.', 'kind');
    if (getOrg(db, partnerOrgId)?.kind !== 'partner') throw invalid('partner_org_id must be a partner org.', 'partner_org_id');
  }
  const org = { id: newId('org'), name, slug: uniqueSlug(db, name), kind, partner_org_id: partnerOrgId, created_at: now.toISOString() };
  db.prepare('INSERT INTO orgs (id, name, slug, kind, partner_org_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(org.id, org.name, org.slug, org.kind, org.partner_org_id, org.created_at);
  return orgObject(org);
}

export const getOrg = (db, id) => orgObject(db.prepare('SELECT * FROM orgs WHERE id = ?').get(String(id)));
export const getOrgBySlug = (db, slug) => orgObject(db.prepare('SELECT * FROM orgs WHERE slug = ?').get(String(slug)));
export const countOrgs = db => db.prepare('SELECT COUNT(*) AS n FROM orgs').get().n;

// The home org plus, for partner owners and admins, every customer org the partner manages.
export function accessibleOrgs(db, principal, homeRole) {
  const home = getOrg(db, principal.homeOrgId);
  if (!home || !homeRole) return [];
  const out = [home];
  if (home.kind === 'partner' && isManager(homeRole)) {
    out.push(...db.prepare('SELECT * FROM orgs WHERE partner_org_id = ? ORDER BY created_at, id').all(home.id).map(orgObject));
  }
  return out;
}

export function upsertUser(db, email, now = new Date()) {
  email = normalizeEmail(email);
  const found = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (found) return found;
  const user = { id: newId('user'), email, name: '', created_at: now.toISOString() };
  db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(user.id, user.email, user.name, user.created_at);
  return user;
}

export const getUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(String(id));

const memberObject = r => ({ object: 'member', user_id: r.user_id, email: r.email, role: r.role, created_at: r.created_at });
const MEMBER_SQL = 'SELECT m.*, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?';

export function getMember(db, orgId, userId) {
  const r = db.prepare(`${MEMBER_SQL} AND m.user_id = ?`).get(orgId, String(userId));
  return r ? memberObject(r) : null;
}

export const listMembers = (db, orgId) => db.prepare(`${MEMBER_SQL} ORDER BY m.created_at, m.user_id`).all(orgId).map(memberObject);

// actorRole is the caller's role (null for the bootstrap CLI, which may create the first owner).
export function addMember(db, orgId, { email, role }, actorRole, now = new Date()) {
  checkRole(role);
  if (actorRole !== null) guardOwner(actorRole, role, role);
  const user = upsertUser(db, email, now);
  if (getMember(db, orgId, user.id)) throw invalid(`${user.email} is already a member.`, 'email');
  db.prepare('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(orgId, user.id, role, now.toISOString());
  return getMember(db, orgId, user.id);
}

const ownerCount = (db, orgId) => db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'").get(orgId).n;

// Only owners grant, change or remove the owner role, and an org always keeps one owner.
export function setMemberRole(db, orgId, userId, role, actorRole) {
  checkRole(role);
  const member = getMember(db, orgId, userId);
  if (!member) return null;
  guardOwner(actorRole, member.role, role);
  if (member.role === 'owner' && role !== 'owner' && ownerCount(db, orgId) === 1) throw invalid('An org must keep at least one owner.', 'role');
  db.prepare('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?').run(role, orgId, member.user_id);
  return { ...member, role };
}

// Removing a member also revokes their keys and ends their sessions in that org.
export function removeMember(db, orgId, userId, actorRole, now = new Date()) {
  const member = getMember(db, orgId, userId);
  if (!member) return null;
  guardOwner(actorRole, member.role, member.role);
  if (member.role === 'owner' && ownerCount(db, orgId) === 1) throw invalid('An org must keep at least one owner.');
  db.prepare('DELETE FROM memberships WHERE org_id = ? AND user_id = ?').run(orgId, member.user_id);
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL').run(now.toISOString(), orgId, member.user_id);
  db.prepare('DELETE FROM sessions WHERE org_id = ? AND user_id = ?').run(orgId, member.user_id);
  return member;
}

function guardOwner(actorRole, fromRole, toRole) {
  if ((fromRole === 'owner' || toRole === 'owner') && actorRole !== 'owner') {
    throw forbidden('Only an owner can grant, change or remove the owner role.');
  }
}
