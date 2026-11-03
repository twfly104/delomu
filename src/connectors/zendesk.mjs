// Tests a Zendesk AI agent through the Sunshine Conversations API v2.
//
// target.type "zendesk": { appId, keyId, secret, subdomain | baseUrl, pollMs?, timeoutMs? }
//   keyId and secret are an app API key as ${ENV_VAR} references (basic auth); appId may be one too.
//   Every input gets a fresh test user (externalId "delomu-<uuid>") and a personal conversation, the
//   input is posted as that user's text message, and the first business-authored reply after it is the
//   answer. The base URL is https://{subdomain}.zendesk.com/sc unless baseUrl is given.
//
// Docs (checked 2026-11-01):
//   https://developer.zendesk.com/api-reference/conversations/
//   https://developer.zendesk.com/documentation/conversations/getting-started/api-authentication/
//   https://github.com/zendesk/sunshine-conversations-api-spec/blob/master/openapi.yaml

import { randomUUID } from 'node:crypto';
import { expandEnv } from '../adapters.mjs';
import { ConnectorError, pollUntil, requestJson, stripHtml } from './common.mjs';

export const ZENDESK_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function zendeskBaseUrl(target) {
  if (target.baseUrl) return String(target.baseUrl).replace(/\/+$/, '');
  if (!ZENDESK_SUBDOMAIN.test(String(target.subdomain ?? ''))) throw new ConnectorError('zendesk target needs a subdomain (or a baseUrl)');
  return `https://${target.subdomain}.zendesk.com/sc`;
}

function client(target) {
  for (const k of ['appId', 'keyId', 'secret']) if (!target[k]) throw new ConnectorError(`zendesk target needs ${k}`);
  const app = `${zendeskBaseUrl(target)}/v2/apps/${encodeURIComponent(expandEnv(target.appId))}`;
  const basic = Buffer.from(`${expandEnv(target.keyId)}:${expandEnv(target.secret)}`).toString('base64');
  return (path, options = {}) => requestJson(app + path, { label: 'Zendesk', ...options, headers: { authorization: `Basic ${basic}` } });
}

const messageText = content => {
  if (!content) return '';
  if (content.text) return String(content.text).trim();
  if (content.markdownText) return String(content.markdownText).trim();
  return stripHtml(content.htmlText);
};

// The first message a business author (AI agent, bot or human agent) sent after the user's message.
export function zendeskReply(messages, sent) {
  const sentAt = Date.parse(sent.received ?? '') || 0;
  const after = messages.findIndex(m => m.id === sent.id);
  const candidates = after >= 0 ? messages.slice(after + 1) : messages.filter(m => (Date.parse(m.received ?? '') || 0) >= sentAt);
  for (const m of candidates) {
    if (m.author?.type !== 'business' || m.id === sent.id) continue;
    const text = messageText(m.content);
    if (text) return text;
  }
  return null;
}

export async function callZendesk(target, input) {
  const api = client(target);
  const timeoutMs = target.timeoutMs ?? 60_000;
  const { user } = await api('/users', { method: 'POST', body: { externalId: `delomu-${randomUUID()}`, profile: { givenName: 'Grapim', surname: 'Test' } } });
  if (!user?.id) throw new ConnectorError('Zendesk did not return a user id');
  const { conversation } = await api('/conversations', { method: 'POST', body: { type: 'personal', participants: [{ userId: user.id }] } });
  if (!conversation?.id) throw new ConnectorError('Zendesk did not return a conversation id');
  const messagesPath = `/conversations/${encodeURIComponent(conversation.id)}/messages`;
  const posted = await api(messagesPath, {
    method: 'POST',
    body: { author: { type: 'user', userId: user.id }, content: { type: 'text', text: input } },
  });
  const sent = posted.messages?.[0] ?? { received: new Date().toISOString() };
  return pollUntil(async left => zendeskReply((await api(messagesPath, { timeoutMs: left })).messages ?? [], sent), {
    pollMs: target.pollMs ?? 2000, timeoutMs, what: `Zendesk conversation ${conversation.id}`,
  });
}
