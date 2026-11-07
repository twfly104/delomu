# Vendor management policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

- Every vendor that can receive client data is listed in `docs/trust/subprocessors.md` before it is used.
- Before adding one, check what data it receives and where, whether it trains on that data, and whether it has a
  SOC 2 or ISO 27001 report. Keep a copy of the report in `../evidence/vendors/`.
- Vendors are reviewed yearly. Clients are told before a new subprocessor is added, as the DPA says.

Vendors that can receive client data today: Anthropic, Meta (model API; contributor models are refused), Railway,
and Stripe (billing data only). Cloudflare provides DNS only and receives no client data (its proxy is off).
