# Production Runbook

How production was stood up in task 1.8 (issue 60), how to redo it, and the January cutover. Written
2026-11-15, the night it was done. A step marked **pending** has not been done yet.

## What production is

- **App:** Vercel, Eric's personal account. Builds the `production` branch only. Address today:
  `haul-blond.vercel.app`; `members.ohiocityfarm.com` once the DNS step is done.
- **Database:** Crunchy Bridge, the farm's team (Ohio City Farm), database `haul`. TLS is verified
  against the team's root, committed as `CRUNCHY_TEAM_CA` in `src/adapters/pg-connect.ts` (DEC-001).
- **Email:** Resend, Eric's personal account, sending as `lenny@ohiocityfarm.com`. Domain records
  live in Wix DNS.
- **Payments:** Square **sandbox** until task 1.9 (issue 61). No real money moves until then.
- **No Cloudflare proxy, for now.** `members.` points straight at Vercel. DEC-002 and
  `.claude/CLAUDE-context.md` still describe Vercel behind Cloudflare's proxy; skipping it was Eric's
  call on 2026-11-14 (session 6), and the proxy is revisited with the final hosts.
- **Final hosts:** decided after Phase 2. Azure, Cloudflare Workers and Amazon SES are all open
  (Eric, 2026-11-14, session 6; not elsewhere in the repo).

## Two database users, never mixed

- **`postgres`, the superuser.** Owns the schema and is the only user that ever migrates
  production. A later migration run as anyone else leaves its tables without haul_app's grants
  (DEC-037). Its password is rotated with Crunchy's dashboard button, not SQL.
- **`haul_app`, the app.** Logs in with its own password and holds only what the app-role
  migration grants. Only Vercel's `DATABASE_URL` uses it.

Both passwords live in the password manager and nowhere else.

**Keep passwords off the screen.** npm echoes every command after the shell has expanded it, so a
URL in a variable still prints in full. Read the URL into a variable without echo, and run npm with
`-s`, which stops npm printing the command:

```
read -rs OWNER_URL && export OWNER_URL      # paste the superuser URL ending in /haul, then Enter
```

## Standing it up from nothing

### 1. The app's login

As the superuser, from psql. Crunchy's query editor runs read-only and refuses this. Generate the
password (`openssl rand -base64 32 | tr -d '/+=' | head -c 32`) straight into the password manager,
then set it at psql's prompt, which neither echoes it nor writes it to history:

```
psql "$OWNER_URL"
```

```
create role haul_app login;
\password haul_app
```

Check it, typing the password at the prompt: `psql -W -h <host> -U haul_app -d haul -c "select current_user"`
prints `haul_app`. Grants come from the migration, not by hand.

### 2. Migrate

From a checkout of `production`, never `main` while Phase 1 is what production runs:

```
git fetch origin && git checkout --detach origin/production && npm ci
npm run -s db:migrate -- "$OWNER_URL"
```

Check the URL ends in `/haul`. On 2026-11-15 the first run went into the `postgres` database by
mistake; the cleanup is under "Gotchas".

### 3. The Supper Club's configuration, once

Same `production` checkout:

```
npm run -s db:seed:supper-club -- "$OWNER_URL" --production
```

It refuses unless `products` is empty, so it writes once; afterwards configuration is edited with
SQL (DEC-007). Run from `main`, it would write `main`'s dev first-pickup date: `main`'s
`db/seeds/supper-club.ts` is dev data.

### 4. Vercel

- **Settings → Environments → Production → Branch Tracking:** `production`.
- **Settings → Build & Deployment → Ignored Build Step:** Custom,
  `[ "$VERCEL_GIT_COMMIT_REF" = "production" ] && exit 1 || exit 0`. Builds `production`, skips
  `main`, task branches and `sessions`. No preview deploys.
- **Environment variables:** every variable in `env.example` except the two `SQUARE_SANDBOX_*`,
  **Production scope only**, never "All Environments". `DATABASE_URL` logs in as `haul_app`.
  `SESSION_SECRET` is fresh (`openssl rand -base64 48`), never the dev one. Mark the secrets
  sensitive.
