import {
	FIELD_TYPES,
	MODULE_SCHEMA_VERSION,
	type DraftEntry,
	type FieldDefinition,
	type FieldModule,
	type PublishOptions,
} from '../lib/content-model';

import { destroyAllRichEditors, mountRichTextEditors } from './rich-text-editor';

const WORKSPACE_EXPORT_VERSION = 'jexon-workspace-1';
const MODULE_EXPORT_WRAP_VERSION = 'jexon-export-1';

const STORAGE_MODULES_KEY = 'jexon.modules.v1';
const STORAGE_ENTRIES_KEY = 'jexon.entries.v1';
const STORAGE_S3_SETTINGS_KEY = 'jexon.s3.settings.v1';
const STORAGE_THEME_KEY = 'jexon.theme.v1';
const STORAGE_WIZARD_STEP_KEY = 'jexon.wizard.step.v1';
const STORAGE_START_MODE_KEY = 'jexon.startMode.v1';

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

const moduleIdInput = byId<HTMLInputElement>('module-id');
const moduleNameInput = byId<HTMLInputElement>('module-name');
const moduleDescriptionInput = byId<HTMLInputElement>('module-description');
const fieldIdInput = byId<HTMLInputElement>('field-id');
const fieldLabelInput = byId<HTMLInputElement>('field-label');
const fieldTypeInput = byId<HTMLSelectElement>('field-type');
const fieldHelpInput = byId<HTMLInputElement>('field-help');
const fieldRequiredInput = byId<HTMLInputElement>('field-required');
const draftFieldList = byId<HTMLDivElement>('draft-field-list');
const moduleList = byId<HTMLDivElement>('module-list');
const moduleImportInput = byId<HTMLTextAreaElement>('module-import');
const entryModuleSelect = byId<HTMLSelectElement>('entry-module-select');
const entryTitleInput = byId<HTMLInputElement>('entry-title');
const entryFieldContainer = byId<HTMLDivElement>('entry-field-container');
const entryList = byId<HTMLDivElement>('entry-list');
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

init();

function init() {
	initThemeToggle();
	initSidebarDrawer();
	seedFieldTypeOptions();
	loadState();
	loadS3SettingsForm();
	bindEvents();
	renderAll();
	initWizard();
	setNotice('Ready. Choose Import or New, then modules, entries, and publish.', 'info');
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
	byId<HTMLButtonElement>('save-module-btn').addEventListener('click', saveModule);
	byId<HTMLButtonElement>('reset-module-btn').addEventListener('click', resetModuleForm);
	byId<HTMLButtonElement>('import-module-btn').addEventListener('click', importModulesFromJson);
	byId<HTMLButtonElement>('export-workspace-btn').addEventListener('click', exportWorkspaceToJsonBox);
	byId<HTMLButtonElement>('add-entry-btn').addEventListener('click', () => void addEntry());
	byId<HTMLButtonElement>('save-s3-settings-btn').addEventListener('click', saveS3SettingsToStorage);
	byId<HTMLButtonElement>('publish-btn').addEventListener('click', publishContent);
	byId<HTMLButtonElement>('clear-storage-btn').addEventListener('click', clearAllLocalData);

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
	setNotice('S3 settings saved in this browser.', 'ok');
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
		setNotice('Field ID and Field Label are required.', 'error');
		return;
	}

	if (!isFieldType(type)) {
		setNotice('Invalid field type.', 'error');
		return;
	}

	if (draftFields.some((field) => field.id === id)) {
		setNotice(`A field with id '${id}' already exists in this draft.`, 'error');
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
	setNotice(`Field '${id}' added.`, 'ok');
}

function clearFieldDraft() {
	draftFields = [];
	renderDraftFields();
	setNotice('Draft field list cleared.', 'info');
}

