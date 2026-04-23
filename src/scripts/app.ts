import {
	CONTENT_BUNDLE_VERSION,
	FIELD_TYPES,
	MODULE_SCHEMA_VERSION,
	type ContentBundle,
	type DraftEntry,
	type FieldDefinition,
	type FieldModule,
	type PublishOptions,
} from '../lib/content-model';
import { markdownToRichText } from '../lib/rich-text';
import {
	buildFileObjectKey,
	createS3UploadContext,
	createS3UploadContextOrNull,
	decodeBase64,
	sanitizeFileName,
	uploadBundleToS3,
	uploadBytes,
	type S3UploadContext,
} from '../lib/s3-client';

import { destroyAllRichEditors, mountRichTextEditors } from './rich-text-editor';

const WORKSPACE_EXPORT_VERSION = 'jexon-workspace-1';
const MODULE_EXPORT_WRAP_VERSION = 'jexon-export-1';

const STORAGE_MODULES_KEY = 'jexon.modules.v1';
const STORAGE_ENTRIES_KEY = 'jexon.entries.v1';
const STORAGE_S3_SETTINGS_KEY = 'jexon.s3.settings.v1';
const STORAGE_THEME_KEY = 'jexon.theme.v1';
const STORAGE_WIZARD_STEP_KEY = 'jexon.wizard.step.v1';
const STORAGE_START_MODE_KEY = 'jexon.startMode.v1';
const STORAGE_LANG_KEY = 'jexon.lang.v1';
const NETWORK_REQUIRED_MESSAGE = 'این عملیات نیاز به اینترنت دارد.';

type SupportedLang = 'en' | 'fr' | 'es' | 'ar' | 'fa';

interface StoredS3Settings {
	bucket?: string;
	region?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	endpoint?: string;
	publicBaseUrl?: string;
	forcePathStyle?: boolean;
	uploadAssetFilesToS3?: boolean;
}

type NoticeType = 'ok' | 'error' | 'info';

type FieldPresetId =
	| 'blogPost'
	| 'seo'
	| 'product'
	| 'faq'
	| 'podcast'
	| 'landingPage'
	| 'portfolio'
	| 'newsArticle';

interface FieldPresetTemplate {
	id: FieldPresetId;
	fieldId: string;
	label: string;
	type: FieldDefinition['type'];
	required?: boolean;
	helpText?: string;
}

const FIELD_PRESET_TEMPLATES: ReadonlyArray<FieldPresetTemplate> = [
	{ id: 'blogPost', fieldId: 'title', label: 'Title', type: 'text', required: true },
	{ id: 'blogPost', fieldId: 'slug', label: 'Slug', type: 'text', required: true, helpText: 'URL-friendly slug' },
	{ id: 'blogPost', fieldId: 'excerpt', label: 'Excerpt', type: 'textarea' },
	{ id: 'blogPost', fieldId: 'content', label: 'Content', type: 'richText', required: true },
	{ id: 'blogPost', fieldId: 'author', label: 'Author', type: 'text' },
	{ id: 'blogPost', fieldId: 'published_at', label: 'Published At', type: 'date' },
	{ id: 'blogPost', fieldId: 'cover_image', label: 'Cover Image', type: 'file' },

	{ id: 'seo', fieldId: 'seo_title', label: 'SEO Title', type: 'text' },
	{ id: 'seo', fieldId: 'seo_description', label: 'SEO Description', type: 'textarea' },
	{ id: 'seo', fieldId: 'canonical_url', label: 'Canonical URL', type: 'url' },
	{ id: 'seo', fieldId: 'og_image', label: 'OpenGraph Image', type: 'file' },
	{ id: 'seo', fieldId: 'indexable', label: 'Indexable', type: 'boolean' },

	{ id: 'product', fieldId: 'product_name', label: 'Product Name', type: 'text', required: true },
	{ id: 'product', fieldId: 'price', label: 'Price', type: 'number', required: true },
	{ id: 'product', fieldId: 'currency', label: 'Currency', type: 'text' },
	{ id: 'product', fieldId: 'description', label: 'Description', type: 'textarea' },
	{ id: 'product', fieldId: 'in_stock', label: 'In Stock', type: 'boolean' },
	{ id: 'product', fieldId: 'product_image', label: 'Product Image', type: 'file' },

	{ id: 'faq', fieldId: 'question', label: 'Question', type: 'text', required: true },
	{ id: 'faq', fieldId: 'answer', label: 'Answer', type: 'richText', required: true },
	{ id: 'faq', fieldId: 'category', label: 'Category', type: 'text' },

	{ id: 'podcast', fieldId: 'episode_title', label: 'Episode Title', type: 'text', required: true },
	{ id: 'podcast', fieldId: 'episode_number', label: 'Episode Number', type: 'number' },
	{ id: 'podcast', fieldId: 'show_name', label: 'Show Name', type: 'text', required: true },
	{ id: 'podcast', fieldId: 'host', label: 'Host', type: 'text' },
	{ id: 'podcast', fieldId: 'guest', label: 'Guest', type: 'text' },
	{ id: 'podcast', fieldId: 'summary', label: 'Summary', type: 'textarea' },
	{ id: 'podcast', fieldId: 'show_notes', label: 'Show Notes', type: 'richText' },
	{ id: 'podcast', fieldId: 'audio_file', label: 'Audio File', type: 'file', required: true },
	{ id: 'podcast', fieldId: 'cover_art', label: 'Cover Art', type: 'file' },
	{ id: 'podcast', fieldId: 'duration_minutes', label: 'Duration (minutes)', type: 'number' },
	{ id: 'podcast', fieldId: 'published_at', label: 'Published At', type: 'date' },

	{ id: 'landingPage', fieldId: 'headline', label: 'Headline', type: 'text', required: true },
	{ id: 'landingPage', fieldId: 'subheadline', label: 'Subheadline', type: 'textarea' },
	{ id: 'landingPage', fieldId: 'hero_image', label: 'Hero Image', type: 'file' },
	{ id: 'landingPage', fieldId: 'primary_cta_label', label: 'Primary CTA Label', type: 'text' },
	{ id: 'landingPage', fieldId: 'primary_cta_url', label: 'Primary CTA URL', type: 'url' },
	{ id: 'landingPage', fieldId: 'features', label: 'Features', type: 'richText' },
	{ id: 'landingPage', fieldId: 'testimonials', label: 'Testimonials', type: 'richText' },

	{ id: 'portfolio', fieldId: 'project_title', label: 'Project Title', type: 'text', required: true },
	{ id: 'portfolio', fieldId: 'slug', label: 'Slug', type: 'text', required: true },
	{ id: 'portfolio', fieldId: 'summary', label: 'Summary', type: 'textarea' },
	{ id: 'portfolio', fieldId: 'description', label: 'Description', type: 'richText' },
	{ id: 'portfolio', fieldId: 'thumbnail', label: 'Thumbnail', type: 'file' },
	{ id: 'portfolio', fieldId: 'project_url', label: 'Project URL', type: 'url' },
	{ id: 'portfolio', fieldId: 'repository_url', label: 'Repository URL', type: 'url' },
	{ id: 'portfolio', fieldId: 'published_at', label: 'Published At', type: 'date' },

	{ id: 'newsArticle', fieldId: 'headline', label: 'Headline', type: 'text', required: true },
	{ id: 'newsArticle', fieldId: 'slug', label: 'Slug', type: 'text', required: true },
	{ id: 'newsArticle', fieldId: 'deck', label: 'Deck', type: 'textarea' },
	{ id: 'newsArticle', fieldId: 'body', label: 'Body', type: 'richText', required: true },
	{ id: 'newsArticle', fieldId: 'author', label: 'Author', type: 'text' },
	{ id: 'newsArticle', fieldId: 'source_url', label: 'Source URL', type: 'url' },
	{ id: 'newsArticle', fieldId: 'featured_image', label: 'Featured Image', type: 'file' },
	{ id: 'newsArticle', fieldId: 'published_at', label: 'Published At', type: 'date' },
];

const moduleIdInput = byId<HTMLInputElement>('module-id');
const moduleNameInput = byId<HTMLInputElement>('module-name');
const moduleDescriptionInput = byId<HTMLInputElement>('module-description');
const fieldIdInput = byId<HTMLInputElement>('field-id');
const fieldLabelInput = byId<HTMLInputElement>('field-label');
const fieldTypeInput = byId<HTMLSelectElement>('field-type');
const fieldHelpInput = byId<HTMLInputElement>('field-help');
const fieldRequiredInput = byId<HTMLInputElement>('field-required');
const fieldPresetList = byId<HTMLDivElement>('field-preset-list');
const draftFieldList = byId<HTMLDivElement>('draft-field-list');
const moduleList = byId<HTMLDivElement>('module-list');
const moduleSortSelect = byId<HTMLSelectElement>('module-sort-select');
const moduleImportInput = byId<HTMLTextAreaElement>('module-import');
const entryModuleSelect = byId<HTMLSelectElement>('entry-module-select');
const entryTitleInput = byId<HTMLInputElement>('entry-title');
const entryFieldContainer = byId<HTMLDivElement>('entry-field-container');
const entryList = byId<HTMLDivElement>('entry-list');
const entrySortSelect = byId<HTMLSelectElement>('entry-sort-select');
const publishOutput = byId<HTMLTextAreaElement>('publish-output');
const publishStatus = byId<HTMLParagraphElement>('publish-status');
const s3Toggle = byId<HTMLInputElement>('publish-upload-s3');
const s3PrefixInput = byId<HTMLInputElement>('publish-s3-prefix');
const settingsS3Bucket = byId<HTMLInputElement>('settings-s3-bucket');
const settingsS3Region = byId<HTMLInputElement>('settings-s3-region');
const settingsS3AccessKey = byId<HTMLInputElement>('settings-s3-access-key');
const settingsS3SecretKey = byId<HTMLInputElement>('settings-s3-secret-key');
const settingsS3Endpoint = byId<HTMLInputElement>('settings-s3-endpoint');
const settingsS3PublicBaseUrl = byId<HTMLInputElement>('settings-s3-public-base-url');
const settingsS3ForcePathStyle = byId<HTMLInputElement>('settings-s3-force-path-style');
const settingsUploadAssetFiles = byId<HTMLInputElement>('settings-upload-asset-files');

let modules: FieldModule[] = [];
let entries: DraftEntry[] = [];
let draftFields: FieldDefinition[] = [];
let editingModuleId: string | null = null;
let currentWizardStep: 0 | 1 | 2 | 3 = 0;
let currentStartMode: 'import' | 'scratch' = 'scratch';
let currentLanguage: SupportedLang = 'en';
let moduleSortMode: 'newest' | 'oldest' | 'name-asc' | 'name-desc' = 'newest';
let entrySortMode: 'newest' | 'oldest' | 'title-asc' | 'title-desc' = 'newest';

const I18N_TEXT: Record<
	SupportedLang,
	{
		about: string;
		stepStart: string;
		stepModules: string;
		stepEntries: string;
		stepPublish: string;
		heroBadge: string;
		heroTitle: string;
		startTitle: string;
		startLead: string;
		importTitle: string;
		importDesc: string;
		newTitle: string;
		newDesc: string;
		modulesTitle: string;
		modulesIntro: string;
		modeImport: string;
		modeScratch: string;
		importPanelTitle: string;
		importPanelLead: string;
		pasteJson: string;
		importButton: string;
		exportButton: string;
		scratchPanelTitle: string;
		fieldDraft: string;
		s3Settings: string;
		savedModules: string;
		backStart: string;
		continueEntries: string;
		entriesTitle: string;
		entriesIntro: string;
		selectModule: string;
		entryTitle: string;
		addEntry: string;
		savedEntries: string;
		backModules: string;
		continuePublish: string;
		publishTitle: string;
		publishIntro: string;
		uploadBundle: string;
		s3Prefix: string;
		buildFinalJson: string;
		clearLocalData: string;
		publishedJson: string;
		backEntries: string;
		poweredBy: string;
		readyNotice: string;
	}
