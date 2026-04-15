import { z } from 'zod';

import { FIELD_TYPES, MODULE_SCHEMA_VERSION } from './content-model';

const fieldTypeSchema = z.enum(FIELD_TYPES);

export const fieldDefinitionSchema = z.object({
	id: z
		.string()
		.min(2, 'field.id must be at least 2 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'field.id can only include letters, numbers, _ and -'),
	label: z.string().min(1, 'field.label is required'),
	type: fieldTypeSchema,
	required: z.boolean().optional().default(false),
	helpText: z.string().max(220).optional(),
});

export const fieldModuleSchema = z.object({
	schemaVersion: z.literal(MODULE_SCHEMA_VERSION),
	id: z
		.string()
		.min(2, 'module.id must be at least 2 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'module.id can only include letters, numbers, _ and -'),
	name: z.string().min(2, 'module.name must be at least 2 characters'),
	description: z.string().max(300).optional(),
	fields: z.array(fieldDefinitionSchema).min(1, 'module.fields must include at least 1 item'),
});

export const draftEntrySchema = z.object({
	id: z.string().min(2, 'entry.id must be at least 2 characters'),
	moduleId: z.string().min(2, 'entry.moduleId is required'),
	title: z.string().min(1, 'entry.title is required'),
	values: z.record(z.string(), z.unknown()),
});

export const publishOptionsSchema = z
	.object({
		uploadToS3: z.boolean().optional().default(false),
		s3KeyPrefix: z.string().optional(),
		s3: z
			.object({
				bucket: z.string().optional(),
				region: z.string().optional(),
				accessKeyId: z.string().optional(),
				secretAccessKey: z.string().optional(),
				endpoint: z.string().optional(),
				forcePathStyle: z.boolean().optional(),
				publicBaseUrl: z.string().optional(),
			})
			.optional(),
	})
	.default({ uploadToS3: false, s3KeyPrefix: 'published' });

export const publishRequestSchema = z.object({
	modules: z.array(fieldModuleSchema).min(1, 'At least one module is required'),
	entries: z.array(draftEntrySchema).default([]),
	options: publishOptionsSchema.optional().default({ uploadToS3: false, s3KeyPrefix: 'published' }),
});