function saveModule() {
	const id = toId(moduleIdInput.value.trim() || moduleNameInput.value.trim());
	const name = moduleNameInput.value.trim();
	const description = moduleDescriptionInput.value.trim();

	if (!id || !name) {
		setNotice('Module ID and Module Name are required.', 'error');
		return;
	}

	if (!draftFields.length) {
		setNotice('At least one field is required for a module.', 'error');
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
			setNotice(`Module '${id}' already exists.`, 'error');
			return;
		}
		modules.push(nextModule);
	}

	entries = entries.filter((entry) => modules.some((module) => module.id === entry.moduleId));
	saveState();
	resetModuleForm();
	renderAll();
	setNotice(`Module '${id}' saved.`, 'ok');
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
		setNotice('Paste JSON first.', 'error');
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
				setNotice(`Imported workspace: ${imported.length} module(s).`, 'ok');
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
				setNotice(`Imported module '${module.id}' (and S3 if present).`, 'ok');
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
		setNotice(`${imported.length} module(s) imported.`, 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid JSON.';
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
	setNotice('Workspace JSON (all modules + S3) loaded into the box.', 'ok');
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
		setNotice('Module not found.', 'error');
		return;
	}

	if (action === 'edit') {
		editingModuleId = module.id;
		moduleIdInput.value = module.id;
		moduleNameInput.value = module.name;
		moduleDescriptionInput.value = module.description ?? '';
		draftFields = [...module.fields];
		renderDraftFields();
		setNotice(`Editing module '${module.id}'.`, 'info');
		return;
	}

	if (action === 'delete') {
		modules = modules.filter((item) => item.id !== moduleId);
		entries = entries.filter((entry) => entry.moduleId !== moduleId);
		saveState();
		renderAll();
		setNotice(`Module '${moduleId}' deleted.`, 'ok');
		return;
	}

	if (action === 'export') {
		const payload = {
			schemaVersion: MODULE_EXPORT_WRAP_VERSION,
			module,
			s3Settings: getCurrentS3SettingsObject(),
		};
		moduleImportInput.value = JSON.stringify(payload, null, 2);
		setNotice(`Module '${moduleId}' + S3 loaded into the JSON box.`, 'ok');
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
	setNotice(`Entry '${entryId}' deleted.`, 'ok');
}

