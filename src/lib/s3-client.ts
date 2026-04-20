import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ContentBundle, PublishOptions } from './content-model';

export interface S3UploadContext {
	client: S3Client;
	bucket: string;
	prefix: string;
	resolvePublicUrl(key: string): string | undefined;
}

type MergedS3Config = {
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	forcePathStyle: boolean;
	publicBaseUrl?: string;
};

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
			'S3 settings are incomplete. Required: bucket, region, accessKeyId, secretAccessKey.',
		);
	}
	return buildUploadContext(merged, options);
}

export async function uploadBytes(
	context: S3UploadContext,
	key: string,
	body: Uint8Array,
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

export async function uploadEditorImageToS3(payload: {
	fileName: string;
	mimeType: string;
	dataBase64: string;
	s3KeyPrefix?: string;
	s3: NonNullable<PublishOptions['s3']>;
}): Promise<{ url: string; key: string; bucket: string; uri: string }> {
	const options: PublishOptions = {
		uploadToS3: false,
		uploadAssetFilesToS3: true,
		s3KeyPrefix: payload.s3KeyPrefix,
		s3: payload.s3,
	};
	const context = createS3UploadContext(options);
	const key = buildEditorImageKey(context.prefix, payload.fileName);
	await uploadBytes(context, key, decodeBase64(payload.dataBase64, 'upload'), payload.mimeType, { aclPublic: true });

	const url = context.resolvePublicUrl(key);
	if (!url) {
		throw new Error(
			'Could not build a public URL. Set Public base URL in S3 settings for non-AWS endpoints (R2, MinIO, etc.).',
		);
	}

	return {
		url,
		key,
		bucket: context.bucket,
		uri: `s3://${context.bucket}/${key}`,
	};
}

export async function uploadBundleToS3(
	bundle: ContentBundle,
	context: S3UploadContext,
): Promise<{ bucket: string; key: string; uri: string; url?: string }> {
	const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
	const key = buildS3Key(context.prefix, fileName);
	const body = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
	await uploadBytes(context, key, body, 'application/json');
	return {
		bucket: context.bucket,
		key,
		uri: `s3://${context.bucket}/${key}`,
		url: context.resolvePublicUrl(key),
	};
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

export function decodeBase64(input: string, fieldId: string): Uint8Array {
	const normalized = input.includes(',') ? input.split(',').pop() ?? '' : input;
	const compact = normalized.replace(/\s+/g, '');
	if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
		throw new Error(`Field '${fieldId}' has invalid base64 content`);
	}

	try {
		const binary = atob(compact);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		throw new Error(`Field '${fieldId}' has invalid base64 content`);
	}
}

function mergeS3Options(options: PublishOptions): MergedS3Config | null {
	const s3 = options.s3 ?? {};
	const bucket = (s3.bucket || '').trim();
	const region = (s3.region || '').trim();
	const accessKeyId = (s3.accessKeyId || '').trim();
	const secretAccessKey = (s3.secretAccessKey || '').trim();
	const endpoint = (s3.endpoint || '').trim();
	const forcePathStyle = Boolean(s3.forcePathStyle);
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

function buildUploadContext(merged: MergedS3Config, options: PublishOptions): S3UploadContext {
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
		},
	};
}

function normalizePublicBaseUrl(value: string | undefined): string | undefined {
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
