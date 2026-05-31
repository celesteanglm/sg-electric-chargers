# Contributing

Thanks for helping improve BoCharge. This project is a small production web app, so changes should stay scoped and easy to verify.

## Local Setup

Use Node 22, or any version that satisfies the `engines` field in `package.json`.

```bash
npm install
cp .env.example .env
npm run dev
```

The app works without API keys by using `public/data/sample-chargers.json`. Add `LTA_ACCOUNT_KEY` to `.env` only if you need to test the live LTA feed.

## Checks

Before opening a pull request, run:

```bash
npm run check
```

This runs the production dependency audit and the Vite build.

## Pull Requests

- Keep pull requests focused on one behavior change or cleanup.
- Do not commit `.env`, credentials, local screenshots, `dist`, or `node_modules`.
- Explain user-visible changes and any production config changes.
- Include screenshots for UI changes when helpful.
- For data-source changes, document which source was used and whether credentials are required.

## Data And Credentials

Keep API keys server-side. Never add LTA, OneMap, analytics, or deployment credentials to client-side `VITE_` variables unless the value is intentionally public.

If you update generated sample data, make sure the update complies with the source terms listed in `NOTICE.md`.
