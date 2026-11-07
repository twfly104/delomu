# Incident response policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

An incident is anything that may have exposed, changed or lost client data, or made Grapim unavailable.

## Steps
1. **Detect.** From alerts, logs, a client, or a vulnerability report (GitHub private reporting).
2. **Contain.** Revoke exposed keys, end sessions, and take the affected feature offline if needed.
3. **Assess.** Which data, which clients, since when. Use the audit logs (`audit.jsonl` and the org events).
4. **Notify.** Tell affected clients within 72 hours of confirming their data was involved: what happened, which
   data, and what they should do. Follow any shorter period in a client's DPA.
5. **Fix and recover.** Fix the cause, restore from backup if needed, and verify.
6. **Learn.** Within 7 days, write a short report in `../evidence/incidents/`: timeline, cause, fix, and what
   changes so it does not happen again.

## Contact
The founder, through GitHub private vulnerability reporting or the email on grapim.com/security, until a
dedicated security mailbox exists.