> = {
	en: {
		about: 'About',
		stepStart: 'Start',
		stepModules: 'Modules',
		stepEntries: 'Entries',
		stepPublish: 'Publish',
		heroBadge: 'Content composer',
		heroTitle: 'Jexon Content Composer',
		startTitle: 'How do you want to begin?',
		startLead: 'Import existing JSON (module, workspace, or S3 settings) or start with a blank module builder.',
		importTitle: 'Import',
		importDesc: 'Paste or load JSON: module-1, jexon-export-1, or jexon-workspace-1. S3 keys can be included.',
		newTitle: 'New',
		newDesc: 'Create modules from scratch, add fields, then entries and publish. No file required.',
		modulesTitle: 'Module Builder',
		modulesIntro: 'Choose one mode. Import and New are now fully separated.',
		modeImport: 'Import mode',
		modeScratch: 'New mode',
		importPanelTitle: 'Import Workspace / Module',
		importPanelLead: 'Only import/export JSON here. S3 settings are configured in New mode.',
		pasteJson: 'Paste JSON',
		importButton: 'Import from JSON',
		exportButton: 'Export workspace (modules + S3)',
		scratchPanelTitle: 'Create New Module',
		fieldDraft: 'Field Draft',
		s3Settings: 'S3 Settings',
		savedModules: 'Saved Modules',
		backStart: '← Back to start',
		continueEntries: 'Continue to entries →',
		entriesTitle: 'Entry Builder',
		entriesIntro: 'Create entries from a module. Rich text uses a visual editor (headings, bold, lists, links, images). Images upload to S3 when credentials are set in the Modules step.',
		selectModule: 'Select Module',
		entryTitle: 'Entry Title',
		addEntry: 'Add Entry',
		savedEntries: 'Saved Entries',
		backModules: '← Modules',
		continuePublish: 'Continue to publish →',
		publishTitle: 'Publish',
		publishIntro: 'Build versioned JSON (bundle-1). Configure S3 in the Modules step (embedded in exports). Rich text and file fields use public S3 objects when credentials are set.',
		uploadBundle: 'Also upload bundle JSON to S3',
		s3Prefix: 'S3 key prefix (files + bundle)',
		buildFinalJson: 'Build Final JSON',
		clearLocalData: 'Clear Local Data',
		publishedJson: 'Published JSON',
		backEntries: '← Entries',
		poweredBy: 'Powered By',
		readyNotice: 'Ready. Choose Import or New, then modules, entries, and publish.',
	},
	fr: {
		about: 'A propos',
		stepStart: 'Debut',
		stepModules: 'Modules',
		stepEntries: 'Entrees',
		stepPublish: 'Publication',
		heroBadge: 'Composeur de contenu',
		heroTitle: 'Jexon Content Composer',
		startTitle: 'Comment voulez-vous commencer ?',
		startLead: 'Importez un JSON existant ou commencez avec un module vierge.',
		importTitle: 'Importer',
		importDesc: 'Collez un JSON: module-1, jexon-export-1 ou jexon-workspace-1.',
		newTitle: 'Nouveau',
		newDesc: 'Creez des modules depuis zero, ajoutez des champs puis publiez.',
		modulesTitle: 'Constructeur de modules',
		modulesIntro: 'Choisissez un mode. Importation et creation sont separees.',
		modeImport: 'Mode import',
		modeScratch: 'Mode nouveau',
		importPanelTitle: 'Importer espace / module',
		importPanelLead: "Import/export JSON ici. Les parametres S3 sont dans le mode Nouveau.",
		pasteJson: 'Coller JSON',
		importButton: 'Importer JSON',
		exportButton: 'Exporter workspace (modules + S3)',
		scratchPanelTitle: 'Creer un nouveau module',
		fieldDraft: 'Brouillon des champs',
		s3Settings: 'Parametres S3',
		savedModules: 'Modules enregistres',
		backStart: '← Retour au debut',
		continueEntries: 'Continuer vers les entrees →',
		entriesTitle: "Constructeur d'entrees",
		entriesIntro: "Creez des entrees depuis un module. Le rich text utilise un editeur visuel avec upload d'images vers S3.",
		selectModule: 'Selectionner module',
		entryTitle: "Titre de l'entree",
		addEntry: 'Ajouter entree',
		savedEntries: 'Entrees enregistrees',
		backModules: '← Modules',
		continuePublish: 'Continuer vers publication →',
		publishTitle: 'Publication',
		publishIntro: 'Generez un JSON versionne (bundle-1) et publiez avec options S3.',
		uploadBundle: 'Televerser aussi le bundle JSON vers S3',
		s3Prefix: 'Prefixe de cle S3 (fichiers + bundle)',
		buildFinalJson: 'Generer JSON final',
		clearLocalData: 'Effacer donnees locales',
		publishedJson: 'JSON publie',
		backEntries: '← Entrees',
		poweredBy: 'Propulse par',
		readyNotice: 'Pret. Choisissez Import ou Nouveau, puis modules, entrees et publication.',
	},
	es: {
		about: 'Acerca de',
		stepStart: 'Inicio',
		stepModules: 'Modulos',
		stepEntries: 'Entradas',
		stepPublish: 'Publicar',
		heroBadge: 'Compositor de contenido',
		heroTitle: 'Jexon Content Composer',
		startTitle: 'Como quieres empezar?',
		startLead: 'Importa JSON existente o empieza con un constructor en blanco.',
		importTitle: 'Importar',
		importDesc: 'Pega o carga JSON: module-1, jexon-export-1 o jexon-workspace-1.',
		newTitle: 'Nuevo',
		newDesc: 'Crea modulos desde cero, agrega campos y luego publica.',
		modulesTitle: 'Constructor de modulos',
		modulesIntro: 'Elige un modo. Importar y Nuevo estan separados.',
		modeImport: 'Modo importar',
		modeScratch: 'Modo nuevo',
		importPanelTitle: 'Importar workspace / modulo',
		importPanelLead: 'Aqui solo JSON import/export. S3 se configura en modo Nuevo.',
		pasteJson: 'Pegar JSON',
		importButton: 'Importar JSON',
		exportButton: 'Exportar workspace (modulos + S3)',
		scratchPanelTitle: 'Crear nuevo modulo',
		fieldDraft: 'Borrador de campos',
		s3Settings: 'Configuracion S3',
		savedModules: 'Modulos guardados',
		backStart: '← Volver al inicio',
		continueEntries: 'Continuar a entradas →',
		entriesTitle: 'Constructor de entradas',
		entriesIntro: 'Crea entradas desde un modulo. El rich text usa editor visual e imagenes en S3.',
		selectModule: 'Seleccionar modulo',
		entryTitle: 'Titulo de entrada',
		addEntry: 'Agregar entrada',
		savedEntries: 'Entradas guardadas',
		backModules: '← Modulos',
		continuePublish: 'Continuar a publicar →',
		publishTitle: 'Publicar',
		publishIntro: 'Genera JSON versionado (bundle-1) y publica con opciones S3.',
		uploadBundle: 'Subir tambien bundle JSON a S3',
		s3Prefix: 'Prefijo clave S3 (archivos + bundle)',
		buildFinalJson: 'Generar JSON final',
		clearLocalData: 'Limpiar datos locales',
		publishedJson: 'JSON publicado',
		backEntries: '← Entradas',
		poweredBy: 'Powered By',
		readyNotice: 'Listo. Elige Importar o Nuevo, luego modulos, entradas y publicar.',
	},
	ar: {
		about: 'حول',
		stepStart: 'البداية',
		stepModules: 'الوحدات',
		stepEntries: 'الإدخالات',
		stepPublish: 'النشر',
		heroBadge: 'منشئ المحتوى',
		heroTitle: 'Jexon Content Composer',
		startTitle: 'كيف تريد أن تبدأ؟',
		startLead: 'استورد JSON موجودًا أو ابدأ ببناء وحدة جديدة من الصفر.',
		importTitle: 'استيراد',
		importDesc: 'الصق أو حمّل JSON: module-1 أو jexon-export-1 أو jexon-workspace-1.',
		newTitle: 'جديد',
		newDesc: 'أنشئ وحدات من الصفر، أضف الحقول، ثم الإدخالات والنشر. لا حاجة لملف.',
		modulesTitle: 'منشئ الوحدات',
		modulesIntro: 'اختر وضعًا واحدًا. وضعا الاستيراد والجديد منفصلان.',
		modeImport: 'وضع الاستيراد',
		modeScratch: 'وضع جديد',
		importPanelTitle: 'استيراد مساحة العمل / وحدة',
		importPanelLead: 'هنا للاستيراد/التصدير بصيغة JSON فقط. إعدادات S3 في وضع جديد.',
		pasteJson: 'لصق JSON',
		importButton: 'استيراد من JSON',
		exportButton: 'تصدير مساحة العمل (modules + S3)',
		scratchPanelTitle: 'إنشاء وحدة جديدة',
		fieldDraft: 'مسودة الحقول',
		s3Settings: 'إعدادات S3',
		savedModules: 'الوحدات المحفوظة',
		backStart: 'الرجوع إلى البداية',
		continueEntries: 'المتابعة إلى الإدخالات',
		entriesTitle: 'منشئ الإدخالات',
		entriesIntro: 'أنشئ إدخالات من وحدة. النص المنسق يستخدم محررًا بصريًا، ويمكن رفع الصور إلى S3.',
		selectModule: 'اختر وحدة',
		entryTitle: 'عنوان الإدخال',
		addEntry: 'إضافة إدخال',
		savedEntries: 'الإدخالات المحفوظة',
		backModules: 'الرجوع إلى الوحدات',
		continuePublish: 'المتابعة إلى النشر',
		publishTitle: 'النشر',
		publishIntro: 'أنشئ JSON بإصدار (bundle-1) وانشره مع خيارات S3.',
		uploadBundle: 'ارفع أيضًا ملف JSON النهائي إلى S3',
		s3Prefix: 'بادئة مفتاح S3 (الملفات + الحزمة)',
		buildFinalJson: 'إنشاء JSON النهائي',
		clearLocalData: 'مسح البيانات المحلية',
		publishedJson: 'JSON المنشور',
		backEntries: 'الرجوع إلى الإدخالات',
		poweredBy: 'Powered By',
		readyNotice: 'جاهز. اختر استيراد أو جديد، ثم الوحدات، الإدخالات، ثم النشر.',
	},
	fa: {
		about: 'درباره',
		stepStart: 'شروع',
		stepModules: 'ماژول‌ها',
		stepEntries: 'ورودی‌ها',
		stepPublish: 'انتشار',
		heroBadge: 'سازنده محتوا',
		heroTitle: 'Jexon Content Composer',
		startTitle: 'می‌خواهید چگونه شروع کنید؟',
		startLead: 'JSON موجود را import کنید یا با یک ماژول جدید از صفر شروع کنید.',
		importTitle: 'درون‌ریزی',
		importDesc: 'JSON را paste یا load کنید: module-1، jexon-export-1 یا jexon-workspace-1.',
		newTitle: 'جدید',
		newDesc: 'ماژول را از صفر بسازید، فیلد اضافه کنید، سپس ورودی‌ها را ثبت و منتشر کنید.',
		modulesTitle: 'سازنده ماژول',
		modulesIntro: 'یک حالت را انتخاب کنید. حالت Import و New کاملا جدا هستند.',
		modeImport: 'حالت درون‌ریزی',
		modeScratch: 'حالت جدید',
		importPanelTitle: 'درون‌ریزی فضای کار / ماژول',
		importPanelLead: 'اینجا فقط برای درون‌ریزی/برون‌بری JSON است. تنظیمات S3 در حالت جدید انجام می‌شود.',
		pasteJson: 'الصاق JSON',
		importButton: 'درون‌ریزی از JSON',
		exportButton: 'برون‌بری فضای کار (ماژول‌ها + S3)',
		scratchPanelTitle: 'ایجاد ماژول جدید',
		fieldDraft: 'پیش‌نویس فیلد',
		s3Settings: 'تنظیمات S3',
		savedModules: 'ماژول‌های ذخیره‌شده',
		backStart: 'بازگشت به شروع',
		continueEntries: 'ادامه به ورودی‌ها',
		entriesTitle: 'سازنده ورودی',
		entriesIntro: 'از روی ماژول ورودی بسازید. متن غنی با ویرایشگر بصری کار می‌کند و تصویرها به S3 آپلود می‌شوند.',
		selectModule: 'انتخاب ماژول',
		entryTitle: 'عنوان ورودی',
		addEntry: 'افزودن ورودی',
		savedEntries: 'ورودی‌های ذخیره‌شده',
		backModules: 'بازگشت به ماژول‌ها',
		continuePublish: 'ادامه به انتشار',
		publishTitle: 'انتشار',
		publishIntro: 'JSON نسخه‌دار (bundle-1) بسازید و با گزینه‌های S3 منتشر کنید.',
		uploadBundle: 'فایل JSON نهایی را هم در S3 آپلود کن',
		s3Prefix: 'پیشوند کلید S3 (فایل‌ها + باندل)',
		buildFinalJson: 'ساخت JSON نهایی',
		clearLocalData: 'پاک کردن داده‌های محلی',
		publishedJson: 'JSON منتشرشده',
		backEntries: 'بازگشت به ورودی‌ها',
		poweredBy: 'Powered By',
		readyNotice: 'آماده است. درون‌ریزی یا جدید را انتخاب کنید، سپس ماژول‌ها، ورودی‌ها و انتشار.',
	},
};

type UIStrings = {
		moduleImportPlaceholder: string;
		moduleId: string;
		moduleName: string;
		description: string;
		moduleDescriptionPlaceholder: string;
		moduleIdPlaceholder: string;
		moduleNamePlaceholder: string;
		fieldId: string;
		fieldLabel: string;
		fieldType: string;
		helpTextOptional: string;
		fieldHelpPlaceholder: string;
		fieldIdPlaceholder: string;
		fieldLabelPlaceholder: string;
		required: string;
		addField: string;
		clearFields: string;
		fieldTemplatesTitle: string;
		templateBlogPost: string;
		templateSeoPack: string;
		templateProduct: string;
		templateFaq: string;
		templatePodcast: string;
		templateLandingPage: string;
		templatePortfolio: string;
		templateNewsArticle: string;
		sortLabel: string;
		sortNewest: string;
		sortOldest: string;
		sortNameAsc: string;
		sortNameDesc: string;
		sortTitleAsc: string;
		sortTitleDesc: string;
		saveModule: string;
		resetForm: string;
		s3UsedLead: string;
		s3Credentials: string;
		bucket: string;
		region: string;
		accessKeyId: string;
		secretAccessKey: string;
		endpointOptional: string;
		publicBaseUrlOptional: string;
		forcePathStyle: string;
		uploadFilesToS3: string;
		saveS3Local: string;
		selectModuleOption: string;
		entryTitlePlaceholder: string;
		noFieldsAddedYet: string;
		noModulesSaved: string;
		noModulesAvailable: string;
		noEntriesSavedYet: string;
		noDescription: string;
		fieldCount: string;
		edit: string;
		exportJson: string;
		delete: string;
		modulePrefix: string;
		selectModuleToCreateEntries: string;
		richBold: string;
		richItalic: string;
		richStrike: string;
		richCode: string;
		richHeading2: string;
		richHeading3: string;
		richBullet: string;
		richOrdered: string;
		richQuote: string;
		richLink: string;
		richUploadImage: string;
		richImageButton: string;
		startWritingPlaceholder: string;
		promptLinkUrl: string;
		imageUploadFailed: string;
		noticeS3Saved: string;
		noticeFieldIdLabelRequired: string;
		noticeInvalidFieldType: string;
		noticeFieldExists: string;
		noticeFieldAdded: string;
		noticeFieldListCleared: string;
		noticePresetAdded: string;
		noticePresetAlreadyExists: string;
		noticeModuleIdNameRequired: string;
		noticeModuleNeedsField: string;
		noticeModuleExists: string;
		noticeModuleSaved: string;
		noticePasteJsonFirst: string;
		noticeImportedWorkspace: string;
		noticeImportedModule: string;
		noticeImportedModules: string;
		noticeInvalidJson: string;
		noticeWorkspaceLoadedInBox: string;
		noticeModuleNotFound: string;
		noticeEditingModule: string;
		noticeModuleDeleted: string;
		noticeModuleLoadedInBox: string;
		noticeEntryDeleted: string;
		noticeSelectModuleFirst: string;
		noticeEntryTitleRequired: string;
		noticeFieldNeedsFile: string;
		noticeCouldNotReadFile: string;
		noticeFieldRequired: string;
		noticeEntryAdded: string;
		noticeCannotPublishNoModule: string;
		noticeBuildingFinalJson: string;
		noticeFinalJsonOffline: string;
		noticePublishFailed: string;
		noticePublishedAndUploaded: string;
		noticeFinalJsonSuccess: string;
		noticeLocalDataCleared: string;
	};

