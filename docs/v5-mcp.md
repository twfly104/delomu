# v5: Grapim over MCP

Engineers can use Grapim from Claude Code, Cursor, Claude Desktop or any MCP client. They can list agents, run
the policy check, read what broke, draft a fix and approve drafts without leaving their AI tool. The code is in
`src/v3/mcp.mjs`.

## Connect

Use your sign-in key, which is also an API key, or any API key from `/v1/orgs/:org/api_keys`. The agent's
**Settings** page shows both snippets below with this server's address filled in.

**Claude Code:**

```
claude mcp add --transport http grapim https://YOUR-GRAPIM/mcp --header "Authorization: Bearer YOUR_KEY"
```

**Cursor or Claude Desktop** (`mcp.json` or the app's settings):

```json
{ "mcpServers": { "grapim": { "url": "https://YOUR-GRAPIM/mcp", "headers": { "Authorization": "Bearer YOUR_KEY" } } } }
```

## Tools

| Tool | Does | Permission | Changes something |
| --- | --- | --- | --- |
| `list_agents` | Every agent the key can open, with its last check, drafts waiting and next step | `org:read`, `deployments:read` | No |
| `get_agent` | The six steps, the next step, the drafts waiting and the last check | `deployments:read` | No |
| `run_check` | Starts the policy check. With `wait: true` it waits up to 4 minutes and returns the broken rules | `deployments:write` | Yes |
| `get_check_results` | Each broken rule: clause, what the customer wrote, what the agent said and did, what went wrong and the suggested fix | `runs:read` | No |
| `list_drafts` | Drafts waiting for a person | `drafts:read` | No |
| `review_draft` | Approves (and applies) or rejects one draft | `drafts:review` | Yes |
| `draft_fix` | Drafts a change to the agent's instructions for the broken rules. A person approves it in Grapim | `deployments:write` | Yes |
| `guard_check` | Asks the guard about a reply or an action (`{ tool, input }`) before it reaches a customer | `guard:check` | No |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`), so clients can ask before running the
ones that change something. Each tool calls the same functions as `/v1` and the web pages, so the same access
checks, plan limits, rate limit per key and audit log apply. A check started from MCP is the same job as one
started on the Check results page.

## Protocol

- **Transport:** Streamable HTTP. `POST /mcp` takes one JSON-RPC 2.0 message and answers in JSON. There are no
  server-sent events and no sessions. `GET` and `DELETE` answer 405.
- **Protocol versions:** `2025-06-18`, `2025-03-26` and `2024-11-05`. An unknown version gets `2025-06-18`.
- **Methods:** `initialize`, `ping`, `tools/list` and `tools/call`. Notifications get 202. Other methods get
  `-32601`. JSON-RPC batches are refused, as in 2025-06-18.
- **Errors:**
  - A tool error, such as an unknown agent, a missing permission or no check yet, comes back as a tool result
    with `isError: true` and a plain message.
  - A missing or bad key answers 401 with `WWW-Authenticate: Bearer`.