async function addEntry() {
	const module = getSelectedModule();
	if (!module) {
		setNotice('Select a module first.', 'error');
		return;
	}

	const title = entryTitleInput.value.trim();
	if (!title) {
		setNotice('Entry title is required.', 'error');
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
					setNotice(`Field "${field.label}" requires a file.`, 'error');
					return;
				}
				values[field.id] = null;
				continue;
			}
			try {
				values[field.id] = await readFilePayload(file);
			} catch {
				setNotice(`Could not read file for "${field.label}".`, 'error');
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
				setNotice(`Field "${field.label}" is required.`, 'error');
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
	setNotice(`Entry '${id}' added.`, 'ok');
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
		setNotice('Cannot publish without at least one module.', 'error');
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

	setNotice('Building final JSON...', 'info');

	try {
		const response = await fetch('/api/publish', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		const result = (await response.json()) as {
			error?: string;
			details?: Array<{ path: string; message: string }>;
			bundle?: unknown;
			upload?: { uri?: string };
		};

		if (!response.ok) {
			const details = (result.details ?? []).map((item) => `${item.path}: ${item.message}`).join(' | ');
			throw new Error(result.error ? `${result.error}${details ? ` - ${details}` : ''}` : 'Publish failed');
		}

		publishOutput.value = JSON.stringify(result.bundle, null, 2);
		if (result.upload?.uri) {
			setNotice(`Published and uploaded to S3: ${result.upload.uri}`, 'ok');
		} else {
			setNotice('Final JSON generated successfully.', 'ok');
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Publish failed';
		setNotice(message, 'error');
	}
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
	setNotice('Local data cleared.', 'info');
}

function renderAll() {
	renderDraftFields();
	renderModules();
	renderEntries();
	refreshEntryFieldsIfActive();
}

function renderDraftFields() {
	if (!draftFields.length) {
		draftFieldList.innerHTML = '<p class="muted">No fields added yet.</p>';
		return;
	}

	draftFieldList.innerHTML = draftFields
		.map(
			(field) => `
			<div class="chip">
				<strong>${escapeHtml(field.id)}</strong>
				<span>${escapeHtml(field.label)}</span>
				<small>${escapeHtml(field.type)}${field.required ? ' - required' : ''}</small>
			</div>
		`,
		)
		.join('');
}

function renderModules() {
	if (!modules.length) {
		moduleList.innerHTML = '<p class="muted">No modules saved.</p>';
		entryModuleSelect.innerHTML = '<option value="">No modules available</option>';
		return;
	}

	moduleList.innerHTML = modules
		.map(
			(module) => `
			<article class="card">
				<header>
					<h3>${escapeHtml(module.name)}</h3>
					<code>${escapeHtml(module.id)}</code>
				</header>
				<p>${escapeHtml(module.description ?? 'No description')}</p>
				<p class="muted">${module.fields.length} field(s)</p>
				<div class="row gap-sm">
					<button type="button" class="btn--ghost" data-action="edit" data-module-id="${escapeHtml(module.id)}">Edit</button>
					<button type="button" class="btn--outline" data-action="export" data-module-id="${escapeHtml(module.id)}">Export JSON</button>
					<button type="button" class="btn--danger" data-action="delete" data-module-id="${escapeHtml(module.id)}">Delete</button>
				</div>
			</article>
		`,
		)
		.join('');

	const selected = entryModuleSelect.value;
	entryModuleSelect.innerHTML = [
		'<option value="">Select a module</option>',
		...modules.map((module) => `<option value="${escapeHtml(module.id)}">${escapeHtml(module.name)} (${escapeHtml(module.id)})</option>`),
	].join('');

	if (modules.some((module) => module.id === selected)) {
		entryModuleSelect.value = selected;
	} else {
		entryModuleSelect.value = modules[0]?.id ?? '';
	}
}

function renderEntries() {
	if (!entries.length) {
		entryList.innerHTML = '<p class="muted">No entries saved yet.</p>';
		return;
	}

	entryList.innerHTML = entries
		.map(
			(entry) => `
			<article class="card slim">
				<header>
					<h4>${escapeHtml(entry.title)}</h4>
					<code>${escapeHtml(entry.id)}</code>
				</header>
				<p class="muted">module: ${escapeHtml(entry.moduleId)}</p>
				<button type="button" class="btn--danger" data-entry-action="delete" data-entry-id="${escapeHtml(entry.id)}">Delete</button>
			</article>
		`,
		)
		.join('');
}

function renderEntryFields() {
	destroyAllRichEditors();
	const module = getSelectedModule();
	if (!module) {
		entryFieldContainer.innerHTML = '<p class="muted">Select a module to create entries.</p>';
		return;
	}

	entryFieldContainer.innerHTML = module.fields.map((field) => createFieldInputMarkup(field)).join('');
	mountRichTextEditors(entryFieldContainer, {
		getUploadPayload: () => ({
			s3KeyPrefix: s3PrefixInput.value.trim() || 'published',
			s3: s3OptionsFromForm(),
		}),
		onNotice: setNotice,
	});
}

function createFieldInputMarkup(field: FieldDefinition): string {
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
					<button type="button" class="rich-tb-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
					<button type="button" class="rich-tb-btn" data-cmd="italic" title="Italic"><em>I</em></button>
					<button type="button" class="rich-tb-btn" data-cmd="strike" title="Strikethrough"><s>S</s></button>
					<button type="button" class="rich-tb-btn" data-cmd="code" title="Inline code">&lt;/&gt;</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="h2" title="Heading 2">H2</button>
					<button type="button" class="rich-tb-btn" data-cmd="h3" title="Heading 3">H3</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="bullet" title="Bullet list">&#8226;</button>
					<button type="button" class="rich-tb-btn" data-cmd="ordered" title="Numbered list">1.</button>
					<button type="button" class="rich-tb-btn" data-cmd="blockquote" title="Quote">&ldquo;</button>
					<span class="rich-tb-sep" aria-hidden="true"></span>
					<button type="button" class="rich-tb-btn" data-cmd="link" title="Link">Link</button>
					<button type="button" class="rich-tb-btn rich-tb-img" data-cmd="image" title="Upload image to S3">Image</button>
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