const UI_TEXT: Record<SupportedLang, Partial<UIStrings>> = {
	en: {
		moduleImportPlaceholder: 'module-1, jexon-export-1 (module + S3), or jexon-workspace-1 (all modules + S3)',
		moduleId: 'Module ID',
		moduleName: 'Module Name',
		description: 'Description',
		moduleDescriptionPlaceholder: 'Used for long-form blog posts',
		moduleIdPlaceholder: 'blog_post',
		moduleNamePlaceholder: 'Blog Post',
		fieldId: 'Field ID',
		fieldLabel: 'Field Label',
		fieldType: 'Field Type',
		helpTextOptional: 'Help Text (optional)',
		fieldHelpPlaceholder: 'Displayed below the field',
		fieldIdPlaceholder: 'title',
		fieldLabelPlaceholder: 'Title',
		required: 'Required',
		addField: 'Add Field',
		clearFields: 'Clear Fields',
		fieldTemplatesTitle: 'Quick field templates',
		templateBlogPost: 'Blog Post',
		templateSeoPack: 'SEO Pack',
		templateProduct: 'Product',
		templateFaq: 'FAQ',
		templatePodcast: 'Podcast',
		templateLandingPage: 'Landing Page',
		templatePortfolio: 'Portfolio',
		templateNewsArticle: 'News Article',
		sortLabel: 'Sort',
		sortNewest: 'Newest',
		sortOldest: 'Oldest',
		sortNameAsc: 'Name A-Z',
		sortNameDesc: 'Name Z-A',
		sortTitleAsc: 'Title A-Z',
		sortTitleDesc: 'Title Z-A',
		saveModule: 'Save Module',
		resetForm: 'Reset Form',
		s3UsedLead: 'Used for asset uploads and publish. These values are also embedded in exports.',
		s3Credentials: 'S3 credentials',
		bucket: 'Bucket',
		region: 'Region',
		accessKeyId: 'Access Key ID',
		secretAccessKey: 'Secret Access Key',
		endpointOptional: 'Endpoint (optional)',
		publicBaseUrlOptional: 'Public base URL (optional)',
		forcePathStyle: 'Force path-style addressing',
		uploadFilesToS3: 'On publish, upload file fields to S3 (public URL in JSON)',
		saveS3Local: 'Save S3 locally',
		selectModuleOption: 'Select a module',
		entryTitlePlaceholder: 'My first article',
		noFieldsAddedYet: 'No fields added yet.',
		noModulesSaved: 'No modules saved.',
		noModulesAvailable: 'No modules available',
		noEntriesSavedYet: 'No entries saved yet.',
		noDescription: 'No description',
		fieldCount: '{count} field(s)',
		edit: 'Edit',
		exportJson: 'Export JSON',
		delete: 'Delete',
		modulePrefix: 'module',
		selectModuleToCreateEntries: 'Select a module to create entries.',
		richBold: 'Bold',
		richItalic: 'Italic',
		richStrike: 'Strikethrough',
		richCode: 'Inline code',
		richHeading2: 'Heading 2',
		richHeading3: 'Heading 3',
		richBullet: 'Bullet list',
		richOrdered: 'Numbered list',
		richQuote: 'Quote',
		richLink: 'Link',
		richUploadImage: 'Upload image to S3',
		richImageButton: 'Image',
		startWritingPlaceholder: 'Start writing…',
		promptLinkUrl: 'Link URL',
		imageUploadFailed: 'Image upload failed',
		noticeS3Saved: 'S3 settings saved in this browser.',
		noticeFieldIdLabelRequired: 'Field ID and Field Label are required.',
		noticeInvalidFieldType: 'Invalid field type.',
		noticeFieldExists: "A field with id '{id}' already exists in this draft.",
		noticeFieldAdded: "Field '{id}' added.",
		noticeFieldListCleared: 'Draft field list cleared.',
		noticePresetAdded: "Template '{name}' added ({count} field(s)).",
		noticePresetAlreadyExists: "Template '{name}' is already in draft.",
		noticeModuleIdNameRequired: 'Module ID and Module Name are required.',
		noticeModuleNeedsField: 'At least one field is required for a module.',
		noticeModuleExists: "Module '{id}' already exists.",
		noticeModuleSaved: "Module '{id}' saved.",
		noticePasteJsonFirst: 'Paste JSON first.',
		noticeImportedWorkspace: 'Imported workspace: {count} module(s).',
		noticeImportedModule: "Imported module '{id}' (and S3 if present).",
		noticeImportedModules: '{count} module(s) imported.',
		noticeInvalidJson: 'Invalid JSON.',
		noticeWorkspaceLoadedInBox: 'Workspace JSON (all modules + S3) loaded into the box.',
		noticeModuleNotFound: 'Module not found.',
		noticeEditingModule: "Editing module '{id}'.",
		noticeModuleDeleted: "Module '{id}' deleted.",
		noticeModuleLoadedInBox: "Module '{id}' + S3 loaded into the JSON box.",
		noticeEntryDeleted: "Entry '{id}' deleted.",
		noticeSelectModuleFirst: 'Select a module first.',
		noticeEntryTitleRequired: 'Entry title is required.',
		noticeFieldNeedsFile: 'Field "{label}" requires a file.',
		noticeCouldNotReadFile: 'Could not read file for "{label}".',
		noticeFieldRequired: 'Field "{label}" is required.',
		noticeEntryAdded: "Entry '{id}' added.",
		noticeCannotPublishNoModule: 'Cannot publish without at least one module.',
		noticeBuildingFinalJson: 'Building final JSON...',
		noticeFinalJsonOffline: 'Final JSON generated successfully (offline mode).',
		noticePublishFailed: 'Publish failed',
		noticePublishedAndUploaded: 'Published and uploaded to S3: {uri}',
		noticeFinalJsonSuccess: 'Final JSON generated successfully.',
		noticeLocalDataCleared: 'Local data cleared.',
	},
	fr: {
		moduleImportPlaceholder: 'module-1, jexon-export-1 (module + S3) ou jexon-workspace-1 (tous les modules + S3)',
		moduleId: 'ID du module',
		moduleName: 'Nom du module',
		description: 'Description',
		moduleDescriptionPlaceholder: 'Utilise pour les articles longue forme',
		moduleIdPlaceholder: 'article_blog',
		moduleNamePlaceholder: 'Article Blog',
		fieldId: 'ID du champ',
		fieldLabel: 'Libelle du champ',
		fieldType: 'Type de champ',
		helpTextOptional: "Texte d'aide (optionnel)",
		fieldHelpPlaceholder: 'Affiche sous le champ',
		fieldIdPlaceholder: 'titre',
		fieldLabelPlaceholder: 'Titre',
		required: 'Obligatoire',
		addField: 'Ajouter champ',
		clearFields: 'Effacer champs',
		saveModule: 'Enregistrer module',
		resetForm: 'Reinitialiser',
		s3UsedLead: "Utilise pour l'upload des assets et la publication. Ces valeurs sont aussi exportees.",
		s3Credentials: 'Identifiants S3',
		bucket: 'Bucket',
		region: 'Region',
		accessKeyId: "ID cle d'acces",
		secretAccessKey: "Cle secrete d'acces",
		endpointOptional: 'Endpoint (optionnel)',
		publicBaseUrlOptional: 'URL publique (optionnel)',
		forcePathStyle: 'Forcer path-style',
		uploadFilesToS3: 'A la publication, uploader les fichiers vers S3 (URL publique dans JSON)',
		saveS3Local: 'Sauver S3 localement',
		selectModuleOption: 'Selectionner un module',
		entryTitlePlaceholder: 'Mon premier article',
		noFieldsAddedYet: 'Aucun champ ajoute.',
		noModulesSaved: 'Aucun module enregistre.',
		noModulesAvailable: 'Aucun module disponible',
		noEntriesSavedYet: 'Aucune entree enregistree.',
		noDescription: 'Aucune description',
		fieldCount: '{count} champ(s)',
		edit: 'Modifier',
		exportJson: 'Exporter JSON',
		delete: 'Supprimer',
		modulePrefix: 'module',
		selectModuleToCreateEntries: 'Selectionnez un module pour creer des entrees.',
		richBold: 'Gras',
		richItalic: 'Italique',
		richStrike: 'Barre',
		richCode: 'Code inline',
		richHeading2: 'Titre 2',
		richHeading3: 'Titre 3',
		richBullet: 'Liste a puces',
		richOrdered: 'Liste numerotee',
		richQuote: 'Citation',
		richLink: 'Lien',
		richUploadImage: 'Uploader image vers S3',
		richImageButton: 'Image',
		startWritingPlaceholder: 'Commencez a ecrire…',
		promptLinkUrl: 'URL du lien',
		imageUploadFailed: "Echec de l'upload d'image",
		noticeS3Saved: 'Parametres S3 enregistres dans ce navigateur.',
		noticeFieldIdLabelRequired: 'ID et libelle du champ sont obligatoires.',
		noticeInvalidFieldType: 'Type de champ invalide.',
		noticeFieldExists: "Un champ avec l'id '{id}' existe deja.",
		noticeFieldAdded: "Champ '{id}' ajoute.",
		noticeFieldListCleared: 'Liste de champs effacee.',
		noticeModuleIdNameRequired: 'ID et nom du module sont obligatoires.',
		noticeModuleNeedsField: 'Au moins un champ est requis pour un module.',
		noticeModuleExists: "Le module '{id}' existe deja.",
		noticeModuleSaved: "Module '{id}' enregistre.",
		noticePasteJsonFirst: "Collez d'abord le JSON.",
		noticeImportedWorkspace: 'Workspace importe : {count} module(s).',
		noticeImportedModule: "Module '{id}' importe (et S3 si present).",
		noticeImportedModules: '{count} module(s) importes.',
		noticeInvalidJson: 'JSON invalide.',
		noticeWorkspaceLoadedInBox: 'Le JSON du workspace (modules + S3) est charge dans la zone.',
		noticeModuleNotFound: 'Module introuvable.',
		noticeEditingModule: "Edition du module '{id}'.",
		noticeModuleDeleted: "Module '{id}' supprime.",
		noticeModuleLoadedInBox: "Module '{id}' + S3 charge dans la zone JSON.",
		noticeEntryDeleted: "Entree '{id}' supprimee.",
		noticeSelectModuleFirst: "Selectionnez d'abord un module.",
		noticeEntryTitleRequired: "Le titre de l'entree est obligatoire.",
		noticeFieldNeedsFile: 'Le champ "{label}" requiert un fichier.',
		noticeCouldNotReadFile: 'Impossible de lire le fichier pour "{label}".',
		noticeFieldRequired: 'Le champ "{label}" est obligatoire.',
		noticeEntryAdded: "Entree '{id}' ajoutee.",
		noticeCannotPublishNoModule: 'Impossible de publier sans module.',
		noticeBuildingFinalJson: 'Generation du JSON final...',
		noticeFinalJsonOffline: 'JSON final genere avec succes (mode hors ligne).',
		noticePublishFailed: 'Echec de publication',
		noticePublishedAndUploaded: 'Publie et envoye vers S3 : {uri}',
		noticeFinalJsonSuccess: 'JSON final genere avec succes.',
		noticeLocalDataCleared: 'Donnees locales effacees.',
	},
	es: {
		moduleImportPlaceholder: 'module-1, jexon-export-1 (modulo + S3), o jexon-workspace-1 (todos los modulos + S3)',
		s3UsedLead: 'Se usa para subida de archivos y publicacion. Estos valores tambien se incluyen en exportaciones.',
		moduleId: 'ID del modulo',
		moduleName: 'Nombre del modulo',
		description: 'Descripcion',
		moduleDescriptionPlaceholder: 'Usado para articulos largos',
		moduleIdPlaceholder: 'articulo_blog',
		moduleNamePlaceholder: 'Articulo Blog',
		fieldId: 'ID del campo',
		fieldLabel: 'Etiqueta del campo',
		fieldType: 'Tipo de campo',
		helpTextOptional: 'Texto de ayuda (opcional)',
		fieldHelpPlaceholder: 'Se muestra debajo del campo',
		fieldIdPlaceholder: 'titulo',
		fieldLabelPlaceholder: 'Titulo',
		required: 'Requerido',
		addField: 'Agregar campo',
		clearFields: 'Limpiar campos',
		saveModule: 'Guardar modulo',
		resetForm: 'Restablecer',
		s3Credentials: 'Credenciales S3',
		bucket: 'Bucket',
		region: 'Region',
		accessKeyId: 'Access Key ID',
		secretAccessKey: 'Secret Access Key',
		endpointOptional: 'Endpoint (opcional)',
		publicBaseUrlOptional: 'URL base publica (opcional)',
		forcePathStyle: 'Forzar path-style',
		uploadFilesToS3: 'Al publicar, subir campos de archivo a S3 (URL publica en JSON)',
		saveS3Local: 'Guardar S3 localmente',
		selectModuleOption: 'Seleccionar un modulo',
		entryTitlePlaceholder: 'Mi primer articulo',
		noFieldsAddedYet: 'Aun no hay campos.',
		noModulesSaved: 'No hay modulos guardados.',
		noModulesAvailable: 'No hay modulos disponibles',
		noEntriesSavedYet: 'No hay entradas guardadas.',
		noDescription: 'Sin descripcion',
		fieldCount: '{count} campo(s)',
		edit: 'Editar',
		exportJson: 'Exportar JSON',
		delete: 'Eliminar',
		modulePrefix: 'modulo',
		selectModuleToCreateEntries: 'Selecciona un modulo para crear entradas.',
		richBold: 'Negrita',
		richItalic: 'Cursiva',
		richStrike: 'Tachado',
		richCode: 'Codigo en linea',
		richHeading2: 'Encabezado 2',
		richHeading3: 'Encabezado 3',
		richBullet: 'Lista con vietas',
		richOrdered: 'Lista numerada',
		richQuote: 'Cita',
		richLink: 'Enlace',
		richUploadImage: 'Subir imagen a S3',
		richImageButton: 'Imagen',
		startWritingPlaceholder: 'Empieza a escribir…',
		promptLinkUrl: 'URL del enlace',
		imageUploadFailed: 'Error al subir imagen',
		noticeS3Saved: 'Configuracion S3 guardada en este navegador.',
		noticeFieldIdLabelRequired: 'ID y etiqueta del campo son obligatorios.',
		noticeInvalidFieldType: 'Tipo de campo invalido.',
		noticeFieldExists: "Ya existe un campo con id '{id}'.",
		noticeFieldAdded: "Campo '{id}' agregado.",
		noticeFieldListCleared: 'Lista de campos limpiada.',
		noticeModuleIdNameRequired: 'ID y nombre del modulo son obligatorios.',
		noticeModuleNeedsField: 'Al menos un campo es obligatorio para un modulo.',
		noticeModuleExists: "El modulo '{id}' ya existe.",
		noticeModuleSaved: "Modulo '{id}' guardado.",
		noticePasteJsonFirst: 'Primero pega JSON.',
		noticeImportedWorkspace: 'Workspace importado: {count} modulo(s).',
		noticeImportedModule: "Modulo '{id}' importado (y S3 si existe).",
		noticeImportedModules: '{count} modulo(s) importado(s).',
		noticeInvalidJson: 'JSON invalido.',
		noticeModuleNotFound: 'Modulo no encontrado.',
		noticeEditingModule: "Editando modulo '{id}'.",
		noticeModuleDeleted: "Modulo '{id}' eliminado.",
		noticeEntryDeleted: "Entrada '{id}' eliminada.",
		noticeSelectModuleFirst: 'Primero selecciona un modulo.',
		noticeEntryTitleRequired: 'El titulo de la entrada es obligatorio.',
		noticeEntryAdded: "Entrada '{id}' agregada.",
		noticeCannotPublishNoModule: 'No se puede publicar sin al menos un modulo.',
		noticeBuildingFinalJson: 'Generando JSON final...',
		noticeFinalJsonOffline: 'JSON final generado correctamente (modo sin conexion).',
		noticePublishFailed: 'Fallo la publicacion',
		noticeFinalJsonSuccess: 'JSON final generado correctamente.',
		noticeLocalDataCleared: 'Datos locales eliminados.',
	},
	ar: {
		moduleImportPlaceholder: 'module-1 أو jexon-export-1 (module + S3) أو jexon-workspace-1 (كل الوحدات + S3)',
		s3UsedLead: 'تستخدم هذه القيم لرفع الملفات والنشر، كما يتم تضمينها في التصدير.',
		moduleId: 'معرف الوحدة',
		moduleName: 'اسم الوحدة',
		description: 'الوصف',
		moduleDescriptionPlaceholder: 'يستخدم للمقالات الطويلة',
		moduleIdPlaceholder: 'مقال_مدونة',
		moduleNamePlaceholder: 'مقال مدونة',
		fieldId: 'معرف الحقل',
		fieldLabel: 'تسمية الحقل',
		fieldType: 'نوع الحقل',
		helpTextOptional: 'نص المساعدة (اختياري)',
		fieldHelpPlaceholder: 'يظهر أسفل الحقل',
		fieldIdPlaceholder: 'العنوان',
		fieldLabelPlaceholder: 'عنوان',
		required: 'مطلوب',
		addField: 'إضافة حقل',
		clearFields: 'مسح الحقول',
		saveModule: 'حفظ الوحدة',
		resetForm: 'إعادة تعيين',
		s3Credentials: 'بيانات S3',
		bucket: 'الحاوية',
		region: 'المنطقة',
		accessKeyId: 'معرف مفتاح الوصول',
		secretAccessKey: 'المفتاح السري',
		endpointOptional: 'نقطة النهاية (اختياري)',
		publicBaseUrlOptional: 'الرابط العام (اختياري)',
		forcePathStyle: 'فرض أسلوب path-style',
		uploadFilesToS3: 'عند النشر، ارفع ملفات الحقول إلى S3 (رابط عام داخل JSON)',
		saveS3Local: 'حفظ إعدادات S3 محليًا',
		selectModuleOption: 'اختر وحدة',
		entryTitlePlaceholder: 'مقالي الأول',
		noFieldsAddedYet: 'لم تتم إضافة حقول بعد.',
		noModulesSaved: 'لا توجد وحدات محفوظة.',
		noModulesAvailable: 'لا توجد وحدات متاحة',
		noEntriesSavedYet: 'لا توجد إدخالات محفوظة.',
		noDescription: 'بدون وصف',
		fieldCount: '{count} حقل',
		edit: 'تعديل',
		exportJson: 'تصدير JSON',
		delete: 'حذف',
		modulePrefix: 'وحدة',
		selectModuleToCreateEntries: 'اختر وحدة لإنشاء إدخالات.',
		richBold: 'غامق',
		richItalic: 'مائل',
		richStrike: 'يتوسطه خط',
		richCode: 'كود مضمّن',
		richHeading2: 'عنوان 2',
		richHeading3: 'عنوان 3',
		richBullet: 'قائمة نقطية',
		richOrdered: 'قائمة مرقمة',
		richQuote: 'اقتباس',
		richLink: 'رابط',
		richUploadImage: 'رفع صورة إلى S3',
		richImageButton: 'صورة',
		startWritingPlaceholder: 'ابدأ الكتابة…',
		promptLinkUrl: 'رابط URL',
		imageUploadFailed: 'فشل رفع الصورة',
		noticeS3Saved: 'تم حفظ إعدادات S3 في هذا المتصفح.',
		noticeFieldIdLabelRequired: 'معرف الحقل وتسميته مطلوبان.',
		noticeInvalidFieldType: 'نوع الحقل غير صالح.',
		noticeFieldExists: "يوجد حقل بالمعرف '{id}' بالفعل.",
		noticeFieldAdded: "تمت إضافة الحقل '{id}'.",
		noticeFieldListCleared: 'تم مسح قائمة الحقول.',
		noticeModuleIdNameRequired: 'معرف الوحدة واسمها مطلوبان.',
		noticeModuleNeedsField: 'يجب أن تحتوي الوحدة على حقل واحد على الأقل.',
		noticeModuleExists: "الوحدة '{id}' موجودة بالفعل.",
		noticeModuleSaved: "تم حفظ الوحدة '{id}'.",
		noticePasteJsonFirst: 'ألصق JSON أولاً.',
		noticeImportedWorkspace: 'تم استيراد مساحة العمل: {count} وحدة.',
		noticeImportedModule: "تم استيراد الوحدة '{id}' (وملفات S3 إن وجدت).",
		noticeImportedModules: 'تم استيراد {count} وحدة.',
		noticeInvalidJson: 'JSON غير صالح.',
		noticeWorkspaceLoadedInBox: 'تم تحميل JSON مساحة العمل (الوحدات + S3) في الصندوق.',
		noticeModuleNotFound: 'الوحدة غير موجودة.',
		noticeEditingModule: "جار تعديل الوحدة '{id}'.",
		noticeModuleDeleted: "تم حذف الوحدة '{id}'.",
		noticeModuleLoadedInBox: "تم تحميل الوحدة '{id}' + S3 في صندوق JSON.",
		noticeEntryDeleted: "تم حذف الإدخال '{id}'.",
		noticeSelectModuleFirst: 'اختر وحدة أولاً.',
		noticeEntryTitleRequired: 'عنوان الإدخال مطلوب.',
		noticeFieldNeedsFile: 'الحقل "{label}" يتطلب ملفًا.',
		noticeCouldNotReadFile: 'تعذر قراءة الملف للحقل "{label}".',
		noticeFieldRequired: 'الحقل "{label}" مطلوب.',
		noticeEntryAdded: "تمت إضافة الإدخال '{id}'.",
		noticeCannotPublishNoModule: 'لا يمكن النشر بدون وحدة واحدة على الأقل.',
		noticeBuildingFinalJson: 'جار إنشاء JSON النهائي...',
		noticeFinalJsonOffline: 'تم إنشاء JSON النهائي بنجاح (وضع عدم الاتصال).',
		noticePublishFailed: 'فشل النشر',
		noticePublishedAndUploaded: 'تم النشر والرفع إلى S3: {uri}',
		noticeFinalJsonSuccess: 'تم إنشاء JSON النهائي بنجاح.',
		noticeLocalDataCleared: 'تم مسح البيانات المحلية.',
	},
	fa: {
		moduleImportPlaceholder: 'module-1 یا jexon-export-1 (module + S3) یا jexon-workspace-1 (همه ماژول‌ها + S3)',
		s3UsedLead: 'این مقادیر برای آپلود فایل و انتشار استفاده می‌شوند و در خروجی هم ذخیره می‌شوند.',
		moduleId: 'شناسه ماژول',
		moduleName: 'نام ماژول',
		description: 'توضیحات',
		moduleDescriptionPlaceholder: 'برای مقاله‌های بلند استفاده می‌شود',
		moduleIdPlaceholder: 'blog_post',
		moduleNamePlaceholder: 'مقاله وبلاگ',
		fieldId: 'شناسه فیلد',
		fieldLabel: 'برچسب فیلد',
		fieldType: 'نوع فیلد',
		helpTextOptional: 'متن راهنما (اختیاری)',
		fieldHelpPlaceholder: 'زیر فیلد نمایش داده می‌شود',
		fieldIdPlaceholder: 'title',
		fieldLabelPlaceholder: 'عنوان',
		required: 'الزامی',
		addField: 'افزودن فیلد',
		clearFields: 'پاک کردن فیلدها',
		saveModule: 'ذخیره ماژول',
		resetForm: 'بازنشانی فرم',
		s3Credentials: 'اعتبارنامه‌های S3',
		bucket: 'باکت',
		region: 'ریجن',
		accessKeyId: 'شناسه کلید دسترسی',
		secretAccessKey: 'کلید دسترسی مخفی',
		endpointOptional: 'اندپوینت (اختیاری)',
		publicBaseUrlOptional: 'آدرس پایه عمومی (اختیاری)',
		forcePathStyle: 'اجبار path-style',
		uploadFilesToS3: 'در انتشار، فایل‌فیلدها را به S3 آپلود کن (با URL عمومی در JSON)',
		saveS3Local: 'ذخیره محلی S3',
		selectModuleOption: 'انتخاب ماژول',
		entryTitlePlaceholder: 'اولین مقاله من',
		noFieldsAddedYet: 'هنوز فیلدی اضافه نشده است.',
		noModulesSaved: 'ماژولی ذخیره نشده است.',
		noModulesAvailable: 'ماژولی موجود نیست',
		noEntriesSavedYet: 'هنوز ورودی ذخیره نشده است.',
		noDescription: 'بدون توضیح',
		fieldCount: '{count} فیلد',
		edit: 'ویرایش',
		exportJson: 'خروجی JSON',
		delete: 'حذف',
		modulePrefix: 'ماژول',
		selectModuleToCreateEntries: 'برای ساخت ورودی، یک ماژول انتخاب کنید.',
		richBold: 'پررنگ',
		richItalic: 'ایتالیک',
		richStrike: 'خط‌خورده',
		richCode: 'کد درون‌خطی',
		richHeading2: 'تیتر 2',
		richHeading3: 'تیتر 3',
		richBullet: 'لیست بولت‌دار',
		richOrdered: 'لیست شماره‌دار',
		richQuote: 'نقل قول',
		richLink: 'لینک',
		richUploadImage: 'آپلود تصویر به S3',
		richImageButton: 'تصویر',
		startWritingPlaceholder: 'شروع به نوشتن کنید…',
		promptLinkUrl: 'آدرس لینک',
		imageUploadFailed: 'آپلود تصویر ناموفق بود',
		noticeS3Saved: 'تنظیمات S3 در این مرورگر ذخیره شد.',
		noticeFieldIdLabelRequired: 'شناسه و برچسب فیلد الزامی است.',
		noticeInvalidFieldType: 'نوع فیلد نامعتبر است.',
		noticeFieldExists: "فیلدی با شناسه '{id}' از قبل وجود دارد.",
		noticeFieldAdded: "فیلد '{id}' اضافه شد.",
		noticeFieldListCleared: 'لیست فیلدها پاک شد.',
		noticeModuleIdNameRequired: 'شناسه و نام ماژول الزامی است.',
		noticeModuleNeedsField: 'هر ماژول باید حداقل یک فیلد داشته باشد.',
		noticeModuleExists: "ماژول '{id}' از قبل وجود دارد.",
		noticeModuleSaved: "ماژول '{id}' ذخیره شد.",
		noticePasteJsonFirst: 'ابتدا JSON را وارد کنید.',
		noticeImportedWorkspace: 'ورک‌اسپیس وارد شد: {count} ماژول.',
		noticeImportedModule: "ماژول '{id}' وارد شد (و S3 در صورت وجود).",
		noticeImportedModules: '{count} ماژول وارد شد.',
		noticeInvalidJson: 'JSON نامعتبر است.',
		noticeWorkspaceLoadedInBox: 'JSON ورک‌اسپیس (ماژول‌ها + S3) داخل باکس قرار گرفت.',
		noticeModuleNotFound: 'ماژول پیدا نشد.',
		noticeEditingModule: "در حال ویرایش ماژول '{id}'.",
		noticeModuleDeleted: "ماژول '{id}' حذف شد.",
		noticeModuleLoadedInBox: "ماژول '{id}' + S3 در باکس JSON قرار گرفت.",
		noticeEntryDeleted: "ورودی '{id}' حذف شد.",
		noticeSelectModuleFirst: 'ابتدا یک ماژول انتخاب کنید.',
		noticeEntryTitleRequired: 'عنوان ورودی الزامی است.',
		noticeFieldNeedsFile: 'فیلد "{label}" به فایل نیاز دارد.',
		noticeCouldNotReadFile: 'خواندن فایل برای "{label}" ممکن نبود.',
		noticeFieldRequired: 'فیلد "{label}" الزامی است.',
		noticeEntryAdded: "ورودی '{id}' اضافه شد.",
		noticeCannotPublishNoModule: 'بدون حداقل یک ماژول نمی‌توان منتشر کرد.',
		noticeBuildingFinalJson: 'در حال ساخت JSON نهایی...',
		noticeFinalJsonOffline: 'JSON نهایی با موفقیت ساخته شد (حالت آفلاین).',
		noticePublishFailed: 'انتشار ناموفق بود',
		noticePublishedAndUploaded: 'منتشر و در S3 آپلود شد: {uri}',
		noticeFinalJsonSuccess: 'JSON نهایی با موفقیت ساخته شد.',
		noticeLocalDataCleared: 'داده‌های محلی پاک شد.',
	},
};

