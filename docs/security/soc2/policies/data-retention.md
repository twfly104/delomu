# Data classification and retention policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

| Class | Examples | Handling |
| --- | --- | --- |
| Client confidential | Policies, documents, ticket exports, test messages, AI answers, live conversations, recorded API call shapes | Kept per org; sent only to the model provider; never used for training |
| Secret | API keys, tokens, client secrets | Encrypted or hashed; never shown again; only names appear in logs |
| Internal | Audit logs, usage counts, billing state | Kept for the life of the account |
| Public | Marketing site, docs | No restriction |

## Retention
- Client data is kept while the client's account is active, and deleted within 30 days of a written request or
  of the account closing.
- Live conversations: target automatic deletion after 12 months. Not automatic yet (see the gaps in the README).
- Audit logs are kept for the life of the deployment, because they are the record clients sign off on.
- A recorded browser session is reduced to the shape of its API calls on upload; the raw file is never stored.
