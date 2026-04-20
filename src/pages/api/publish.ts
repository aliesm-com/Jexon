import type { APIRoute } from 'astro';
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
import type { S3UploadContext } from '../../lib/s3-server';
import {
	buildFileObjectKey,
	buildS3Key,
	createS3UploadContext,
	createS3UploadContextOrNull,
	decodeBase64,
	sanitizeFileName,
	uploadBuffer,
} from '../../lib/s3-server';

interface PublishResult {
	bundle: ContentBundle;
	upload?: {
		bucket: string;
		key: string;
		uri: string;
		url?: string;
	};
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
		const options = payload.options ?? { uploadToS3: false, uploadAssetFilesToS3: true, s3KeyPrefix: 'published' };
		const uploadAssetFilesToS3 = options.uploadAssetFilesToS3 !== false;
		const assetUploadContext = uploadAssetFilesToS3 ? createS3UploadContextOrNull(options) : null;
		const bundleUploadContext = options.uploadToS3 ? createS3UploadContext(options) : null;
		const entries: ContentBundle['entries'] = [];

		for (const entry of payload.entries) {
			entries.push(await normalizeEntry(entry, modules, assetUploadContext, uploadAssetFilesToS3));
		}

		const bundle: ContentBundle = {
			bundleVersion: CONTENT_BUNDLE_VERSION,
			generatedAt: new Date().toISOString(),
			modules,
			entries,
		};

		const result: PublishResult = { bundle };
		if (bundleUploadContext) {
			result.upload = await uploadBundleToS3(bundle, bundleUploadContext);
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
	assetUploadContext: S3UploadContext | null,
	uploadAssetFilesToS3: boolean,
): Promise<ContentBundle['entries'][number]> {
	const selectedModule = modules.find((module) => module.id === entry.moduleId);
	if (!selectedModule) {
		throw new Error(`Entry '${entry.id}' references missing module '${entry.moduleId}'`);
	}

	const normalizedValues: Record<string, unknown> = {};

	for (const field of selectedModule.fields) {
		const rawValue = entry.values[field.id];
		normalizedValues[field.id] = await normalizeFieldValue(
			field,
			rawValue,
			entry.id,
			assetUploadContext,
			uploadAssetFilesToS3,
		);
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
	assetUploadContext: S3UploadContext | null,
	uploadAssetFilesToS3: boolean,
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
			return normalizeFileFieldValue(field, rawValue, entryId, assetUploadContext, uploadAssetFilesToS3);
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
	uploadAssetFilesToS3: boolean,
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

	if (uploadAssetFilesToS3 && !uploadContext) {
		throw new Error(
			`Field '${field.id}' requires S3 settings (bucket, region, access keys) to upload files. Configure them in Settings or environment variables.`,
		);
	}

	if (!uploadContext) {
		return {
			fileName,
			mimeType,
			size: size ?? buffer.length,
			dataBase64,
		};
	}

	const key = buildFileObjectKey(uploadContext.prefix, entryId, field.id, fileName);
	await uploadBuffer(uploadContext, key, buffer, mimeType, { aclPublic: true });

	const result: Record<string, unknown> = {
		fileName,
		mimeType,
		size: size ?? buffer.length,
		key,
		uri: `s3://${uploadContext.bucket}/${key}`,
	};

	const url = uploadContext.resolvePublicUrl(key);
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

async function uploadBundleToS3(bundle: ContentBundle, context: S3UploadContext): Promise<NonNullable<PublishResult['upload']>> {
	const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
	const key = buildS3Key(context.prefix, fileName);
	const body = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');

	await uploadBuffer(context, key, body, 'application/json');

	return {
		bucket: context.bucket,
		key,
		uri: `s3://${context.bucket}/${key}`,
		url: context.resolvePublicUrl(key),
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}