function uiText(): UIStrings {
	return {
		...(UI_TEXT.en as UIStrings),
		...(UI_TEXT[currentLanguage] ?? {}),
	} as UIStrings;
}

function tUi(key: keyof UIStrings, params?: Record<string, string | number>): string {
	const template = uiText()[key];
	if (!params) return template;
	return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), template);
}

init();

function init() {
	initStartupSplash();
	initThemeToggle();
	initSidebarDrawer();
	initI18n();
	seedFieldTypeOptions();
	loadState();
	loadS3SettingsForm();
	bindEvents();
	renderAll();
	initWizard();
	setNotice(I18N_TEXT[currentLanguage].readyNotice, 'info');
}

function initStartupSplash() {
	const splash = document.getElementById('startup-splash') as HTMLDivElement | null;
	const title = document.getElementById('startup-splash-title') as HTMLHeadingElement | null;
	if (!splash || !title) return;

	const word = 'Jexon';
	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const finishSplash = () => {
		splash.classList.add('is-exiting');
		window.setTimeout(() => {
			splash.remove();
		}, 420);
	};

	if (prefersReducedMotion) {
		title.textContent = word;
		splash.classList.add('is-subtitle-visible');
		window.setTimeout(finishSplash, 500);
		return;
	}

	title.textContent = '';
	let index = 0;

	const typeNextChar = () => {
		index += 1;
		title.textContent = word.slice(0, index);
		if (index < word.length) {
			window.setTimeout(typeNextChar, 120);
			return;
		}
		splash.classList.add('is-subtitle-visible');
		window.setTimeout(finishSplash, 700);
	};

	window.setTimeout(typeNextChar, 180);
}

