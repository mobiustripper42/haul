---
schema: 1
id: DEC-002
title: "Cloudflare's proxy sits in front of Vercel"
topic: "Stack & hosting"
status: "active"
date: "2026-10-25"
ruling: "members.ohiocityfarm.com is proxied by Cloudflare with an Origin CA certificate and SSL Full (Strict); Vercel is the origin, never served to members directly."
claims:
  - kind: "spec"
    target: "§4"
  - kind: "unverifiable"
    target: "muster ops/residential-probe/README.md"
    note: "the incident record, in the sibling repo"
revisit_if: "Members reach a Vercel-served page reliably from home networks without the proxy, or Cloudflare cannot be authoritative for the farm's zone"
---

## DEC-002: Cloudflare's proxy sits in front of Vercel

Muster's production had intermittent `ERR_SSL_PROTOCOL_ERROR` and `ERR_CONNECTION_CLOSED` failures
that appeared only from real home and wifi networks; every datacenter test passed. Putting
Cloudflare's proxy in front fixed it, and it has worked every time since. The account is muster's
`ops/residential-probe/README.md` and a 2026-09-30 session note calling the proxy "the TLS fix" —
muster never wrote it as a decision, which is why this one exists.

The cost is DNS: Cloudflare must control DNS for the subdomain, so the farm's DNS access is on the
critical path.
