# Frontend notes

For local development, Vite proxies `/api` to the Worker on port 8787.
For production, the API Worker serves the built frontend from `apps/web/dist` using Cloudflare Workers Static Assets. This keeps API calls and session cookies on the same origin.