function initI18n() {
	const select = document.getElementById('language-select') as HTMLSelectElement | null;
	const picker = document.getElementById('language-picker') as HTMLDivElement | null;
	let lang: SupportedLang = 'en';
	try {
		const stored = localStorage.getItem(STORAGE_LANG_KEY) as SupportedLang | null;
		if (stored && I18N_TEXT[stored]) {
			lang = stored;
		}
	} catch {
		/* ignore */
	}
	applyLanguage(lang);
	if (!select) {
		return;
	}
	setupCustomLanguagePicker(select, picker);
	select.value = lang;
	select.addEventListener('change', () => {
		const next = select.value as SupportedLang;
		if (!I18N_TEXT[next]) {
			return;
		}
		try {
			localStorage.setItem(STORAGE_LANG_KEY, next);
		} catch {
			/* ignore */
		}
		applyLanguage(next);
	});
}

function setupCustomLanguagePicker(select: HTMLSelectElement, picker: HTMLDivElement | null) {
	if (!picker) return;
	document.body.classList.add('lang-picker-enhanced');
	const trigger = picker.querySelector<HTMLButtonElement>('.topbar-lang-picker__trigger');
	const current = picker.querySelector<HTMLElement>('[data-lang-current]');
	const options = Array.from(picker.querySelectorAll<HTMLButtonElement>('[data-lang-option]'));
	if (!trigger || !current || !options.length) return;

	const sync = () => {
		current.textContent = select.value.toUpperCase();
		options.forEach((btn) => {
			const active = btn.dataset.langOption === select.value;
			btn.classList.toggle('is-active', active);
			btn.setAttribute('aria-selected', active ? 'true' : 'false');
		});
	};

	const close = () => {
		picker.classList.remove('is-open');
		trigger.setAttribute('aria-expanded', 'false');
	};

	const open = () => {
		picker.classList.add('is-open');
		trigger.setAttribute('aria-expanded', 'true');
	};

	trigger.addEventListener('click', () => {
		if (picker.classList.contains('is-open')) close();
		else open();
	});

	options.forEach((btn) => {
		btn.addEventListener('click', () => {
			const next = btn.dataset.langOption as SupportedLang | undefined;
			if (!next || next === select.value) {
				close();
				return;
			}
			select.value = next;
			select.dispatchEvent(new Event('change', { bubbles: true }));
			sync();
			close();
		});
	});

	document.addEventListener('click', (event) => {
		if (!picker.contains(event.target as Node)) close();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') close();
	});

	select.addEventListener('change', sync);
	sync();
}

function applyLanguage(lang: SupportedLang) {
	currentLanguage = lang;
	const t = I18N_TEXT[lang];
	const u = uiText();
	const isRtl = lang === 'ar' || lang === 'fa';
	document.documentElement.setAttribute('lang', lang);
	document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
	document.body.classList.toggle('is-rtl', isRtl);

	setText('#topbar-about-link', t.about);
	const stepLabels = document.querySelectorAll('.wizard-stepper__item .wizard-stepper__label');
	if (stepLabels[0]) stepLabels[0].textContent = t.stepStart;
	if (stepLabels[1]) stepLabels[1].textContent = t.stepModules;
	if (stepLabels[2]) stepLabels[2].textContent = t.stepEntries;
	if (stepLabels[3]) stepLabels[3].textContent = t.stepPublish;
	setText('#wizard-hero .hero-badge', t.heroBadge);
	setText('#wizard-hero h1', t.heroTitle);
	setText('.start-panel__title', t.startTitle);
	setText('.start-panel__lead', t.startLead);
	setText('#start-import-btn .start-choice-card__title', t.importTitle);
	setText('#start-import-btn .start-choice-card__desc', t.importDesc);
	setText('#start-scratch-btn .start-choice-card__title', t.newTitle);
	setText('#start-scratch-btn .start-choice-card__desc', t.newDesc);
	setSectionTitle('#section-modules h2', '2', t.modulesTitle);
	setText('#section-modules > p', t.modulesIntro);
	setText('#mode-import-btn', t.modeImport);
	setText('#mode-scratch-btn', t.modeScratch);
	setText('#mode-import-panel h3', t.importPanelTitle);
	setText('#mode-import-panel .muted', t.importPanelLead);
	setText('label[for="module-import"] span', t.pasteJson);
	setPlaceholder('#module-import', u.moduleImportPlaceholder);
	setText('#import-module-btn', t.importButton);
	setText('#export-workspace-btn', t.exportButton);
	setText('#export-workspace-btn-scratch', t.exportButton);
	setText('#mode-scratch-panel h3:first-of-type', t.scratchPanelTitle);
	setText('#mode-scratch-panel h3:nth-of-type(2)', t.fieldDraft);
	setText('#mode-scratch-panel h3:nth-of-type(3)', t.s3Settings);
	setText('label[for="module-id"] span', u.moduleId);
	setText('label[for="module-name"] span', u.moduleName);
	setText('label[for="module-description"] span', u.description);
	setPlaceholder('#module-id', u.moduleIdPlaceholder);
	setPlaceholder('#module-name', u.moduleNamePlaceholder);
	setPlaceholder('#module-description', u.moduleDescriptionPlaceholder);
	setText('label[for="field-id"] span', u.fieldId);
	setText('label[for="field-label"] span', u.fieldLabel);
	setText('label[for="field-type"] span', u.fieldType);
	setText('label[for="field-help"] span', u.helpTextOptional);
	setPlaceholder('#field-id', u.fieldIdPlaceholder);
	setPlaceholder('#field-label', u.fieldLabelPlaceholder);
	setPlaceholder('#field-help', u.fieldHelpPlaceholder);
	setText('label[for="field-required"] span', u.required);
	setText('#add-field-btn', u.addField);
	setText('#clear-fields-btn', u.clearFields);
	setText('#save-module-btn', u.saveModule);
	setText('#reset-module-btn', u.resetForm);
	setText('#mode-scratch-panel .muted', u.s3UsedLead);
	setText('#import-details-block summary', u.s3Credentials);
	setText('label[for="settings-s3-bucket"] span', u.bucket);
	setText('label[for="settings-s3-region"] span', u.region);
	setText('label[for="settings-s3-access-key"] span', u.accessKeyId);
	setText('label[for="settings-s3-secret-key"] span', u.secretAccessKey);
	setText('label[for="settings-s3-endpoint"] span', u.endpointOptional);
	setText('label[for="settings-s3-public-base-url"] span', u.publicBaseUrlOptional);
	setText('label[for="settings-s3-force-path-style"] span', u.forcePathStyle);
	setText('label[for="settings-upload-asset-files"] span', u.uploadFilesToS3);
	setText('#save-s3-settings-btn', u.saveS3Local);
	setPlaceholder('#entry-title', u.entryTitlePlaceholder);
	setText('#section-modules > h3', t.savedModules);
	setText('label[for="module-sort-select"] span', u.sortLabel);
	setText('#module-sort-newest', u.sortNewest);
	setText('#module-sort-oldest', u.sortOldest);
	setText('#module-sort-name-asc', u.sortNameAsc);
	setText('#module-sort-name-desc', u.sortNameDesc);
	setText('[data-wizard-back]:nth-of-type(1)', t.backStart);
	setText('[data-wizard-next="2"]', t.continueEntries);
	setSectionTitle('#section-entries h2', '3', t.entriesTitle);
	setText('#section-entries > p', t.entriesIntro);
	setText('label[for="entry-module-select"] span', t.selectModule);
	setText('label[for="entry-title"] span', t.entryTitle);
	setText('#add-entry-btn', t.addEntry);
	setText('#section-entries > h3', t.savedEntries);
	setText('label[for="entry-sort-select"] span', u.sortLabel);
	setText('#entry-sort-newest', u.sortNewest);
	setText('#entry-sort-oldest', u.sortOldest);
	setText('#entry-sort-title-asc', u.sortTitleAsc);
	setText('#entry-sort-title-desc', u.sortTitleDesc);
	setText('#section-entries [data-wizard-back]', t.backModules);
	setText('#section-entries [data-wizard-next]', t.continuePublish);
	setSectionTitle('#section-publish h2', '4', t.publishTitle);
	setText('#section-publish > p', t.publishIntro);
	setText('label[for="publish-upload-s3"] span', t.uploadBundle);
	setText('label[for="publish-s3-prefix"] span', t.s3Prefix);
	setText('#publish-btn', t.buildFinalJson);
	setText('#clear-storage-btn', t.clearLocalData);
	setText('label[for="publish-output"] span', t.publishedJson);
	setText('#section-publish [data-wizard-back]', t.backEntries);
	setFooterPowered(t.poweredBy);
	renderAll();
}

function setFooterPowered(prefix: string) {
	const el = document.getElementById('footer-powered');
	if (!el) return;
	const first = el.childNodes[0];
	if (first && first.nodeType === Node.TEXT_NODE) {
		first.nodeValue = `${prefix} `;
	}
}

function setSectionTitle(selector: string, step: string, label: string) {
	const title = document.querySelector(selector);
	if (!title) return;
	title.innerHTML = `<span class="step">${escapeHtml(step)}</span> ${escapeHtml(label)}`;
}

function setText(selector: string, value: string) {
	const el = document.querySelector(selector);
	if (!el) return;
	el.textContent = value;
}

function setPlaceholder(selector: string, value: string) {
	const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
	if (!el) return;
	el.placeholder = value;
}

function initThemeToggle() {
	const btn = document.getElementById('theme-toggle');
	if (!btn) {
		return;
	}
	btn.addEventListener('click', () => {
		const root = document.documentElement;
		const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
		const next = current === 'dark' ? 'light' : 'dark';
		root.setAttribute('data-theme', next);
		root.style.setProperty('color-scheme', next);
		try {
			localStorage.setItem(STORAGE_THEME_KEY, next);
		} catch {
			/* ignore */
		}
	});
}

function initSidebarDrawer() {
	const shell = document.getElementById('app-shell');
	const toggle = document.getElementById('nav-drawer-toggle');
	const backdrop = document.getElementById('sidebar-backdrop');
	if (!shell || !toggle) {
		return;
	}

	const close = () => {
		shell.classList.remove('sidebar-open');
		document.body.classList.remove('sidebar-open');
		toggle.setAttribute('aria-expanded', 'false');
		toggle.setAttribute('aria-label', 'Open navigation');
	};

	const open = () => {
		shell.classList.add('sidebar-open');
		document.body.classList.add('sidebar-open');
		toggle.setAttribute('aria-expanded', 'true');
		toggle.setAttribute('aria-label', 'Close navigation');
	};

	toggle.addEventListener('click', () => {
		if (shell.classList.contains('sidebar-open')) {
			close();
		} else {
			open();
		}
	});

	backdrop?.addEventListener('click', close);

	shell.querySelectorAll('[data-wizard-goto]').forEach((el) => {
		el.addEventListener('click', () => {
			if (window.matchMedia('(max-width: 899px)').matches) {
				close();
			}
		});
	});
}

function refreshEntryFieldsIfActive(): void {
	if (currentWizardStep === 2) {
		renderEntryFields();
	}
}

function setStartMode(mode: 'import' | 'scratch', persist = true): void {
	currentStartMode = mode;
	const importPanel = document.getElementById('mode-import-panel');
	const scratchPanel = document.getElementById('mode-scratch-panel');
	if (importPanel) {
		importPanel.hidden = mode !== 'import';
	}
	if (scratchPanel) {
		scratchPanel.hidden = mode !== 'scratch';
	}
	document.querySelectorAll<HTMLButtonElement>('[data-start-mode]').forEach((btn) => {
		const isActive = btn.dataset.startMode === mode;
		btn.classList.toggle('is-active', isActive);
		btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
	});
	if (!persist) {
		return;
	}
	try {
		sessionStorage.setItem(STORAGE_START_MODE_KEY, mode);
	} catch {
		/* ignore */
	}
}

function setWizardStep(step: 0 | 1 | 2 | 3): void {
	const prev = currentWizardStep;
	if (prev === 2 && step !== 2) {
		destroyAllRichEditors();
	}
	currentWizardStep = step;
	for (let i = 0; i < 4; i++) {
		const el = document.getElementById(`wizard-panel-${i}`);
		if (el) {
			el.hidden = i !== step;
		}
	}
	const hero = document.getElementById('wizard-hero');
	if (hero) {
		hero.hidden = step !== 0;
	}

	document.querySelectorAll('[data-wizard-step]').forEach((btn) => {
		const raw = (btn as HTMLElement).dataset.wizardStep;
		const s = raw !== undefined ? Number(raw) : NaN;
		if (Number.isNaN(s) || s < 0 || s > 3) {
			return;
		}
		btn.classList.toggle('is-active', s === step);
		btn.setAttribute('aria-current', s === step ? 'step' : 'false');
	});

	document.querySelectorAll('[data-wizard-goto]').forEach((btn) => {
		const raw = (btn as HTMLElement).dataset.wizardGoto;
		const s = raw !== undefined ? Number(raw) : NaN;
		if (Number.isNaN(s) || s < 0 || s > 3) {
			return;
		}
		btn.classList.toggle('is-active', s === step);
	});

	try {
		sessionStorage.setItem(STORAGE_WIZARD_STEP_KEY, String(step));
	} catch {
		/* ignore */
	}

	if (step === 1) {
		setStartMode(currentStartMode);
	}

	if (step === 2) {
		requestAnimationFrame(() => {
			refreshEntryFieldsIfActive();
		});
	}
}

