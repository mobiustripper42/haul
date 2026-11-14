---
schema: 1
id: DEC-002
title: "Cloudflare's proxy sits in front of the app host"
topic: "Stack & hosting"
status: "draft"
date: "2026-10-25"
ruling: "members.ohiocityfarm.com is proxied by Cloudflare with an Origin CA certificate and SSL Full (Strict); the app host, whichever task 1.8 chooses, is the origin, never served to members directly."
claims:
  - kind: "spec"
    target: "§4"
  - kind: "unverifiable"
    target: "muster ops/residential-probe/README.md"
    note: "the incident record, in the sibling repo"
revisit_if: "Members reach a Vercel-served page reliably from home networks without the proxy, or Cloudflare cannot be authoritative for the farm's zone"
---

## DEC-002: Cloudflare's proxy sits in front of the app host

Drafted 2026-10-25 naming Vercel as the origin and marked active; put back to draft 2026-11-13, no
Cloudflare zone or host account having been made (Eric). The proxy stays the intent for any host
that serves members directly; it is settled in task 1.8.

Muster's production had intermittent `ERR_SSL_PROTOCOL_ERROR` and `ERR_CONNECTION_CLOSED` failures
that appeared only from real home and wifi networks; every datacenter test passed. Putting
Cloudflare's proxy in front fixed it, and it has worked every time since. The account is muster's
`ops/residential-probe/README.md` and a 2026-09-30 session note calling the proxy "the TLS fix" —
muster never wrote it as a decision, which is why this one exists.

The cost is DNS: Cloudflare must control DNS for the subdomain, so the farm's DNS access is on the
critical path.
