# Business continuity and backup policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

- All state is in one data volume on Railway: the SQLite database and the deployment folders.
- The volume is backed up at least daily, and backups are kept for at least 7 days.
- A restore is tested every 6 months into a scratch service. The date and how long it took are recorded in
  `../evidence/restore-tests.md`.
- Targets: service restored within 24 hours (RTO), with at most 24 hours of data lost (RPO).
- The code is in GitHub; the server can be rebuilt from the Dockerfile on any container host.
