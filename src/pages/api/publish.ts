import type { APIRoute } from 'astro';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ZodError } from 'zod';

import {
	CONTENT_BUNDLE_VERSION,
	type ContentBundle,
	type DraftEntry,
	type FieldDefinition,
	type FieldModule,
	type PublishOptions,
} from '../../lib/content-model';
import { markdownToRichText } from '../../lib/rich-text';
import { publishRequestSchema } from '../../lib/schemas';

interface PublishResult {
	bundle: ContentBundle;
	upload?: {
		bucket: string;
		key: string;
		uri: string;
		url?: string;
	};
}

interface S3UploadContext {
	client: S3Client;
	bucket: string;
	prefix: string;
	publicBaseUrl?: string;
}

interface FileFieldInput {
	fileName?: string;
	mimeType?: string;
	size?: number;
	dataBase64?: string;
	key?: string;
	uri?: string;
	url?: string;
}

export const POST: APIRoute = async ({ request }) => {
	let rawBody: unknown;

	try {
		rawBody = await request.json();
	} catch {
		return jsonResponse({ error: 'Invalid JSON body' }, 400);
	}

	try {
		const payload = publishRequestSchema.parse(rawBody);
		const modules = ensureValidModules(payload.modules);
		const options = payload.options ?? { uploadToS3: false, s3KeyPrefix: 'published' };
		const uploadContext = options.uploadToS3 ? createS3UploadContext(options) : null;
		const entries: ContentBundle['entries'] = [];

		for (const entry of payload.entries) {
			entries.push(await normalizeEntry(entry, modules, uploadContext));
		}

		const bundle: ContentBundle = {
			bundleVersion: CONTENT_BUNDLE_VERSION,
			generatedAt: new Date().toISOString(),
			modules,
			entries,
		};

		const result: PublishResult = { bundle };
		if (uploadContext) {
			result.upload = await uploadBundleToS3(bundle, uploadContext);
		}

		return jsonResponse(result, 200);
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

		return jsonResponse({ error: 'Unknown publish error' }, 500);
	}
};

function ensureValidModules(modules: FieldModule[]): FieldModule[] {
	const uniqueModuleIds = new Set<string>();

	for (const module of modules) {
		if (uniqueModuleIds.has(module.id)) {
			throw new Error(`Duplicate module id detected: ${module.id}`);
		}
		uniqueModuleIds.add(module.id);

		const fieldIds = new Set<string>();
		for (const field of module.fields) {
			if (fieldIds.has(field.id)) {
				throw new Error(`Duplicate field id '${field.id}' in module '${module.id}'`);
			}
			fieldIds.add(field.id);
		}
	}

	return modules;
}

async function normalizeEntry(
	entry: DraftEntry,
	modules: FieldModule[],
	uploadContext: S3UploadContext | null,
): Promise<ContentBundle['entries'][number]> {
	const selectedModule = modules.find((module) => module.id === entry.moduleId);
	if (!selectedModule) {
		throw new Error(`Entry '${entry.id}' references missing module '${entry.moduleId}'`);
	}

	const normalizedValues: Record<string, unknown> = {};

	for (const field of selectedModule.fields) {
		const rawValue = entry.values[field.id];
		normalizedValues[field.id] = await normalizeFieldValue(field, rawValue, entry.id, uploadContext);
	}

	return {
		id: entry.id,
		title: entry.title,
		moduleId: entry.moduleId,
		publishedAt: new Date().toISOString(),
		values: normalizedValues,
	};
}

async function normalizeFieldValue(
	field: FieldDefinition,
	rawValue: unknown,
	entryId: string,
	uploadContext: S3UploadContext | null,
): Promise<unknown> {
	if (isMissing(rawValue)) {
		if (field.required) {
			throw new Error(`Entry '${entryId}' is missing required field '${field.id}'`);
		}
		return null;
	}

	switch (field.type) {
		case 'text':
		case 'textarea': {
			if (typeof rawValue !== 'string') {
				throw new Error(`Field '${field.id}' must be a string`);
			}
			return rawValue.trim();
		}
		case 'url': {
			if (typeof rawValue !== 'string') {
				throw new Error(`Field '${field.id}' must be a URL string`);
			}
			const trimmed = rawValue.trim();
			if (!trimmed) {
				if (field.required) {
					throw new Error(`Field '${field.id}' is required`);
				}
				return null;
			}
			try {
				const parsed = new URL(trimmed);
				return parsed.toString();
			} catch {
				throw new Error(`Field '${field.id}' must be a valid absolute URL`);
			}
		}
		case 'number': {
			const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
			if (!Number.isFinite(value)) {
				throw new Error(`Field '${field.id}' must be a valid number`);
			}
			return value;
		}
		case 'boolean': {
			if (typeof rawValue === 'boolean') {
				return rawValue;
			}
			if (rawValue === 'true') {
				return true;
			}
			if (rawValue === 'false') {
				return false;
			}
			throw new Error(`Field '${field.id}' must be boolean`);
		}
		case 'date': {
			if (typeof rawValue !== 'string') {
				throw new Error(`Field '${field.id}' must be a date string`);
			}
			const trimmed = rawValue.trim();
			const parsed = new Date(trimmed);
			if (Number.isNaN(parsed.getTime())) {
				throw new Error(`Field '${field.id}' must be a valid date`);
			}
			return parsed.toISOString().slice(0, 10);
		}
		case 'richText': {
			if (typeof rawValue !== 'string') {
				throw new Error(`Field '${field.id}' must be Markdown text`);
			}
			return markdownToRichText(rawValue);
		}
		case 'file': {
			return normalizeFileFieldValue(field, rawValue, entryId, uploadContext);
		}
		default: {
			throw new Error(`Unsupported field type for '${field.id}'`);
		}
	}
}

