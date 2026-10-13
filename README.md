# Smart Finance Tracker

A starter full-stack personal/business finance tracker for Cloudflare.

## Stack
- React + TypeScript + Vite frontend
- Cloudflare Workers + Hono API
- Cloudflare D1 database
- Resend for verification and password-reset emails
- GitHub Actions CI

## Local setup
Requirements: Node.js 20+ and npm.

1. `npm install`
2. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and add your Resend API key.
3. Run `npm run db:migrate:local`
4. Terminal 1: `npm run dev:api`
5. Terminal 2: `npm run dev:web`

The Vite dev server proxies `/api` to the local Worker on port 8787.

## Cloudflare setup
1. `npx wrangler login`
2. Create a D1 database: `npx wrangler d1 create smart-finance-db`
3. Put the returned database ID in `apps/api/wrangler.jsonc`.
4. Apply migration: `npm run db:migrate:remote`
5. Set Worker secrets (use a verified sender domain in Resend for production):
   - `npx wrangler secret put RESEND_API_KEY --config apps/api/wrangler.jsonc`
   - `npx wrangler secret put APP_BASE_URL --config apps/api/wrangler.jsonc`
   - `npx wrangler secret put COOKIE_SECURE --config apps/api/wrangler.jsonc` (value `true` in production)
6. Build and deploy frontend + API together: `npm run deploy`
7. Deploy frontend: `npm run deploy:web`

Before step 7, set the frontend's API base/proxy for production deployment as described in `apps/web/README.md`.

## Included starter features
- Sign up, sign in, email verification, forgot/reset password
- Server-side sessions with HttpOnly cookies
- Personal/business workspace created at signup
- Transactions and budget create/list endpoints
- Responsive frontend for auth and finance dashboard
- D1 migration and basic CI workflow

## Security / production caveats
This is a starter project, not a security-audited financial product. Email delivery requires a configured Resend account and verified sender. Before real users, add robust rate limiting/abuse controls, CSRF review, audit logging, tested backups, monitoring, and a security review. Do not use it for real financial data until these steps are complete.
