# Jexon Content Composer

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

## S3 Environment Variables

If you want publish output uploaded to S3, set these variables:

```bash
S3_BUCKET_NAME=your-bucket
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_ENDPOINT=
S3_FORCE_PATH_STYLE=false
```

`S3_ENDPOINT` is optional and useful for S3-compatible providers (for example MinIO or Cloudflare R2).

## APIs

### `POST /api/normalize-richtext`

Input:

```json
{ "markdown": "# Hello\n[site](https://example.com)" }
```

Output: normalized rich text document (`rtf-1`).

### `POST /api/publish`

Input:

- `modules`: array of module definitions
- `entries`: array of draft entries
- `options.uploadToS3`: when `true`, uploads final JSON to S3
- `options.s3KeyPrefix`: key prefix for uploaded file in S3

Output:

- `bundle`: final publishable JSON bundle
- `upload`: S3 upload metadata (when upload is enabled)

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
