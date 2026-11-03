// Tests an Intercom Fin agent or bot through the Intercom REST API.
//
// target.type "intercom": { token, contactExternalId?, pollMs?, timeoutMs?, baseUrl?, version? }
//   token is an access token as an ${ENV_VAR} reference. The test contact (a user with external_id
//   contactExternalId, default "delomu-test") is found or created, every input starts a new conversation
//   from that contact, and the first reply by a bot or teammate after it is the answer, as plain text.
//
// Docs (checked 2026-11-01, Intercom-Version 2.17):
//   https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/searchcontacts
//   https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/createcontact
//   https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/createconversation
//   https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/retrieveconversation
//   https://developers.intercom.com/docs/references/preview/rest-api/api.intercom.io/models/conversation_part

import { expandEnv } from '../adapters.mjs';
import { ConnectorError, pollUntil, requestJson, stripHtml } from './common.mjs';

export const INTERCOM_BASE_URL = 'https://api.intercom.io';
const INTERCOM_VERSION = '2.17';
const REPLY_AUTHORS = new Set(['bot', 'admin']);

function client(target) {
  if (!target.token) throw new ConnectorError('intercom target needs a token (an ${ENV_VAR} reference)');
  const base = String(target.baseUrl ?? INTERCOM_BASE_URL).replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${expandEnv(target.token)}`, 'intercom-version': String(target.version ?? INTERCOM_VERSION) };
  return (path, options = {}) => requestJson(base + path, { label: 'Intercom', ...options, headers });
}

async function findOrCreateContact(api, externalId) {
  const found = await api('/contacts/search', {
    method: 'POST',
    body: { query: { operator: 'AND', value: [{ field: 'external_id', operator: '=', value: externalId }] } },
  });
  if (found.data?.[0]?.id) return found.data[0];
  try {
    return await api('/contacts', { method: 'POST', body: { role: 'user', external_id: externalId, name: 'Grapim test' } });
  } catch (e) {
    // Search can lag behind a contact created moments ago; the conflict error names the existing id.
    const id = e.status === 409 && /id=([0-9a-f]+)/i.exec(e.message)?.[1];
    if (id) return { id, role: 'user' };
    throw e;
  }
}

// The first part a bot or teammate wrote after the user's message. Internal notes are not replies.
export function intercomReply(conversation, sentAt) {
  const parts = conversation?.conversation_parts?.conversation_parts ?? [];
  for (const part of parts) {
    if (!REPLY_AUTHORS.has(part.author?.type)) continue;
    if (String(part.part_type ?? '').includes('note')) continue;
    if (Number(part.created_at ?? 0) < sentAt) continue;
    const text = stripHtml(part.body);
    if (text) return text;
  }
  return null;
}

export async function callIntercom(target, input) {
  const api = client(target);
  const timeoutMs = target.timeoutMs ?? 60_000;
  const contact = await findOrCreateContact(api, String(target.contactExternalId ?? 'delomu-test'));
  const sent = await api('/conversations', {
    method: 'POST',
    body: { from: { type: contact.role === 'lead' ? 'lead' : 'user', id: contact.id }, body: input },
  });
  if (!sent.conversation_id) throw new ConnectorError('Intercom did not return a conversation_id');
  const sentAt = Number(sent.created_at ?? Math.floor(Date.now() / 1000) - 1);
  const path = `/conversations/${encodeURIComponent(sent.conversation_id)}?display_as=plaintext`;
  return pollUntil(async left => intercomReply(await api(path, { timeoutMs: left }), sentAt), {
    pollMs: target.pollMs ?? 2000, timeoutMs, what: `Intercom conversation ${sent.conversation_id}`,
  });
}
