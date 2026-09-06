# CoasterRank security posture

Last reviewed: 2026-09-06

This document describes the security model and operating assumptions for
CoasterRank. It is a practical posture document, not a compliance attestation
or a claim that the application is free of vulnerabilities.

## System boundaries and trust model

CoasterRank is a Vite/React single-page application backed by Supabase and a
Cloudflare Worker. The browser is an untrusted client. Anything sent to the
browser can be inspected or modified by the user, including the Supabase URL,
the public anon key, route parameters, and form submissions.

The security boundary is enforced at the database and serverless-function
layers:

- The browser uses only public `VITE_` configuration and the Supabase anon key.
  Service-role keys, database URLs, Supabase access tokens, and Telegram
  credentials are never prefixed with `VITE_` and must never be shipped to the
  browser.
- Supabase Row Level Security (RLS), database grants, constraints, and
  security-definer functions protect data and mutation paths. UI checks are
  convenience and defense in depth, not authorization.
- Edge Functions validate their own bearer tokens and authorization. Gateway
  JWT settings are useful defense in depth but are not treated as the sole
  authorization layer.
- The service-role key is a highly trusted server-side credential. It bypasses
  RLS and is used only by controlled Edge Functions, deployment jobs, and
  explicitly documented operations tooling.

## Identity and authorization

- Supabase Auth owns account identity and session tokens.
- Email confirmation is required for submission flows. Submission limits and
  authorization are enforced again by database policies and functions.
- Profiles are not the source of authentication truth. Where identity matters,
  server-side code validates the token subject against Supabase Auth and then
  checks the corresponding profile authorization state.
- Administrative Edge Functions accept either a validated administrator JWT or
  the service-role key for break-glass/operations use. Admin operations reject
  self-targeting and refuse to manage another administrator account.
- Synthetic/test-user access is restricted to explicit markers (the test email
  domain and synthetic metadata). Real users must not be reachable through the
  impersonation flow.
- Public rider pages are opt-in and expose only the deliberately public,
  ranked-list surface. Private and unknown riders are intentionally made
  indistinguishable at the public RPC/Worker boundary.

## Database protections

The database is the authoritative enforcement layer for data integrity and
authorization.

- RLS policies scope profile, ride, submission, and other user-owned data to
  the authenticated user or an administrator as appropriate.
- Security-definer functions set an explicit `search_path` and have narrowly
  scoped grants. Sensitive aggregate functions are service-role-only; public
  board RPCs return aggregate data rather than per-user rows.
- Usernames are constrained to lowercase ASCII handles matching
  `^[a-z0-9_]{3,20}$` and are unique case-insensitively. The migration fails
  closed if existing data is incompatible instead of silently renaming users.
- Submission payloads are constrained at the database boundary and approval
  code uses an explicit allowlist before writing catalog columns. This prevents
  JSON keys from becoming arbitrary column updates or inserts.
- Ranking aggregates exclude administrators and marked synthetic accounts so
  test or operational activity cannot silently influence the public board.
- Trigger-owned history tables and notification functions do not grant clients
  direct write access where a narrowly scoped server-side operation is enough.
- Migrations are applied through the pull-request and post-merge deployment
  workflow. Direct production schema changes are intentionally avoided.

## Edge Functions and server-side code

- Functions validate HTTP methods, bearer tokens, token subjects, and admin
  status in the function itself.
- The `admin-users` function uses the service-role client only after its caller
  has been authenticated as an admin or explicitly presented the service-role
  key. The service-role path is an operations bypass and must be treated as
  equivalent to database-owner access.
- The `assume-identity` function is limited to synthetic users and is not a
  general impersonation facility.
- The ranking recompute function accepts only its documented cron secret,
  service-role credential, or a server-validated admin path, and its database
  aggregates are not public RPCs.
- User-controlled values sent to Telegram are bounded and stripped of line
  breaks. Telegram notifications do not use `parse_mode`, reducing formatting
  and injection surprises. Notifications are informational and never an
  authorization mechanism.
