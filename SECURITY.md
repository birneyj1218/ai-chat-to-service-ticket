# Security

## Reporting a problem
Please report security issues privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue.

## How secrets are handled
- No secrets live in this repository. `.env.example` holds placeholders only; `.env` is git-ignored.
- API keys for the LLM, Odoo and Chatwoot are stored as n8n credentials and referenced in `n8n/workflow.json` by name only.
- Every push and pull request runs [gitleaks](https://github.com/gitleaks/gitleaks) (`.github/workflows/secret-scan.yml`). Run `npm run scan` locally before pushing.

## Deployment notes
- Give the bot its own Odoo user that can create tasks in the service-desk project and nothing else.
- Treat the n8n webhook path as a secret: use a long random string, and only expose it through your reverse proxy.
- Keep the stack behind a TLS reverse proxy with request rate limiting; the compose file binds ports to 127.0.0.1 only.
