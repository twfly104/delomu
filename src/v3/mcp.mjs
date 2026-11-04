// Grapim over MCP (Model Context Protocol): engineers use Grapim from Claude Code, Cursor or Claude Desktop.
// POST /mcp takes JSON-RPC 2.0 (the Streamable HTTP transport, answering in plain JSON; no server-sent events,
// no sessions). It signs in with the same API key as /v1 (Authorization: Bearer dk_...), and every tool goes
// through the same access checks, plan limits and audit log as the API and the web pages.
//
// Tools: list_agents, get_agent, run_check, get_check_results, list_drafts, review_draft, draft_fix,
// guard_check. Anything that changes something is marked in its annotations, so clients ask before running it.

import { ApiError, readJson, send } from './http.mjs';
import { accessibleOrgs } from './accounts.mjs';
import { principalAllows, roleIn } from './rbac.mjs';
import { access, deploymentFor, draftsOf, guardLiveAction, guardLiveReply, reviewDeploymentDraft } from './operations.mjs';
import { listDeployments } from './workspace.mjs';
import { overview } from './insights.mjs';
import { loadConfig } from '../deployment.mjs';
import { listScans } from '../v1/risk.mjs';
import { draftFix } from '../v1/fix.mjs';
import { createLlm } from '../core/llm.mjs';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'grapim', title: 'Grapim', version: '1.0.0' };
const INSTRUCTIONS = 'Grapim checks AI agents against their company\'s written policy. Start with list_agents to get org and agent ids. get_agent says where a rollout stands and what to do next; run_check tests the agent; get_check_results explains broken rules; draft_fix and review_draft move fixes forward. Changes need a person\'s approval in the client.';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const str = description => ({ type: 'string', description });
const target = { org: str('Org id from list_agents, like org_0123456789abcdef.'), agent: str('Agent (deployment) name from list_agents.') };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const TOOLS = [
  { name: 'list_agents', title: 'List AI agents', description: 'Every AI agent (deployment) you can open, per org and client, with its last check result, drafts waiting and next step.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: readOnly },
  { name: 'get_agent', title: 'Get an agent', description: 'Where one agent\'s rollout stands: the six steps, the next step, drafts waiting and the last check.', inputSchema: { type: 'object', properties: target, required: ['org', 'agent'], additionalProperties: false }, annotations: readOnly },
  { name: 'run_check', title: 'Run the policy check', description: 'Tests the agent against its policies: writes the messages most likely to break each rule, sends them, judges what it said and did. Takes one to three minutes; with wait=true this call waits and returns the result.', inputSchema: { type: 'object', properties: { ...target, wait: { type: 'boolean', description: 'Wait for the result (up to 4 minutes). Default false.' } }, required: ['org', 'agent'], additionalProperties: false }, annotations: writes },
  { name: 'get_check_results', title: 'Get check results', description: 'The last check: each broken rule with its clause, what the customer wrote, what the agent said and did, what went wrong and the suggested fix.', inputSchema: { type: 'object', properties: target, required: ['org', 'agent'], additionalProperties: false }, annotations: readOnly },
  { name: 'list_drafts', title: 'List drafts to review', description: 'Drafts the Grapim agent made for this rollout (mapping, integration, connector, test cases, report) that wait for a person.', inputSchema: { type: 'object', properties: target, required: ['org', 'agent'], additionalProperties: false }, annotations: readOnly },
  { name: 'review_draft', title: 'Approve or reject a draft', description: 'Approves (and applies) or rejects one draft. Only when the person asked for it.', inputSchema: { type: 'object', properties: { ...target, draft_id: str('Draft id from list_drafts.'), decision: { type: 'string', enum: ['approve', 'reject'] }, note: str('Optional note for the audit log.') }, required: ['org', 'agent', 'draft_id', 'decision'], additionalProperties: false }, annotations: writes },
  { name: 'draft_fix', title: 'Draft a fix', description: 'Drafts one change to the agent\'s instructions for the rules the last check found broken. A person approves it in Grapim before it applies.', inputSchema: { type: 'object', properties: target, required: ['org', 'agent'], additionalProperties: false }, annotations: writes },
  { name: 'guard_check', title: 'Check a reply or action', description: 'Asks the guard whether a reply, or an action such as a refund, keeps the policy before it reaches a customer. Give reply, or action with tool and input.', inputSchema: { type: 'object', properties: { ...target, message: str('The customer\'s message.'), reply: str('The reply the agent is about to send.'), action: { type: 'object', description: 'A tool call the agent is about to make: { tool, input }.', properties: { tool: { type: 'string' }, input: { type: 'object' } } } }, required: ['org', 'agent'], additionalProperties: false }, annotations: { ...readOnly, idempotentHint: false } },
];

const brokenRules = scan => (scan?.rules ?? []).filter(r => r.probes?.some(p => p.status === 'broken')).map(r => {
  const p = r.probes.find(x => x.status === 'broken');
  return { rule: r.rule, clause: r.clause, severity: r.severity, customer_wrote: clip(p?.message, 400), agent_said: clip(p?.answer, 500), agent_did: (p?.actions ?? []).map(a => a.tool), what_happened: clip(p?.what_happened, 400), suggested_fix: clip(p?.fix, 300) };
});
const checkSummary = scan => (scan ? { id: scan.id, at: scan.createdAt, rules: scan.summary.rules, broken: scan.summary.broken, messages: scan.summary.probes } : null);

// The tools, as functions of (args, principal). A thrown ApiError becomes a tool error the model can read.
function tools(ctx) {
  const pageUrl = (org, agent, tail = '') => `${ctx.publicUrl ?? ''}/orgs/${org}/deployments/${encodeURIComponent(agent)}${tail}`;
  const deployment = (principal, args, permission) => {
    const { org } = access(ctx, principal, String(args.org ?? ''), permission);
    const { dir } = deploymentFor(ctx, org.id, String(args.agent ?? ''));
    let config = {};
    try { config = loadConfig(dir); } catch { /* not configured yet */ }
    return { org, dir, config, name: String(args.agent) };
  };
  return {
    list_agents: (args, principal) => {
      const homeRole = roleIn(ctx.db, principal, principal.homeOrgId);
      if (!principalAllows(principal, homeRole, 'org:read')) throw new ApiError('permission_error', 'This key does not allow org:read.');
      return accessibleOrgs(ctx.db, principal, homeRole).flatMap(org => {
        try { access(ctx, principal, org.id, 'deployments:read'); } catch { return []; }
        return listDeployments(ctx.db, ctx.deploymentsRoot, org.id).map(d => {
          const { dir } = deploymentFor(ctx, org.id, d.name);
          let config = {};
          try { config = loadConfig(dir); } catch { /* not configured yet */ }
          const ov = overview(dir, config);
          return { org: org.id, client: org.name, agent: d.name, last_check: checkSummary(ov.scans[0]), drafts_waiting: ov.pending.length, next: ov.next?.text ?? null };
        });
      });
    },
    get_agent: (args, principal) => {
      const { org, dir, config, name } = deployment(principal, args, 'deployments:read');
      const ov = overview(dir, config);
      return { org: org.id, client: org.name, agent: name, steps: ov.steps.map(s => ({ step: s.label, state: s.state, detail: s.detail })), next: ov.next?.text ?? null, drafts_waiting: ov.pending.map(d => ({ id: d.id, kind: d.kind })), last_check: checkSummary(ov.scans[0]), url: pageUrl(org.id, name, '/rollout') };
    },
    run_check: async (args, principal) => {
      const { org, dir, name } = deployment(principal, args, 'deployments:write');
      if (!ctx.startScan) throw new ApiError('api_error', 'Checks cannot start from MCP on this server.');
      const job = await ctx.startScan(principal, org, name, dir);
      if (!args.wait) return { status: 'running', note: 'The check takes one to three minutes. Call get_check_results afterwards.', url: pageUrl(org.id, name, '/scan') };
      await Promise.race([job.done, new Promise(r => setTimeout(r, 240_000))]);
      if (job.status === 'failed') throw new ApiError('invalid_request_error', job.error ?? 'The check failed.');
      if (job.status !== 'done') return { status: 'running', note: 'Still running after 4 minutes. Call get_check_results later.' };
      const scan = listScans(dir)[0];
      return { status: 'done', check: checkSummary(scan), broken_rules: brokenRules(scan), url: pageUrl(org.id, name, '/scan') };
    },
    get_check_results: (args, principal) => {
      const { org, dir, name } = deployment(principal, args, 'runs:read');
      const scan = listScans(dir)[0];
      if (!scan) return { check: null, note: 'No check yet. Use run_check.' };
      return { check: checkSummary(scan), broken_rules: brokenRules(scan), url: pageUrl(org.id, name, '/scan') };
    },
    list_drafts: (args, principal) => {
      const { org, name } = deployment(principal, args, 'drafts:read');
      return draftsOf(ctx, org.id, name, 'pending').map(d => ({ id: d.id, kind: d.kind, created: d.createdAt, why: clip(d.rationale, 300) }));
    },
    review_draft: async (args, principal) => {
      const { org, name } = deployment(principal, args, 'drafts:review');
      const d = await reviewDeploymentDraft(ctx, principal, org.id, name, String(args.draft_id ?? ''), { decision: args.decision, note: String(args.note ?? '') });
      return { id: d.id, kind: d.kind, status: d.status };
    },
    draft_fix: async (args, principal) => {
      const { org, dir, name } = deployment(principal, args, 'deployments:write');
      const res = await draftFix(dir, { llm: ctx.llm ?? createLlm(), now: ctx.now() });
      if (!res.ok) throw new ApiError('invalid_request_error', `No fix drafted: ${res.reason}.`);
      return { summary: res.fix.summary, instructions: res.fix.instructions, rules: res.fix.rules, approve_at: pageUrl(org.id, name, '/scan'), note: 'A person approves it in Grapim; then the same messages run again.' };
    },
    guard_check: async (args, principal) => {
      const { org, name } = deployment(principal, args, 'guard:check');
      if (args.action !== undefined) return guardLiveAction(ctx, principal, org.id, name, { action: args.action, message: args.message });
      return guardLiveReply(ctx, principal, org.id, name, { reply: args.reply, message: args.message });
    },
  };
}

// One JSON-RPC message in, one response out (or null for a notification).
export async function handleRpc(ctx, principal, msg, impl = tools(ctx)) {
  const id = msg?.id ?? null;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request.');
  if (msg.id === undefined) return null; // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const fn = impl[name];
      if (!fn) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const out = await fn(msg.params?.arguments ?? {}, principal);
        const structured = Array.isArray(out) ? { items: out } : out;
        return reply({ content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError: false });
      } catch (e) {
        const text = e instanceof ApiError ? e.message : 'Something went wrong on the server.';
        if (!(e instanceof ApiError)) ctx.log(`mcp tool ${name} failed: ${e.stack ?? e}`);
        return reply({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// The /mcp endpoint. authenticate(ctx, req) is the /v1 key check.
export function createMcpHandler(ctx, authenticate) {
  const impl = tools(ctx);
  return async function handleMcp(req, res) {
    const json = (status, value, headers = {}) => send(res, status, value === null ? '' : JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', ...headers });
    if (req.method !== 'POST') return json(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST for MCP requests.' } }, { allow: 'POST' });
    let principal;
    try {
      principal = authenticate(ctx, req);
    } catch (e) {
      return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: e.message } }, { 'www-authenticate': 'Bearer' });
    }
    const limit = ctx.rateLimit(principal.limitId);
    if (!limit.ok) return json(429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests for this API key; slow down.' } }, { 'retry-after': String(limit.retryAfterSec) });
    let body;
    try {
      ({ body } = await readJson(req, ctx.maxBodyBytes));
    } catch {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
    }
    // MCP 2025-06-18 dropped JSON-RPC batches: one message per request.
    if (Array.isArray(body)) return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one JSON-RPC message per request.' } });
    const out = await handleRpc(ctx, principal, body, impl);
    return out ? json(200, out) : json(202, null);
  };
}
