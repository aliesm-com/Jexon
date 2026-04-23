# Jexon Content Composer

![Jexon logo](public/favicon.svg)

Jexon is an Astro-based content composer for building reusable field modules, creating entries from those modules, converting rich text to normalized JSON, and publishing final bundles.

## Features

- Modular field definitions (`text`, `textarea`, `url`, `number`, `boolean`, `date`, `richText`)
- Module import/export with versioned JSON format (`module-1`)
- Entry creation based on saved modules
- Markdown normalization into a stable rich text document format (`rtf-1`)
- Final publishable bundle generation (`bundle-1`)
- Optional direct upload of published JSON to S3

## Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:4321`.

## Deploy to GitHub Pages

This repository includes a lightweight GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

Steps:

1. Push your code to the `main` branch.
2. In GitHub, go to **Settings -> Pages**.
3. Set **Source** to **GitHub Actions**.
4. The workflow deploys automatically on each push to `main`.

Important:

- GitHub Pages is static hosting and does not let you manage Nginx directly.
- This workflow builds Astro in static mode only for CI deploys; local/dev behavior stays unchanged.

## S3 Settings (Browser)

The app can upload images/files and final bundle JSON directly to S3 from the browser.

Configure these values in the app UI (Modules step -> S3 Settings):

- Bucket
- Region
- Access Key ID
- Secret Access Key
- Optional endpoint (for MinIO, Cloudflare R2, and similar)
- Optional public base URL

Because this mode runs in frontend, S3 credentials are stored in local browser storage for the user session workflow.

## Final Output Shape

Published output follows this envelope:

```json
{
  "bundleVersion": "bundle-1",
  "generatedAt": "2026-04-14T12:00:00.000Z",
  "modules": [],
  "entries": []
}
```

Each `richText` field is converted to a normalized JSON document so it can be rendered consistently later.