async function normalizeFileFieldValue(
	field: FieldDefinition,
	rawValue: unknown,
	entryId: string,
	uploadContext: S3UploadContext | null,
): Promise<unknown> {
	if (typeof rawValue === 'string') {
		const trimmed = rawValue.trim();
		if (!trimmed) {
			if (field.required) {
				throw new Error(`Field '${field.id}' is required`);
			}
			return null;
		}

		try {
			new URL(trimmed);
			return { url: trimmed };
		} catch {
			throw new Error(`File field '${field.id}' must be a valid URL or a file payload object`);
		}
	}

	if (!rawValue || typeof rawValue !== 'object') {
		throw new Error(`Field '${field.id}' must be a file payload object`);
	}

	const file = rawValue as FileFieldInput;
	const fileName = sanitizeFileName(file.fileName ?? `${field.id}.bin`);
	const mimeType = (file.mimeType || 'application/octet-stream').trim();
	const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : undefined;
	const dataBase64 = typeof file.dataBase64 === 'string' ? file.dataBase64.trim() : '';

	if (!dataBase64) {
		if (file.url || file.key || file.uri) {
			return {
				fileName,
				mimeType,
				size,
				url: file.url,
				key: file.key,
				uri: file.uri,
			};
		}

		if (field.required) {
			throw new Error(`Field '${field.id}' is required`);
		}

		return null;
	}

	const buffer = decodeBase64(dataBase64, field.id);

	if (!uploadContext) {
		return {
			fileName,
			mimeType,
			size: size ?? buffer.length,
			dataBase64,
		};
	}

	const key = buildFileObjectKey(uploadContext.prefix, entryId, field.id, fileName);
	await uploadBuffer(uploadContext, key, buffer, mimeType);

	const result: Record<string, unknown> = {
		fileName,
		mimeType,
		size: size ?? buffer.length,
		key,
		uri: `s3://${uploadContext.bucket}/${key}`,
	};

	const url = resolvePublicUrl(uploadContext.publicBaseUrl, key);
	if (url) {
		result.url = url;
	}

	return result;
}

function isMissing(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true;
	}

	if (typeof value === 'string') {
		return value.trim().length === 0;
	}

	return false;
}

function createS3UploadContext(options: PublishOptions): S3UploadContext {
	const s3 = options.s3 ?? {};
	const bucket = (s3.bucket || import.meta.env.S3_BUCKET_NAME || '').trim();
	const region = (s3.region || import.meta.env.AWS_REGION || '').trim();
	const accessKeyId = (s3.accessKeyId || import.meta.env.AWS_ACCESS_KEY_ID || '').trim();
	const secretAccessKey = (s3.secretAccessKey || import.meta.env.AWS_SECRET_ACCESS_KEY || '').trim();
	const endpoint = (s3.endpoint || import.meta.env.S3_ENDPOINT || '').trim();
	const forcePathStyle = s3.forcePathStyle ?? import.meta.env.S3_FORCE_PATH_STYLE === 'true';
	const publicBaseUrl = normalizePublicBaseUrl(s3.publicBaseUrl);

	if (!bucket || !region || !accessKeyId || !secretAccessKey) {
		throw new Error(
			'S3 settings are incomplete. Required: bucket, region, accessKeyId, secretAccessKey (from request options or env vars).',
		);
	}

	const client = new S3Client({
		region,
		endpoint: endpoint || undefined,
		forcePathStyle,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	return {
		client,
		bucket,
		prefix: normalizeS3Prefix(options.s3KeyPrefix ?? 'published'),
		publicBaseUrl,
	};
}

async function uploadBundleToS3(bundle: ContentBundle, context: S3UploadContext): Promise<NonNullable<PublishResult['upload']>> {
	const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
	const key = buildS3Key(context.prefix, fileName);
	const body = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');

	await uploadBuffer(context, key, body, 'application/json');

	return {
		bucket: context.bucket,
		key,
		uri: `s3://${context.bucket}/${key}`,
		url: resolvePublicUrl(context.publicBaseUrl, key),
	};
}

async function uploadBuffer(context: S3UploadContext, key: string, body: Buffer, contentType: string): Promise<void> {
	await context.client.send(
		new PutObjectCommand({
			Bucket: context.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
}

function buildFileObjectKey(prefix: string, entryId: string, fieldId: string, fileName: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const safeEntry = sanitizeFileName(entryId);
	const safeField = sanitizeFileName(fieldId);
	return buildS3Key(prefix, `assets/${safeEntry}/${safeField}/${stamp}-${fileName}`);
}

function buildS3Key(prefix: string, leaf: string): string {
	const cleanLeaf = leaf.replace(/^\/+|\/+$/g, '');
	if (!prefix) {
		return cleanLeaf;
	}
	return `${prefix}/${cleanLeaf}`;
}

function normalizeS3Prefix(prefix: string): string {
	return prefix.replace(/^\/+|\/+$/g, '').trim();
}

function sanitizeFileName(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');

	return cleaned || 'file.bin';
}

function decodeBase64(input: string, fieldId: string): Buffer {
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

function resolvePublicUrl(publicBaseUrl: string | undefined, key: string): string | undefined {
	if (!publicBaseUrl) {
		return undefined;
	}
	return `${publicBaseUrl}/${key}`;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}
