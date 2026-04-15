export const MODULE_SCHEMA_VERSION = 'module-1' as const;
export const RICH_TEXT_VERSION = 'rtf-1' as const;
export const CONTENT_BUNDLE_VERSION = 'bundle-1' as const;

export const FIELD_TYPES = [
	'text',
	'textarea',
	'url',
	'number',
	'boolean',
	'date',
	'richText',
	'file',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDefinition {
	id: string;
	label: string;
	type: FieldType;
	required?: boolean;
	helpText?: string;
}

export interface FieldModule {
	schemaVersion: typeof MODULE_SCHEMA_VERSION;
	id: string;
	name: string;
	description?: string;
	fields: FieldDefinition[];
}

export interface DraftEntry {
	id: string;
	moduleId: string;
	title: string;
	values: Record<string, unknown>;
}

export interface RichTextDocument {
	type: 'doc';
	version: typeof RICH_TEXT_VERSION;
	blocks: RichBlock[];
}

export type RichBlock =
	| {
			type: 'paragraph';
			children: RichInline[];
	  }
	| {
			type: 'heading';
			level: number;
			children: RichInline[];
	  }
	| {
			type: 'list';
			ordered: boolean;
			start?: number;
			items: Array<{ children: RichInline[] }>;
	  }
	| {
			type: 'quote';
			children: RichInline[];
	  }
	| {
			type: 'code';
			language?: string;
			text: string;
	  }
	| {
			type: 'divider';
	  };

export type RichInline =
	| {
			type: 'text';
			text: string;
			marks?: Array<'bold' | 'italic' | 'strike' | 'code'>;
	  }
	| {
			type: 'link';
			href: string;
			title?: string;
			children: RichInline[];
	  }
	| {
			type: 'break';
	  };

export interface PublishedEntry {
	id: string;
	title: string;
	moduleId: string;
	publishedAt: string;
	values: Record<string, unknown>;
}

export interface ContentBundle {
	bundleVersion: typeof CONTENT_BUNDLE_VERSION;
	generatedAt: string;
	modules: FieldModule[];
	entries: PublishedEntry[];
}

export interface PublishOptions {
	uploadToS3?: boolean;
	s3KeyPrefix?: string;
	s3?: {
		bucket?: string;
		region?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
		endpoint?: string;
		forcePathStyle?: boolean;
		publicBaseUrl?: string;
	};
}
