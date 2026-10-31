// First-run setup: creates the first org, its owner and an API key for that owner. Refuses to run
// once any org exists, so it cannot be used to take over an installed server.

import { addMember, createOrg, countOrgs } from './accounts.mjs';
import { openDb, tx } from './db.mjs';
import { recordEvent } from './events.mjs';
import { checkPepper, createApiKey } from './keys.mjs';

// Returns { org, member, key, secret }. The secret is shown once and is not stored.
export function bootstrap({ dataDir, org: name, email, kind = 'customer', pepper }, now = new Date()) {
  checkPepper(pepper);
  const db = openDb(dataDir);
  try {
    return tx(db, () => {
      if (countOrgs(db) > 0) throw new Error('this server is already set up; use the API to add orgs, members and keys');
      const org = createOrg(db, { name, kind }, now);
      const member = addMember(db, org.id, { email, role: 'owner' }, null, now);
      const { key, secret } = createApiKey(db, { orgId: org.id, userId: member.user_id, name: 'bootstrap' }, pepper, now);
      recordEvent(db, { orgId: org.id, actor: 'system', action: 'org.bootstrap', target: org.id, detail: { owner: member.email, key: key.prefix } }, now);
      return { org, member, key, secret };
    });
  } finally {
    db.close();
  }
}
