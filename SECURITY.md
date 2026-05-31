# Security Policy

## Supported Versions

Security fixes are handled on the current `main` branch.

## Reporting A Vulnerability

Please do not open a public issue for suspected vulnerabilities, exposed credentials, or abuse paths.

Report security concerns by emailing `celeste@agents.world` with:

- A concise description of the issue.
- Steps to reproduce, if applicable.
- The affected route, file, API, or deployment setting.
- Whether any credential, token, or user data may be exposed.

## Credential Handling

Production deployments should keep these values server-side:

- `LTA_ACCOUNT_KEY`
- `ONEMAP_API_TOKEN`
- `ONEMAP_EMAIL`
- `ONEMAP_PASSWORD`

The client should only receive intentionally public configuration such as an optional Google Analytics measurement ID.
