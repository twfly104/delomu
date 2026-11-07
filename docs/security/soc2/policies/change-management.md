# Change management policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

- All code changes go through git, with a message that says what changed and why.
- The full test suite (`npm test`) passes before a change is pushed to `main`. Railway deploys `main`.
- Changes that touch authentication, tenant isolation, secrets or the audit log come with a test that covers them.
- Database and file-format changes are backward compatible or include a migration.
- A failed deploy is rolled back by redeploying the previous commit on Railway.
- Target once a second engineer joins: every change through a pull request reviewed by someone else, branch
  protection on `main`, and CI that blocks the deploy when tests fail.