- The Worker adds CSP, HSTS, clickjacking, MIME-sniffing, referrer, and
  permissions headers to its responses. CSP permits only the external font
  origins the application actually uses and keeps scripts same-origin.

## Storage and public content

The avatars bucket is intentionally public because avatar URLs are embedded in
public profiles and crawler previews. A known public object URL can therefore
be fetched anonymously; this is part of the product design, not a private-file
guarantee.

The storage policies still restrict authenticated listing and mutation:

- Users can list only their own UUID-prefixed folder.
- Client uploads, overwrites, and deletes are restricted to the canonical
  `<user-id>/avatar.jpg` path.
- Service-role cleanup is used for administrative account deletion.
- The application does not treat an avatar URL as proof of identity or
  authorization.

Public avatars and public rider pages may be cached by browsers, crawlers, the
Worker, or upstream CDNs for their configured short lifetimes. Removing access
does not guarantee immediate disappearance from caches or from a client that
already downloaded an object.

## Browser and deployment protections

- Only `VITE_` variables enter the client bundle; secret-bearing variables are
  kept in local ignored configuration or hosting/CI secret stores.
- CI runs typechecking, linting, tests, and formatting checks on pull requests.
- GitHub Actions are pinned to reviewed commit SHAs and deployment tooling is
  version-pinned where practical.
- Supabase deployment runs only after changes reach `main`, performs read-only
  compatibility checks before migrations, and deploys migrations/functions as
  one controlled workflow.
- Schema documentation is regenerated automatically from the deployed schema
  and proposed through a dedicated bot branch/PR, keeping generated docs
  reviewable.

## Known accepted risks and tradeoffs

These are conscious product or operational decisions, not controls that should
be mistaken for absent risk:

1. **`main` is currently unprotected.** The former schema-doc workflow pushed
   directly to `main`, and branch protection broke that automation. The current
   workflow keeps generated docs on `bot/schema-docs` and opens/refreshes a PR,
   which makes reinstating branch protection feasible. Until that is enabled,
   the project relies on pull-request procedure, required CI checks, and human
   discipline rather than a GitHub branch rule.
2. **The public board is public.** Aggregate rankings, coaster catalog data,
   and opted-in rider pages are product surfaces. They must not be used for
   private data or sensitive identity decisions.
3. **Avatar URLs are public objects.** This supports sharing and social
   previews, but anyone with a URL can retrieve the image and caches may outlive
   a profile change.
4. **Service-role access is intentionally powerful.** A leaked service-role key
   can bypass RLS and perform broad reads/writes. Reducing this risk depends on
   secret storage, rotation, least use, and not placing the key in client code.
5. **Anti-abuse controls are bounded, not comprehensive.** Auth provider rate
   limits, email confirmation, pending-submission caps, and human review raise
   the cost of abuse but do not prevent determined actors, coordinated reports,
   or denial-of-service traffic.
6. **Short-lived edge and browser caches can serve stale public content.** The
   application accepts a bounded delay for ranking and public-page freshness in
   exchange for lower latency and simpler operations.
7. **The application depends on managed services and third-party delivery.**
   Supabase, Cloudflare, GitHub Actions, npm dependencies, and Telegram remain
   part of the effective supply-chain and availability boundary. Credentials
   and webhook destinations must be rotated if compromise is suspected.

## Operational expectations

- Never commit `.env`, service-role keys, database URLs, Supabase access tokens,
  or webhook secrets.
- Do not run production migrations, data repair scripts, or importer `--apply`
  operations outside the documented PR/runbook process without explicit
  authorization.
- Review security-sensitive changes for both the browser path and the direct
  database/API path. A hidden UI control is not an access control.
- When a credential may have leaked, revoke or rotate it first, then inspect
  relevant logs and affected data. Do not paste the credential into an issue,
  PR, chat, or bug report.
- Report suspected vulnerabilities privately to the project maintainers with
  reproduction steps, affected surface, and any relevant timestamps. Avoid
  including personal data or live credentials in the report.

Security posture should be revisited when authentication, RLS, public sharing,
storage, deployment permissions, or third-party integrations change.