function initWizard(): void {
	document.querySelectorAll<HTMLButtonElement>('[data-wizard-step]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const s = Number(btn.dataset.wizardStep);
			if (!Number.isNaN(s) && s >= 0 && s <= 3) {
				setWizardStep(s as 0 | 1 | 2 | 3);
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>('[data-wizard-goto]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			const s = Number(btn.dataset.wizardGoto);
			if (!Number.isNaN(s) && s >= 0 && s <= 3) {
				setWizardStep(s as 0 | 1 | 2 | 3);
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>('[data-start-mode]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const mode = btn.dataset.startMode;
			if (mode === 'import' || mode === 'scratch') {
				setStartMode(mode);
			}
		});
	});

	document.getElementById('start-import-btn')?.addEventListener('click', () => {
		setStartMode('import');
		setWizardStep(1);
		moduleImportInput.focus();
	});

	document.getElementById('start-scratch-btn')?.addEventListener('click', () => {
		setStartMode('scratch');
		setWizardStep(1);
		moduleIdInput.focus();
	});

	document.querySelectorAll<HTMLButtonElement>('[data-wizard-next]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const n = Number(btn.dataset.wizardNext);
			if (!Number.isNaN(n) && n >= 0 && n <= 3) {
				setWizardStep(n as 0 | 1 | 2 | 3);
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>('[data-wizard-back]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const back: 0 | 1 | 2 =
				currentWizardStep === 1 ? 0 : currentWizardStep === 2 ? 1 : currentWizardStep === 3 ? 2 : 0;
			setWizardStep(back);
		});
	});

	let initial: 0 | 1 | 2 | 3 = 0;
	try {
		const saved = sessionStorage.getItem(STORAGE_WIZARD_STEP_KEY);
		const mode = sessionStorage.getItem(STORAGE_START_MODE_KEY);
		if (mode === 'import' || mode === 'scratch') {
			currentStartMode = mode;
			setStartMode(mode, false);
		} else {
			setStartMode('scratch', false);
		}
		if (saved && mode && (mode === 'import' || mode === 'scratch')) {
			const s = Number(saved);
			if (s >= 1 && s <= 3) {
				initial = s as 0 | 1 | 2 | 3;
			}
		}
	} catch {
		/* ignore */
	}
	if (initial === 0) {
		setStartMode(currentStartMode, false);
	}
	setWizardStep(initial);
}

function bindEvents() {
	byId<HTMLButtonElement>('add-field-btn').addEventListener('click', addFieldToDraft);
	byId<HTMLButtonElement>('clear-fields-btn').addEventListener('click', clearFieldDraft);
	draftFieldList.addEventListener('click', handleDraftFieldActions);
	fieldPresetList.addEventListener('click', handleFieldPresetClick);
	byId<HTMLButtonElement>('save-module-btn').addEventListener('click', saveModule);
	byId<HTMLButtonElement>('reset-module-btn').addEventListener('click', resetModuleForm);
	byId<HTMLButtonElement>('import-module-btn').addEventListener('click', importModulesFromJson);
	byId<HTMLButtonElement>('export-workspace-btn').addEventListener('click', exportWorkspaceToJsonBox);
	byId<HTMLButtonElement>('export-workspace-btn-scratch').addEventListener('click', exportWorkspaceToJsonBox);
	byId<HTMLButtonElement>('add-entry-btn').addEventListener('click', () => void addEntry());
	byId<HTMLButtonElement>('save-s3-settings-btn').addEventListener('click', saveS3SettingsToStorage);
	byId<HTMLButtonElement>('publish-btn').addEventListener('click', publishContent);
	byId<HTMLButtonElement>('clear-storage-btn').addEventListener('click', clearAllLocalData);
	moduleSortSelect.addEventListener('change', () => {
		moduleSortMode = moduleSortSelect.value as typeof moduleSortMode;
		renderModules();
	});
	entrySortSelect.addEventListener('change', () => {
		entrySortMode = entrySortSelect.value as typeof entrySortMode;
		renderEntries();
	});

	moduleList.addEventListener('click', handleModuleActions);
	entryList.addEventListener('click', handleEntryActions);
	entryModuleSelect.addEventListener('change', refreshEntryFieldsIfActive);
	fieldLabelInput.addEventListener('blur', () => {
		if (!fieldIdInput.value.trim()) {
			fieldIdInput.value = toId(fieldLabelInput.value);
		}
	});
	moduleNameInput.addEventListener('blur', () => {
		if (!moduleIdInput.value.trim()) {
			moduleIdInput.value = toId(moduleNameInput.value);
		}
	});
}

function seedFieldTypeOptions() {
	if (fieldTypeInput.options.length) {
		return;
	}

	for (const type of FIELD_TYPES) {
		const option = document.createElement('option');
		option.value = type;
		option.textContent = type;
		fieldTypeInput.append(option);
	}
}

function loadState() {
	modules = readStorage<FieldModule[]>(STORAGE_MODULES_KEY, []);
	entries = readStorage<DraftEntry[]>(STORAGE_ENTRIES_KEY, []);
}

function loadS3SettingsForm() {
	const stored = readStorage<StoredS3Settings>(STORAGE_S3_SETTINGS_KEY, {});
	if (stored.bucket) {
		settingsS3Bucket.value = stored.bucket;
	}
	if (stored.region) {
		settingsS3Region.value = stored.region;
	}
	if (stored.accessKeyId) {
		settingsS3AccessKey.value = stored.accessKeyId;
	}
	if (stored.secretAccessKey) {
		settingsS3SecretKey.value = stored.secretAccessKey;
	}
	if (stored.endpoint) {
		settingsS3Endpoint.value = stored.endpoint;
	}
	if (stored.publicBaseUrl) {
		settingsS3PublicBaseUrl.value = stored.publicBaseUrl;
	}
	if (typeof stored.forcePathStyle === 'boolean') {
		settingsS3ForcePathStyle.checked = stored.forcePathStyle;
	}
	if (typeof stored.uploadAssetFilesToS3 === 'boolean') {
		settingsUploadAssetFiles.checked = stored.uploadAssetFilesToS3;
	}
}

function getCurrentS3SettingsObject(): StoredS3Settings {
	return {
		bucket: settingsS3Bucket.value.trim() || undefined,
		region: settingsS3Region.value.trim() || undefined,
		accessKeyId: settingsS3AccessKey.value.trim() || undefined,
		secretAccessKey: settingsS3SecretKey.value.trim() || undefined,
		endpoint: settingsS3Endpoint.value.trim() || undefined,
		publicBaseUrl: settingsS3PublicBaseUrl.value.trim() || undefined,
		forcePathStyle: settingsS3ForcePathStyle.checked,
		uploadAssetFilesToS3: settingsUploadAssetFiles.checked,
	};
}

function applyS3SettingsToForm(stored: StoredS3Settings) {
	if (stored.bucket !== undefined) {
		settingsS3Bucket.value = stored.bucket ?? '';
	}
	if (stored.region !== undefined) {
		settingsS3Region.value = stored.region ?? '';
	}
	if (stored.accessKeyId !== undefined) {
		settingsS3AccessKey.value = stored.accessKeyId ?? '';
	}
	if (stored.secretAccessKey !== undefined) {
		settingsS3SecretKey.value = stored.secretAccessKey ?? '';
	}
	if (stored.endpoint !== undefined) {
		settingsS3Endpoint.value = stored.endpoint ?? '';
	}
	if (stored.publicBaseUrl !== undefined) {
		settingsS3PublicBaseUrl.value = stored.publicBaseUrl ?? '';
	}
	if (typeof stored.forcePathStyle === 'boolean') {
		settingsS3ForcePathStyle.checked = stored.forcePathStyle;
	}
	if (typeof stored.uploadAssetFilesToS3 === 'boolean') {
		settingsUploadAssetFiles.checked = stored.uploadAssetFilesToS3;
	}
}

function persistS3SettingsFromForm() {
	localStorage.setItem(STORAGE_S3_SETTINGS_KEY, JSON.stringify(getCurrentS3SettingsObject()));
}

function saveS3SettingsToStorage() {
	persistS3SettingsFromForm();
	setNotice(tUi('noticeS3Saved'), 'ok');
}

function s3OptionsFromForm(): NonNullable<PublishOptions['s3']> {
	return {
		bucket: settingsS3Bucket.value.trim() || undefined,
		region: settingsS3Region.value.trim() || undefined,
		accessKeyId: settingsS3AccessKey.value.trim() || undefined,
		secretAccessKey: settingsS3SecretKey.value.trim() || undefined,
		endpoint: settingsS3Endpoint.value.trim() || undefined,
		publicBaseUrl: settingsS3PublicBaseUrl.value.trim() || undefined,
		forcePathStyle: settingsS3ForcePathStyle.checked,
	};
}

function saveState() {
	localStorage.setItem(STORAGE_MODULES_KEY, JSON.stringify(modules));
	localStorage.setItem(STORAGE_ENTRIES_KEY, JSON.stringify(entries));
}

function addFieldToDraft() {
	const id = toId(fieldIdInput.value.trim() || fieldLabelInput.value.trim());
	const label = fieldLabelInput.value.trim();
	const type = fieldTypeInput.value;
	const helpText = fieldHelpInput.value.trim();
	const required = fieldRequiredInput.checked;

	if (!id || !label) {
		setNotice(tUi('noticeFieldIdLabelRequired'), 'error');
		return;
	}

	if (!isFieldType(type)) {
		setNotice(tUi('noticeInvalidFieldType'), 'error');
		return;
	}

	if (draftFields.some((field) => field.id === id)) {
		setNotice(tUi('noticeFieldExists', { id }), 'error');
		return;
	}

	draftFields.push({
		id,
		label,
		type,
		required,
		helpText: helpText || undefined,
	});

	fieldIdInput.value = '';
	fieldLabelInput.value = '';
	fieldHelpInput.value = '';
	fieldRequiredInput.checked = false;
	renderDraftFields();
	setNotice(tUi('noticeFieldAdded', { id }), 'ok');
}

function clearFieldDraft() {
	draftFields = [];
	renderDraftFields();
	setNotice(tUi('noticeFieldListCleared'), 'info');
}

function handleDraftFieldActions(event: Event) {
	const target = event.target as HTMLElement;
	const button = target.closest<HTMLButtonElement>('button[data-draft-action]');
	if (!button) {
		return;
	}
	const action = button.dataset.draftAction;
	const rawIndex = button.dataset.draftIndex;
	const index = rawIndex ? Number(rawIndex) : NaN;
	if (!action || Number.isNaN(index) || index < 0 || index >= draftFields.length) {
		return;
	}

	if (action === 'up' && index > 0) {
		const temp = draftFields[index - 1];
		draftFields[index - 1] = draftFields[index];
		draftFields[index] = temp;
		renderDraftFields();
		return;
	}

	if (action === 'down' && index < draftFields.length - 1) {
		const temp = draftFields[index + 1];
		draftFields[index + 1] = draftFields[index];
		draftFields[index] = temp;
		renderDraftFields();
	}
}

function handleFieldPresetClick(event: Event) {
	const target = event.target as HTMLElement;
	const button = target.closest<HTMLButtonElement>('button[data-field-preset]');
	if (!button) {
		return;
	}
	const presetId = button.dataset.fieldPreset as FieldPresetId | undefined;
	if (!presetId) {
		return;
	}
	applyFieldPreset(presetId);
}

function applyFieldPreset(presetId: FieldPresetId) {
	const presetFields = FIELD_PRESET_TEMPLATES.filter((item) => item.id === presetId);
	if (!presetFields.length) {
		return;
	}

	let addedCount = 0;
	for (const preset of presetFields) {
		const id = toId(preset.fieldId);
		if (!id || draftFields.some((field) => field.id === id)) {
			continue;
		}
		draftFields.push({
			id,
			label: preset.label,
			type: preset.type,
			required: Boolean(preset.required),
			helpText: preset.helpText,
		});
		addedCount += 1;
	}

	renderDraftFields();
	if (addedCount > 0) {
		setNotice(tUi('noticePresetAdded', { name: getFieldPresetLabel(presetId), count: addedCount }), 'ok');
		return;
	}
	setNotice(tUi('noticePresetAlreadyExists', { name: getFieldPresetLabel(presetId) }), 'info');
}

function getFieldPresetLabel(presetId: FieldPresetId): string {
	switch (presetId) {
		case 'blogPost':
			return tUi('templateBlogPost');
		case 'seo':
			return tUi('templateSeoPack');
		case 'product':
			return tUi('templateProduct');
		case 'faq':
			return tUi('templateFaq');
		case 'podcast':
			return tUi('templatePodcast');
		case 'landingPage':
			return tUi('templateLandingPage');
		case 'portfolio':
			return tUi('templatePortfolio');
		case 'newsArticle':
			return tUi('templateNewsArticle');
		default:
			return presetId;
	}
}

function saveModule() {
	const id = toId(moduleIdInput.value.trim() || moduleNameInput.value.trim());
	const name = moduleNameInput.value.trim();
	const description = moduleDescriptionInput.value.trim();

	if (!id || !name) {
		setNotice(tUi('noticeModuleIdNameRequired'), 'error');
		return;
	}

	if (!draftFields.length) {
		setNotice(tUi('noticeModuleNeedsField'), 'error');
		return;
	}

	const nextModule: FieldModule = {
		schemaVersion: MODULE_SCHEMA_VERSION,
		id,
		name,
		description: description || undefined,
		fields: draftFields,
	};

	if (editingModuleId) {
		const idx = modules.findIndex((module) => module.id === editingModuleId);
		if (idx >= 0) {
			modules[idx] = nextModule;
		}
	} else {
		if (modules.some((module) => module.id === id)) {
			setNotice(tUi('noticeModuleExists', { id }), 'error');
			return;
		}
		modules.push(nextModule);
	}

	entries = entries.filter((entry) => modules.some((module) => module.id === entry.moduleId));
	saveState();
	resetModuleForm();
	renderAll();
	setNotice(tUi('noticeModuleSaved', { id }), 'ok');
}

function resetModuleForm() {
	editingModuleId = null;
	moduleIdInput.value = '';
	moduleNameInput.value = '';
	moduleDescriptionInput.value = '';
	draftFields = [];
	renderDraftFields();
}

