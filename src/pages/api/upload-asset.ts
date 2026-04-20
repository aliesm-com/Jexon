import type { APIRoute } from 'astro';
import { ZodError } from 'zod';

import type { PublishOptions } from '../../lib/content-model';
import { uploadAssetRequestSchema } from '../../lib/schemas';
import {
	buildEditorImageKey,
	createS3UploadContext,
	decodeBase64,
	uploadBuffer,
} from '../../lib/s3-server';

export const POST: APIRoute = async ({ request }) => {
	let rawBody: unknown;

	try {
		rawBody = await request.json();
	} catch {
		return jsonResponse({ error: 'Invalid JSON body' }, 400);
	}

	try {
		const parsed = uploadAssetRequestSchema.parse(rawBody);
		const publishOpts: PublishOptions = {
			uploadToS3: false,
			uploadAssetFilesToS3: true,
			s3KeyPrefix: parsed.options?.s3KeyPrefix ?? 'published',
			s3: parsed.options?.s3,
		};

		const context = createS3UploadContext(publishOpts);
		const buffer = decodeBase64(parsed.dataBase64, 'upload');
		const key = buildEditorImageKey(context.prefix, parsed.fileName);
		await uploadBuffer(context, key, buffer, parsed.mimeType, { aclPublic: true });

		const url = context.resolvePublicUrl(key);
		if (!url) {
			return jsonResponse(
				{
					error:
						'Could not build a public URL. Set Public base URL in S3 settings for non-AWS endpoints (R2, MinIO, etc.).',
				},
				400,
			);
		}

		return jsonResponse({ url, key, bucket: context.bucket }, 200);
	} catch (error) {
		if (error instanceof ZodError) {
			return jsonResponse(
				{
					error: 'Validation failed',
					details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
				},
				400,
			);
		}

		if (error instanceof Error) {
			return jsonResponse({ error: error.message }, 400);
		}

		return jsonResponse({ error: 'Upload failed' }, 500);
	}
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}
