import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { PublishOptions } from './content-model';

export interface S3UploadContext {
	client: S3Client;
	bucket: string;
	prefix: string;
	resolvePublicUrl(key: string): string | undefined;
}

export type MergedS3Config = {
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	forcePathStyle: boolean;
	publicBaseUrl?: string;
};

export function mergeS3Options(options: PublishOptions): MergedS3Config | null {
	const s3 = options.s3 ?? {};
	const bucket = (s3.bucket || import.meta.env.S3_BUCKET_NAME || '').trim();
	const region = (s3.region || import.meta.env.AWS_REGION || '').trim();
	const accessKeyId = (s3.accessKeyId || import.meta.env.AWS_ACCESS_KEY_ID || '').trim();
	const secretAccessKey = (s3.secretAccessKey || import.meta.env.AWS_SECRET_ACCESS_KEY || '').trim();
	const endpoint = (s3.endpoint || import.meta.env.S3_ENDPOINT || '').trim();
	const forcePathStyle = s3.forcePathStyle ?? import.meta.env.S3_FORCE_PATH_STYLE === 'true';
	let publicBaseUrl: string | undefined;
	if (s3.publicBaseUrl?.trim()) {
		publicBaseUrl = normalizePublicBaseUrl(s3.publicBaseUrl);
	}

	if (!bucket || !region || !accessKeyId || !secretAccessKey) {
		return null;
	}

	return {
		bucket,
		region,
		accessKeyId,
		secretAccessKey,
		endpoint,
		forcePathStyle,
		publicBaseUrl,
	};
}

export function publicUrlForS3Object(merged: MergedS3Config, key: string): string | undefined {
	const base = merged.publicBaseUrl?.trim().replace(/\/+$/g, '');
	if (base) {
		try {
			new URL(base);
			return `${base}/${key}`;
		} catch {
			return undefined;
		}
	}

	if (merged.endpoint.trim()) {
		return undefined;
	}

	return `https://${merged.bucket}.s3.${merged.region}.amazonaws.com/${key}`;
}

export function buildUploadContext(merged: MergedS3Config, options: PublishOptions): S3UploadContext {
	const client = new S3Client({
		region: merged.region,
		endpoint: merged.endpoint || undefined,
		forcePathStyle: merged.forcePathStyle,
		credentials: {
			accessKeyId: merged.accessKeyId,
			secretAccessKey: merged.secretAccessKey,
		},
	});

	const prefix = normalizeS3Prefix(options.s3KeyPrefix ?? 'published');

	return {
		client,
		bucket: merged.bucket,
		prefix,
		resolvePublicUrl(key: string) {
			return publicUrlForS3Object(merged, key);
		},
	};
}

export function createS3UploadContextOrNull(options: PublishOptions): S3UploadContext | null {
	const merged = mergeS3Options(options);
	if (!merged) {
		return null;
	}
	return buildUploadContext(merged, options);
}

export function createS3UploadContext(options: PublishOptions): S3UploadContext {
	const merged = mergeS3Options(options);
	if (!merged) {
		throw new Error(
			'S3 settings are incomplete. Required: bucket, region, accessKeyId, secretAccessKey (from request options or env vars).',
		);
	}
	return buildUploadContext(merged, options);
}

export async function uploadBuffer(
	context: S3UploadContext,
	key: string,
	body: Buffer,
	contentType: string,
	opts?: { aclPublic?: boolean },
): Promise<void> {
	await context.client.send(
		new PutObjectCommand({
			Bucket: context.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
			...(opts?.aclPublic
				? {
						ACL: 'public-read' as const,
						CacheControl: 'max-age=31536000,public',
					}
				: {}),
		}),
	);
}

export function buildFileObjectKey(prefix: string, entryId: string, fieldId: string, fileName: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const safeEntry = sanitizeFileName(entryId);
	const safeField = sanitizeFileName(fieldId);
	return buildS3Key(prefix, `assets/${safeEntry}/${safeField}/${stamp}-${fileName}`);
}

export function buildEditorImageKey(prefix: string, fileName: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return buildS3Key(prefix, `assets/editor/${stamp}-${sanitizeFileName(fileName)}`);
}

export function buildS3Key(prefix: string, leaf: string): string {
	const cleanLeaf = leaf.replace(/^\/+|\/+$/g, '');
	if (!prefix) {
		return cleanLeaf;
	}
	return `${prefix}/${cleanLeaf}`;
}

export function normalizeS3Prefix(prefix: string): string {
	return prefix.replace(/^\/+|\/+$/g, '').trim();
}

export function sanitizeFileName(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');

	return cleaned || 'file.bin';
}

export function decodeBase64(input: string, fieldId: string): Buffer {
	const normalized = input.includes(',') ? input.split(',').pop() ?? '' : input;
	const compact = normalized.replace(/\s+/g, '');
	if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
		throw new Error(`Field '${fieldId}' has invalid base64 content`);
	}

	try {
		return Buffer.from(compact, 'base64');
	} catch {
		throw new Error(`Field '${fieldId}' has invalid base64 content`);
	}
}

export function normalizePublicBaseUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim().replace(/\/+$/g, '');
	if (!trimmed) {
		return undefined;
	}

	try {
		new URL(trimmed);
		return trimmed;
	} catch {
		throw new Error('options.s3.publicBaseUrl must be a valid absolute URL');
	}
}