function importModulesFromJson() {
	const raw = moduleImportInput.value.trim();
	if (!raw) {
		setNotice(tUi('noticePasteJsonFirst'), 'error');
		return;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;

		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const envelope = parsed as Record<string, unknown>;

			if (envelope.schemaVersion === WORKSPACE_EXPORT_VERSION && Array.isArray(envelope.modules)) {
				const imported = (envelope.modules as unknown[]).map(parseImportedModule);
				for (const module of imported) {
					const existing = modules.findIndex((item) => item.id === module.id);
					if (existing >= 0) {
						modules[existing] = module;
					} else {
						modules.push(module);
					}
				}
				if (envelope.s3Settings && typeof envelope.s3Settings === 'object') {
					applyS3SettingsToForm(envelope.s3Settings as StoredS3Settings);
					persistS3SettingsFromForm();
				}
				entries = entries.filter((entry) => modules.some((module) => module.id === entry.moduleId));
				saveState();
				renderAll();
				setNotice(tUi('noticeImportedWorkspace', { count: imported.length }), 'ok');
				return;
			}

			if (envelope.schemaVersion === MODULE_EXPORT_WRAP_VERSION && envelope.module) {
				const module = parseImportedModule(envelope.module);
				const existing = modules.findIndex((item) => item.id === module.id);
				if (existing >= 0) {
					modules[existing] = module;
				} else {
					modules.push(module);
				}
				if (envelope.s3Settings && typeof envelope.s3Settings === 'object') {
					applyS3SettingsToForm(envelope.s3Settings as StoredS3Settings);
					persistS3SettingsFromForm();
				}
				entries = entries.filter((entry) => modules.some((m) => m.id === entry.moduleId));
				saveState();
				renderAll();
				setNotice(tUi('noticeImportedModule', { id: module.id }), 'ok');
				return;
			}
		}

		const list = Array.isArray(parsed) ? parsed : [parsed];
		const imported = list.map(parseImportedModule);

		for (const module of imported) {
			const existing = modules.findIndex((item) => item.id === module.id);
			if (existing >= 0) {
				modules[existing] = module;
			} else {
				modules.push(module);
			}
		}

		saveState();
		renderAll();
		setNotice(tUi('noticeImportedModules', { count: imported.length }), 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : tUi('noticeInvalidJson');
		setNotice(message, 'error');
	}
}

function exportWorkspaceToJsonBox() {
	const payload = {
		schemaVersion: WORKSPACE_EXPORT_VERSION,
		modules,
		s3Settings: getCurrentS3SettingsObject(),
	};
	moduleImportInput.value = JSON.stringify(payload, null, 2);
	setNotice(tUi('noticeWorkspaceLoadedInBox'), 'ok');
}

function parseImportedModule(value: unknown): FieldModule {
	if (!value || typeof value !== 'object') {
		throw new Error('Invalid module structure.');
	}

	const maybe = value as Record<string, unknown>;
	if (maybe.schemaVersion !== MODULE_SCHEMA_VERSION) {
		throw new Error(`schemaVersion must be '${MODULE_SCHEMA_VERSION}'.`);
	}

	const id = toId(String(maybe.id ?? ''));
	const name = String(maybe.name ?? '').trim();
	const fieldsRaw = maybe.fields;
	if (!id || !name || !Array.isArray(fieldsRaw)) {
		throw new Error('Imported module is missing required fields (id, name, fields).');
	}

	const fields: FieldDefinition[] = fieldsRaw.map((field) => {
		if (!field || typeof field !== 'object') {
			throw new Error('Invalid imported field structure.');
		}
		const maybeField = field as Record<string, unknown>;
		const fieldId = toId(String(maybeField.id ?? ''));
		const fieldLabel = String(maybeField.label ?? '').trim();
		const fieldType = String(maybeField.type ?? '').trim();

		if (!fieldId || !fieldLabel || !isFieldType(fieldType)) {
			throw new Error(`Invalid field '${fieldId || '[missing]'}'.`);
		}

		return {
			id: fieldId,
			label: fieldLabel,
			type: fieldType,
			required: Boolean(maybeField.required),
			helpText: typeof maybeField.helpText === 'string' ? maybeField.helpText : undefined,
		};
	});

	return {
		schemaVersion: MODULE_SCHEMA_VERSION,
		id,
		name,
		description: typeof maybe.description === 'string' ? maybe.description : undefined,
		fields,
	};
}

function handleModuleActions(event: Event) {
	const target = event.target as HTMLElement;
	const button = target.closest<HTMLButtonElement>('button[data-action]');
	if (!button) {
		return;
	}

	const action = button.dataset.action;
	const moduleId = button.dataset.moduleId;
	if (!action || !moduleId) {
		return;
	}

	const module = modules.find((item) => item.id === moduleId);
	if (!module) {
		setNotice(tUi('noticeModuleNotFound'), 'error');
		return;
	}

	if (action === 'edit') {
		editingModuleId = module.id;
		moduleIdInput.value = module.id;
		moduleNameInput.value = module.name;
		moduleDescriptionInput.value = module.description ?? '';
		draftFields = [...module.fields];
		renderDraftFields();
		setNotice(tUi('noticeEditingModule', { id: module.id }), 'info');
		return;
	}

	if (action === 'delete') {
		modules = modules.filter((item) => item.id !== moduleId);
		entries = entries.filter((entry) => entry.moduleId !== moduleId);
		saveState();
		renderAll();
		setNotice(tUi('noticeModuleDeleted', { id: moduleId }), 'ok');
		return;
	}

	if (action === 'export') {
		const payload = {
			schemaVersion: MODULE_EXPORT_WRAP_VERSION,
			module,
			s3Settings: getCurrentS3SettingsObject(),
		};
		moduleImportInput.value = JSON.stringify(payload, null, 2);
		setNotice(tUi('noticeModuleLoadedInBox', { id: moduleId }), 'ok');
	}
}

function handleEntryActions(event: Event) {
	const target = event.target as HTMLElement;
	const button = target.closest<HTMLButtonElement>('button[data-entry-action]');
	if (!button) {
		return;
	}

	const action = button.dataset.entryAction;
	const entryId = button.dataset.entryId;
	if (action !== 'delete' || !entryId) {
		return;
	}

	entries = entries.filter((entry) => entry.id !== entryId);
	saveState();
	renderEntries();
	setNotice(tUi('noticeEntryDeleted', { id: entryId }), 'ok');
}

async function addEntry() {
	const module = getSelectedModule();
	if (!module) {
		setNotice(tUi('noticeSelectModuleFirst'), 'error');
		return;
	}

	const title = entryTitleInput.value.trim();
	if (!title) {
		setNotice(tUi('noticeEntryTitleRequired'), 'error');
		return;
	}

	const values: Record<string, unknown> = {};
	for (const field of module.fields) {
		const inputId = `entry-field-${field.id}`;

		if (field.type === 'file') {
			const input = document.getElementById(inputId) as HTMLInputElement | null;
			const file = input?.files?.[0];
			if (!file) {
				if (field.required) {
					setNotice(tUi('noticeFieldNeedsFile', { label: field.label }), 'error');
					return;
				}
				values[field.id] = null;
				continue;
			}
			try {
				values[field.id] = await readFilePayload(file);
			} catch {
				setNotice(tUi('noticeCouldNotReadFile', { label: field.label }), 'error');
				return;
			}
			continue;
		}

		if (field.type === 'richText') {
			const store = document.getElementById(inputId) as HTMLTextAreaElement | null;
			if (!store) {
				continue;
			}
			const md = store.value.trim();
			if (!md && field.required) {
				setNotice(tUi('noticeFieldRequired', { label: field.label }), 'error');
				return;
			}
			values[field.id] = store.value;
			continue;
		}

		const input = document.getElementById(inputId) as HTMLInputElement | HTMLTextAreaElement | null;
		if (!input) {
			continue;
		}

		switch (field.type) {
			case 'boolean': {
				values[field.id] = (input as HTMLInputElement).checked;
				break;
			}
			case 'number': {
				const raw = input.value.trim();
				values[field.id] = raw === '' ? null : Number(raw);
				break;
			}
			default: {
				values[field.id] = input.value;
				break;
			}
		}
	}

	const id = `${module.id}-${Date.now()}`;
	entries.unshift({
		id,
		moduleId: module.id,
		title,
		values,
	});

	saveState();
	renderEntries();
	entryTitleInput.value = '';
	refreshEntryFieldsIfActive();
	setNotice(tUi('noticeEntryAdded', { id }), 'ok');
}

function readFilePayload(file: File): Promise<{ fileName: string; mimeType: string; size: number; dataBase64: string }> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error('Unexpected FileReader result'));
				return;
			}
			const base64 = result.includes(',') ? (result.split(',').pop() ?? '') : result;
			resolve({
				fileName: file.name,
				mimeType: file.type || 'application/octet-stream',
				size: file.size,
				dataBase64: base64,
			});
		};
		reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
		reader.readAsDataURL(file);
	});
}

async function publishContent() {
	if (!modules.length) {
		setNotice(tUi('noticeCannotPublishNoModule'), 'error');
		return;
	}

	const payload = {
		modules,
		entries,
		options: {
			uploadToS3: s3Toggle.checked,
			uploadAssetFilesToS3: settingsUploadAssetFiles.checked,
			s3KeyPrefix: s3PrefixInput.value.trim() || 'published',
			s3: s3OptionsFromForm(),
		},
	};

	setNotice(tUi('noticeBuildingFinalJson'), 'info');

	const networkNeeded = requiresNetworkForPublish(payload.options, payload.modules, payload.entries);
	if (networkNeeded && !navigator.onLine) {
		setNotice(NETWORK_REQUIRED_MESSAGE, 'error');
		return;
	}

	try {
		const result = await buildBundleForPublish(payload.modules, payload.entries, payload.options);
		publishOutput.value = JSON.stringify(result.bundle, null, 2);
		if (result.uploadUri) {
			setNotice(tUi('noticePublishedAndUploaded', { uri: result.uploadUri }), 'ok');
		} else if (!networkNeeded) {
			setNotice(tUi('noticeFinalJsonOffline'), 'ok');
		} else {
			setNotice(tUi('noticeFinalJsonSuccess'), 'ok');
		}
	} catch (error) {
		const message =
			!navigator.onLine ? NETWORK_REQUIRED_MESSAGE : error instanceof Error ? error.message : tUi('noticePublishFailed');
		setNotice(message, 'error');
	}
}

function requiresNetworkForPublish(
	options: { uploadToS3?: boolean; uploadAssetFilesToS3?: boolean },
	modulesInput: FieldModule[],
	entriesInput: DraftEntry[],
): boolean {
	if (options.uploadToS3) {
		return true;
	}
	if (!options.uploadAssetFilesToS3) {
		return false;
	}
	return hasPendingFileUploads(modulesInput, entriesInput);
}

function hasPendingFileUploads(modulesInput: FieldModule[], entriesInput: DraftEntry[]): boolean {
	const fieldsByModule = new Map<string, FieldDefinition[]>();
	for (const module of modulesInput) {
		fieldsByModule.set(
			module.id,
			module.fields.filter((field) => field.type === 'file'),
		);
	}
	for (const entry of entriesInput) {
		const fileFields = fieldsByModule.get(entry.moduleId) ?? [];
		for (const field of fileFields) {
			const value = entry.values[field.id];
			if (!value || typeof value !== 'object' || typeof value === 'string') {
				continue;
			}
			const dataBase64 = readString((value as Record<string, unknown>).dataBase64);
			if (dataBase64) {
				return true;
			}
		}
	}
	return false;
}

type PublishBuildResult = {
	bundle: ContentBundle;
	uploadUri?: string;
};

async function buildBundleForPublish(
	modulesInput: FieldModule[],
	entriesInput: DraftEntry[],
	options: PublishOptions,
): Promise<PublishBuildResult> {
	ensureValidModulesForLocalPublish(modulesInput);
	const now = new Date().toISOString();
	const uploadAssetFilesToS3 = options.uploadAssetFilesToS3 !== false;
	const assetUploadContext = uploadAssetFilesToS3 ? createS3UploadContextOrNull(options) : null;
	const bundleUploadContext = options.uploadToS3 ? createS3UploadContext(options) : null;
	const normalizedEntries = [];

	for (const entry of entriesInput) {
		normalizedEntries.push(
			await normalizeEntryForLocalPublish(entry, modulesInput, now, {
				assetUploadContext,
				uploadAssetFilesToS3,
			}),
		);
	}

	const bundle: ContentBundle = {
		bundleVersion: CONTENT_BUNDLE_VERSION,
		generatedAt: now,
		modules: modulesInput,
		entries: normalizedEntries,
	};

	let uploadUri: string | undefined;
	if (bundleUploadContext) {
		const uploaded = await uploadBundleToS3(bundle, bundleUploadContext);
		uploadUri = uploaded.uri;
	}

	return { bundle, uploadUri };
}

function ensureValidModulesForLocalPublish(modulesInput: FieldModule[]): void {
	const moduleIds = new Set<string>();
	for (const module of modulesInput) {
		if (moduleIds.has(module.id)) {
			throw new Error(`Duplicate module id detected: ${module.id}`);
		}
		moduleIds.add(module.id);
		const fieldIds = new Set<string>();
		for (const field of module.fields) {
			if (fieldIds.has(field.id)) {
				throw new Error(`Duplicate field id '${field.id}' in module '${module.id}'`);
			}
			fieldIds.add(field.id);
		}
	}
}

async function normalizeEntryForLocalPublish(
	entry: DraftEntry,
	modulesInput: FieldModule[],
	publishedAt: string,
	options: {
		assetUploadContext: S3UploadContext | null;
		uploadAssetFilesToS3: boolean;
	},
) {
	const selectedModule = modulesInput.find((module) => module.id === entry.moduleId);
	if (!selectedModule) {
		throw new Error(`Entry '${entry.id}' references missing module '${entry.moduleId}'`);
	}
	const values: Record<string, unknown> = {};
	for (const field of selectedModule.fields) {
		values[field.id] = await normalizeFieldValueForLocalPublish(field, entry.values[field.id], entry.id, options);
	}
	return {
		id: entry.id,
		title: entry.title,
		moduleId: entry.moduleId,
		publishedAt,
		values,
	};
}

async function normalizeFieldValueForLocalPublish(
	field: FieldDefinition,
	rawValue: unknown,
	entryId: string,
	options: {
		assetUploadContext: S3UploadContext | null;
		uploadAssetFilesToS3: boolean;
	},
): Promise<unknown> {
	if (isMissingForLocalPublish(rawValue)) {
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
			try {
				return new URL(trimmed).toString();
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
			if (typeof rawValue === 'boolean') return rawValue;
			if (rawValue === 'true') return true;
			if (rawValue === 'false') return false;
			throw new Error(`Field '${field.id}' must be boolean`);
		}
		case 'date': {
			if (typeof rawValue !== 'string') {
				throw new Error(`Field '${field.id}' must be a date string`);
			}
			const parsed = new Date(rawValue.trim());
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
			return normalizeFileFieldForLocalPublish(field, rawValue, entryId, options);
		}
		default: {
			const neverType: never = field.type as never;
			throw new Error(`Unsupported field type for '${String(neverType)}'`);
		}
	}
}

