import { z } from 'zod';

import { FIELD_TYPES, LIST_ITEM_FIELD_TYPES, MODULE_SCHEMA_VERSION } from './content-model';

const fieldTypeSchema = z.enum(FIELD_TYPES);
const listItemFieldTypeSchema = z.enum(LIST_ITEM_FIELD_TYPES);

const fieldIdSchema = z
	.string()
	.min(2, 'field.id must be at least 2 characters')
	.regex(/^[a-zA-Z0-9_-]+$/, 'field.id can only include letters, numbers, _ and -');

const listItemFieldSchema = z.object({
	id: fieldIdSchema,
	label: z.string().min(1, 'field.label is required'),
	type: listItemFieldTypeSchema,
	required: z.boolean().optional().default(false),
	helpText: z.string().max(220).optional(),
});

export const fieldDefinitionSchema = z
	.object({
		id: fieldIdSchema,
		label: z.string().min(1, 'field.label is required'),
		type: fieldTypeSchema,
		required: z.boolean().optional().default(false),
		helpText: z.string().max(220).optional(),
		itemFields: z.array(listItemFieldSchema).optional(),
	})
	.superRefine((field, ctx) => {
		if (field.type === 'list' && (!field.itemFields || field.itemFields.length === 0)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `list field '${field.id}' requires at least one itemFields entry`,
				path: ['itemFields'],
			});
		}
		if (field.type !== 'list' && field.itemFields) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `only list fields can include itemFields`,
				path: ['itemFields'],
			});
		}
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
		uploadAssetFilesToS3: z.boolean().optional().default(true),
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
	.default({ uploadToS3: false, uploadAssetFilesToS3: true, s3KeyPrefix: 'published' });

export const publishRequestSchema = z.object({
	modules: z.array(fieldModuleSchema).min(1, 'At least one module is required'),
	entries: z.array(draftEntrySchema).default([]),
	options: publishOptionsSchema.optional().default({ uploadToS3: false, s3KeyPrefix: 'published' }),
});

export const uploadAssetRequestSchema = z.object({
	fileName: z.string().min(1, 'fileName is required'),
	mimeType: z.string().min(1, 'mimeType is required'),
	dataBase64: z.string().min(1, 'dataBase64 is required'),
	options: z
		.object({
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
		.optional(),
});
