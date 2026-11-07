# Risk assessment

Owner: Alexander Ko, founder. First assessment 2026-11-07. Reviewed every 12 months; next by 2027-11.

| Risk | Likelihood | Impact | Treatment |
| --- | --- | --- | --- |
| A tenant reads another tenant's data | Low | High | Per-org paths re-checked on every access; isolation tests |
| Stolen admin credentials (GitHub, Railway) | Medium | High | MFA on all admin accounts; quarterly access review |
| A leaked API key or session | Medium | Medium | Hashed storage; revocation; short-lived sign-in links |
| A model provider mishandles client data | Low | High | Providers that train on data refused; DPA; subprocessor review |
| The data volume is lost | Low | High | Daily backups; a restore test every 6 months |
| Prompt injection inside client material | Medium | Medium | Material marked as data in every prompt; every output is a draft a person approves |
| The guard lets a bad reply through when it cannot judge | Medium | Medium | Fail-open is documented; live monitoring flags it afterwards |
| The only founder is unavailable | Medium | High | Code and runbooks in git; recovery codes for Railway and GitHub stored offline |
