# Security and privacy

Sentido is designed to hold material that may be intimate, identifying, or
relationally sensitive. A public repository is suitable for the protocol and
fictional examples, not for a living construct's Book.

## Never commit

- `.env` or API keys;
- stored conversations under `data/sessions/`;
- pending proposals from a live instance;
- private journals, transcripts, or unpublished writing;
- usage records that can expose behaviour or spending patterns;
- access tokens or tunnel credentials.

If a secret has ever been committed, remove it from active use immediately and
rotate it. Making the repository private does not invalidate copies or forks.

## Network boundary

The reference server listens on `127.0.0.1` by default. Do not expose its port
directly to the internet. Local-network use requires a strong access token and
an appropriate firewall. Remote use requires authenticated transport designed
for that purpose.

## Reporting vulnerabilities

Open a GitHub security advisory when available. Do not place private continuity
material, credentials, or exploit details in a public issue.