async function normalizeFileFieldForLocalPublish(
	field: FieldDefinition,
	rawValue: unknown,
	entryId: string,
	options: {
		assetUploadContext: S3UploadContext | null;
		uploadAssetFilesToS3: boolean;
	},
): Promise<unknown> {
	if (typeof rawValue === 'string') {
		const trimmed = rawValue.trim();
		if (!trimmed) {
			if (field.required) throw new Error(`Field '${field.id}' is required`);
			return null;
		}
		try {
			return { url: new URL(trimmed).toString() };
		} catch {
			throw new Error(`File field '${field.id}' must be a valid URL or a file payload object`);
		}
	}
	if (!rawValue || typeof rawValue !== 'object') {
		throw new Error(`Field '${field.id}' must be a file payload object`);
	}
	const file = rawValue as Record<string, unknown>;
	const fileName = sanitizeFileName(readString(file.fileName) ?? `${field.id}.bin`);
	const mimeType = (readString(file.mimeType) ?? 'application/octet-stream').trim() || 'application/octet-stream';
	const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : undefined;
	const dataBase64 = (readString(file.dataBase64) ?? '').trim();
	const url = readString(file.url);
	const key = readString(file.key);
	const uri = readString(file.uri);
	if (!dataBase64) {
		if (url || key || uri) {
			return { fileName, mimeType, size, url, key, uri };
		}
		if (field.required) throw new Error(`Field '${field.id}' is required`);
		return null;
	}

	if (options.uploadAssetFilesToS3 && !options.assetUploadContext) {
		throw new Error(
			`Field '${field.id}' requires S3 settings (bucket, region, access keys) to upload files. Configure them in Settings.`,
		);
	}

	if (!options.assetUploadContext) {
		return {
			fileName,
			mimeType,
			size,
			dataBase64,
		};
	}

	const keyForUpload = buildFileObjectKey(options.assetUploadContext.prefix, entryId, field.id, fileName);
	const bytes = decodeBase64(dataBase64, field.id);
	await uploadBytes(
		options.assetUploadContext,
		keyForUpload,
		bytes,
		mimeType,
		{ aclPublic: true },
	);

	const result: Record<string, unknown> = {
		fileName,
		mimeType,
		size: size ?? bytes.byteLength,
		key: keyForUpload,
		uri: `s3://${options.assetUploadContext.bucket}/${keyForUpload}`,
	};
	const resolvedUrl = options.assetUploadContext.resolvePublicUrl(keyForUpload);
	if (resolvedUrl) {
		result.url = resolvedUrl;
	}
	return result;
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isMissingForLocalPublish(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === 'string') return value.trim().length === 0;
	return false;
}

function clearAllLocalData() {
	localStorage.removeItem(STORAGE_MODULES_KEY);
	localStorage.removeItem(STORAGE_ENTRIES_KEY);
	modules = [];
	entries = [];
	resetModuleForm();
	try {
		sessionStorage.removeItem(STORAGE_WIZARD_STEP_KEY);
		sessionStorage.removeItem(STORAGE_START_MODE_KEY);
	} catch {
		/* ignore */
	}
	renderAll();
	setWizardStep(0);
	publishOutput.value = '';
	setNotice(tUi('noticeLocalDataCleared'), 'info');
}

function renderAll() {
	renderFieldPresetButtons();
	renderDraftFields();
	renderModules();
	renderEntries();
	refreshEntryFieldsIfActive();
}

function renderFieldPresetButtons() {
	const presets: FieldPresetId[] = [
		'blogPost',
		'seo',
		'product',
		'faq',
		'podcast',
		'landingPage',
		'portfolio',
		'newsArticle',
	];
	const buttons = presets
		.map(
			(preset) =>
				`<button type="button" class="btn--outline preset-template-btn" data-field-preset="${escapeHtml(preset)}">+ ${escapeHtml(getFieldPresetLabel(preset))}</button>`,
		)
		.join('');
	fieldPresetList.innerHTML = `
		<p class="preset-template-label">${escapeHtml(tUi('fieldTemplatesTitle'))}</p>
		<div class="preset-template-actions">${buttons}</div>
	`;
}

function renderDraftFields() {
	const u = uiText();
	if (!draftFields.length) {
		draftFieldList.innerHTML = `<p class="muted">${escapeHtml(u.noFieldsAddedYet)}</p>`;
		return;
	}

	draftFieldList.innerHTML = draftFields
		.map(
			(field, index) => `
			<div class="chip">
				<div class="chip-row">
					<strong>${escapeHtml(field.id)}</strong>
					<div class="chip-actions">
						<button type="button" class="chip-move-btn" data-draft-action="up" data-draft-index="${index}" aria-label="Move up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
						<button type="button" class="chip-move-btn" data-draft-action="down" data-draft-index="${index}" aria-label="Move down" title="Move down" ${index === draftFields.length - 1 ? 'disabled' : ''}>↓</button>
					</div>
				</div>
				<span>${escapeHtml(field.label)}</span>
				<small>${escapeHtml(field.type)}${field.required ? ` - ${escapeHtml(u.required.toLowerCase())}` : ''}</small>
			</div>
		`,
		)
		.join('');
}

function renderModules() {
	const u = uiText();
	moduleSortSelect.value = moduleSortMode;
	if (!modules.length) {
		moduleList.innerHTML = `<p class="muted">${escapeHtml(u.noModulesSaved)}</p>`;
		entryModuleSelect.innerHTML = `<option value="">${escapeHtml(u.noModulesAvailable)}</option>`;
		return;
	}

	const visibleModules = sortModulesForView(modules, moduleSortMode);
	moduleList.innerHTML = visibleModules
		.map(
			(module) => `
			<article class="card">
				<header>
					<h3>${escapeHtml(module.name)}</h3>
					<code>${escapeHtml(module.id)}</code>
				</header>
				<p>${escapeHtml(module.description ?? u.noDescription)}</p>
				<p class="muted">${escapeHtml(tUi('fieldCount', { count: module.fields.length }))}</p>
				<div class="row gap-sm">
					<button type="button" class="btn--ghost" data-action="edit" data-module-id="${escapeHtml(module.id)}">${escapeHtml(u.edit)}</button>
					<button type="button" class="btn--outline" data-action="export" data-module-id="${escapeHtml(module.id)}">${escapeHtml(u.exportJson)}</button>
					<button type="button" class="btn--danger" data-action="delete" data-module-id="${escapeHtml(module.id)}">${escapeHtml(u.delete)}</button>
				</div>
			</article>
		`,
		)
		.join('');

	const selected = entryModuleSelect.value;
	entryModuleSelect.innerHTML = [
		`<option value="">${escapeHtml(u.selectModuleOption)}</option>`,
		...modules.map((module) => `<option value="${escapeHtml(module.id)}">${escapeHtml(module.name)} (${escapeHtml(module.id)})</option>`),
	].join('');

	if (modules.some((module) => module.id === selected)) {
		entryModuleSelect.value = selected;
	} else {
		entryModuleSelect.value = modules[0]?.id ?? '';
	}
}

function sortModulesForView(
	modulesInput: FieldModule[],
	mode: 'newest' | 'oldest' | 'name-asc' | 'name-desc',
): FieldModule[] {
	const list = [...modulesInput];
	switch (mode) {
		case 'oldest':
			return list.reverse();
		case 'name-asc':
			return list.sort((a, b) => a.name.localeCompare(b.name));
		case 'name-desc':
			return list.sort((a, b) => b.name.localeCompare(a.name));
		case 'newest':
		default:
			return list;
	}
}

function renderEntries() {
	const u = uiText();
	entrySortSelect.value = entrySortMode;
	if (!entries.length) {
		entryList.innerHTML = `<p class="muted">${escapeHtml(u.noEntriesSavedYet)}</p>`;
		return;
	}

	const visibleEntries = sortEntriesForView(entries, entrySortMode);
	entryList.innerHTML = visibleEntries
		.map(
			(entry) => `
			<article class="card slim">
				<header>
					<h4>${escapeHtml(entry.title)}</h4>
					<code>${escapeHtml(entry.id)}</code>
				</header>
				<p class="muted">${escapeHtml(u.modulePrefix)}: ${escapeHtml(entry.moduleId)}</p>
				<button type="button" class="btn--danger" data-entry-action="delete" data-entry-id="${escapeHtml(entry.id)}">${escapeHtml(u.delete)}</button>
			</article>
		`,
		)
		.join('');
}

function sortEntriesForView(
	entriesInput: DraftEntry[],
	mode: 'newest' | 'oldest' | 'title-asc' | 'title-desc',
): DraftEntry[] {
	const list = [...entriesInput];
	switch (mode) {
		case 'oldest':
			return list.reverse();
		case 'title-asc':
			return list.sort((a, b) => a.title.localeCompare(b.title));
		case 'title-desc':
			return list.sort((a, b) => b.title.localeCompare(a.title));
		case 'newest':
		default:
			return list;
	}
}

function renderEntryFields() {
	const u = uiText();
	destroyAllRichEditors();
	const module = getSelectedModule();
	if (!module) {
		entryFieldContainer.innerHTML = `<p class="muted">${escapeHtml(u.selectModuleToCreateEntries)}</p>`;
		return;
	}

	entryFieldContainer.innerHTML = module.fields.map((field) => createFieldInputMarkup(field)).join('');
	mountRichTextEditors(entryFieldContainer, {
		getUploadPayload: () => ({
			s3KeyPrefix: s3PrefixInput.value.trim() || 'published',
			s3: s3OptionsFromForm(),
		}),
		getText: (key) => {
			if (key === 'promptLinkUrl') return tUi('promptLinkUrl');
			if (key === 'imageUploadFailed') return tUi('imageUploadFailed');
			if (key === 'startWritingPlaceholder') return tUi('startWritingPlaceholder');
			return '';
		},
		onNotice: setNotice,
	});
}

function createFieldInputMarkup(field: FieldDefinition): string {
	const u = uiText();
	const id = `entry-field-${field.id}`;
	const requiredAttr = field.required ? 'required' : '';
	const help = field.helpText ? `<small>${escapeHtml(field.helpText)}</small>` : '';

	if (field.type === 'file') {
		return `
			<label class="stack" for="${escapeHtml(id)}">
				<span>${escapeHtml(field.label)} ${field.required ? '<em>*</em>' : ''}</span>
				<input id="${escapeHtml(id)}" type="file" ${requiredAttr} />
				${help}
			</label>
		`;
	}

	if (field.type === 'richText') {
		const fid = escapeHtml(field.id);
		return `
			<div class="stack rich-text-host" data-rich-text-host="${fid}">
				<span class="rich-label">${escapeHtml(field.label)} ${field.required ? '<em>*</em>' : ''}</span>
				<div class="rich-toolbar" data-rich-toolbar>
					<button type="button" class="rich-tb-btn" data-cmd="bold" title="${escapeHtml(u.richBold)}"><strong>B</strong></button>
					<button type="button" class="rich-tb-btn" data-cmd="italic" title="${escapeHtml(u.richItalic)}"><em>I</em></button>
					<button type="button" class="rich-tb-btn" data-cmd="strike" title="${escapeHtml(u.richStrike)}"><s>S</s></button>
					<button type="button" class="rich-tb-btn" data-cmd="code" title="${escapeHtml(u.richCode)}">&lt;/&gt;</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="h2" title="${escapeHtml(u.richHeading2)}">H2</button>
					<button type="button" class="rich-tb-btn" data-cmd="h3" title="${escapeHtml(u.richHeading3)}">H3</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="bullet" title="${escapeHtml(u.richBullet)}">&#8226;</button>
					<button type="button" class="rich-tb-btn" data-cmd="ordered" title="${escapeHtml(u.richOrdered)}">1.</button>
					<button type="button" class="rich-tb-btn" data-cmd="blockquote" title="${escapeHtml(u.richQuote)}">&ldquo;</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="link" title="${escapeHtml(u.richLink)}">${escapeHtml(u.richLink)}</button>
					<button type="button" class="rich-tb-btn rich-tb-img" data-cmd="image" title="${escapeHtml(u.richUploadImage)}">${escapeHtml(u.richImageButton)}</button>
				</div>
				<div class="rich-editor-surface" data-rich-doc></div>
				<textarea id="${escapeHtml(id)}" data-rich-md class="rich-md-store" rows="1" aria-label="${escapeHtml(field.label)}"></textarea>
				${help}
			</div>
		`;
	}

	if (field.type === 'textarea') {
		return `
			<label class="stack" for="${escapeHtml(id)}">
				<span>${escapeHtml(field.label)} ${field.required ? '<em>*</em>' : ''}</span>
				<textarea id="${escapeHtml(id)}" rows="4" ${requiredAttr}></textarea>
				${help}
			</label>
		`;
	}

	if (field.type === 'boolean') {
		return `
			<label class="toggle" for="${escapeHtml(id)}">
				<input id="${escapeHtml(id)}" type="checkbox" />
				<span>${escapeHtml(field.label)}</span>
			</label>
		`;
	}

	const typeMap: Record<FieldDefinition['type'], string> = {
		text: 'text',
		textarea: 'text',
		url: 'url',
		number: 'number',
		boolean: 'checkbox',
		date: 'date',
		richText: 'text',
		file: 'file',
	};

	return `
		<label class="stack" for="${escapeHtml(id)}">
			<span>${escapeHtml(field.label)} ${field.required ? '<em>*</em>' : ''}</span>
			<input id="${escapeHtml(id)}" type="${typeMap[field.type]}" ${requiredAttr} />
			${help}
		</label>
	`;
}

function getSelectedModule(): FieldModule | undefined {
	const selected = entryModuleSelect.value;
	return modules.find((module) => module.id === selected);
}

function setNotice(message: string, type: NoticeType) {
	publishStatus.textContent = message;
	publishStatus.dataset.state = type;
}

function readStorage<T>(key: string, fallback: T): T {
	try {
		const value = localStorage.getItem(key);
		if (!value) {
			return fallback;
		}
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function toId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
}

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing required element: #${id}`);
	}
	return element as T;
}

function isFieldType(value: string): value is FieldDefinition['type'] {
	return FIELD_TYPES.includes(value as FieldDefinition['type']);
}