- **`NEXT_PUBLIC_*` are baked in at build time:** changing one needs a redeploy.
- **Deploying by hand:** Deployments → `…` → Create Deployment → `production`. The badge must say
  **Production**. If it says Preview, Branch Tracking is wrong: cancel, never promote a preview,
  since it was built without the Production variables.

### 5. Resend

The domain `ohiocityfarm.com` in Resend, with its records in Wix DNS: `resend._domainkey` (TXT),
`send` and `rsend` (CNAMEs), and `_dmarc` only if the domain has none already. They sit on their own
names and leave the farm's own mail (`secureserver.net`) alone. Each row must show Resend's
checkmark. API key: API Keys → Create, Sending access, domain `ohiocityfarm.com`, shown once.

### 6. Smoke test

Sign up through the app first: signing in with an address that has no account sends nothing, by
design. Then sign in with the emailed code, take a Supper Club subscription with a test card, and
check the payment in Square's dashboard and the subscription on the account page.

### 7. DNS: `members.ohiocityfarm.com` — **pending**

Vercel → Settings → Domains → add `members.ohiocityfarm.com` to Production, then add the CNAME
Vercel shows to Wix DNS, host `members`. `SITE_URL` already names it, so sign-in links work as soon
as the domain is green. This is the step that makes production public.

### 8. Square production — **pending, task 1.9 (issue 61)**

First delete every subscription, ledger row and Square-customer link made under sandbox (issue 61's
note), then switch the five Square variables to production and redeploy. The developer app must
belong to the farm's Square account, or the money lands in someone else's (spec open question 18).

## The January cutover

When Phase 2 promotes `main` to `production` with `/promote-production`:

0. **Pin one commit of `main`** for the whole cutover, so a merge in between never ships a schema
   that wasn't migrated: migrate from it and promote it.
1. **Rehearse first.** `pg_dump` production (with its grants: never `--no-acl`). Create `haul_app`
   in the scratch cluster before restoring, or the restore's grants fail. Restore into a scratch
   database, run the pinned commit's migrations against it as the superuser, and smoke-test.
2. **Migrate production** as the superuser from a checkout of the pinned commit:
   `npm run -s db:migrate -- "$OWNER_URL"`. Until step 6 deploys, Phase 1's code runs against
   Phase 2's schema. That's expected: `main`'s migrations add, except `20261112020828_dated_picks.sql`,
   which updates `subscription_options`. Keep the window short.
3. **Mark the menu option type by hand.** `main`'s menus migration adds
   `option_types.menu_texts` false everywhere (`db/migrations/20261112224505_menus.sql:10`):
   `update option_types set menu_texts = true where name = 'Which menu';`
4. **New variables** from `main`'s `env.example`: `CRON_SECRET` and `MENU_EMAIL_WEEKDAY`, before
   the deploy.
5. **The scheduler** that calls the charge run: issue 177.
6. Promote, wait for the deploy, smoke-test.

The same steps serve a move to another host: dump, restore, migrate, point the variables.

## Gotchas met

- **Crunchy's query editor** runs a read-only transaction. Use psql.
- **The wrong database.** If migrations land in `postgres` instead of `haul`, list what's there
  (`\dt public.*`, `\df public.*`, `\dT public.*`) and drop only our objects. That database is
  Crunchy's own. Connected to `postgres`:

```
begin;
drop owned by haul_app;
drop table _migrations, audit_log, ledger, members, option_types, options, products,
  rate_limit_hits, sign_in_codes, subscription_options, subscriptions cascade;
drop function if exists audit_event(text, text, jsonb), audit_event(text, text, jsonb, jsonb), audit_row();
drop domain nonblank_text;
commit;
```

  `drop owned` acts on the connected database only. **Before launch only, while `haul` holds
  nothing anyone needs**, `haul` can be started over from `postgres` with
  `drop database if exists haul with (force)` then `create database haul`. After launch that
  destroys production. The `haul_app` role survives either way, being cluster-wide.
- **A pasted password** goes into whatever transcript holds the paste. Rotate it at once.
- **"You already have a Supper Club subscription"** after a payment means a second submit,
  refused before any charge (`src/signup.ts`).
