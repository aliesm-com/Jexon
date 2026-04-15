/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly S3_BUCKET_NAME?: string;
	readonly AWS_REGION?: string;
	readonly AWS_ACCESS_KEY_ID?: string;
	readonly AWS_SECRET_ACCESS_KEY?: string;
	readonly S3_ENDPOINT?: string;
	readonly S3_FORCE_PATH_STYLE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
