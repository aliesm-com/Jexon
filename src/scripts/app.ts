import {
	FIELD_TYPES,
	MODULE_SCHEMA_VERSION,
	type DraftEntry,
	type FieldDefinition,
	type FieldModule,
} from '../lib/content-model';

const STORAGE_MODULES_KEY = 'jexon.modules.v1';
const STORAGE_ENTRIES_KEY = 'jexon.entries.v1';

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

let modules: FieldModule[] = [];
let entries: DraftEntry[] = [];
let draftFields: FieldDefinition[] = [];
let editingModuleId: string | null = null;

init();

function init() {
	seedFieldTypeOptions();
	loadState();
	bindEvents();
	renderAll();
	setNotice('Ready. Create a module, add entries, then publish.', 'info');
}

function bindEvents() {
	byId<HTMLButtonElement>('add-field-btn').addEventListener('click', addFieldToDraft);
	byId<HTMLButtonElement>('clear-fields-btn').addEventListener('click', clearFieldDraft);
	byId<HTMLButtonElement>('save-module-btn').addEventListener('click', saveModule);
	byId<HTMLButtonElement>('reset-module-btn').addEventListener('click', resetModuleForm);
	byId<HTMLButtonElement>('import-module-btn').addEventListener('click', importModulesFromJson);
	byId<HTMLButtonElement>('add-entry-btn').addEventListener('click', addEntry);
	byId<HTMLButtonElement>('publish-btn').addEventListener('click', publishContent);
	byId<HTMLButtonElement>('clear-storage-btn').addEventListener('click', clearAllLocalData);

	moduleList.addEventListener('click', handleModuleActions);
	entryList.addEventListener('click', handleEntryActions);
	entryModuleSelect.addEventListener('change', renderEntryFields);
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
		setNotice('Paste module JSON first.', 'error');
		return;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
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
		moduleImportInput.value = JSON.stringify(module, null, 2);
		setNotice(`Module '${moduleId}' JSON loaded into the import/export box.`, 'ok');
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

function addEntry() {
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
	clearEntryFieldValues(module);
	setNotice(`Entry '${id}' added.`, 'ok');
}

function clearEntryFieldValues(module: FieldModule) {
	for (const field of module.fields) {
		const input = document.getElementById(`entry-field-${field.id}`) as HTMLInputElement | HTMLTextAreaElement | null;
		if (!input) {
			continue;
		}

		if (field.type === 'boolean') {
			(input as HTMLInputElement).checked = false;
		} else {
			input.value = '';
		}
	}
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
			s3KeyPrefix: s3PrefixInput.value.trim() || 'published',
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
	renderAll();
	publishOutput.value = '';
	setNotice('Local data cleared.', 'info');
}

function renderAll() {
	renderDraftFields();
	renderModules();
	renderEntries();
	renderEntryFields();
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
				<small>${escapeHtml(field.type)}${field.required ? ' • required' : ''}</small>
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
					<button data-action="edit" data-module-id="${escapeHtml(module.id)}">Edit</button>
					<button data-action="export" data-module-id="${escapeHtml(module.id)}">Export JSON</button>
					<button data-action="delete" data-module-id="${escapeHtml(module.id)}" class="danger">Delete</button>
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
				<button data-entry-action="delete" data-entry-id="${escapeHtml(entry.id)}" class="danger">Delete</button>
			</article>
		`,
		)
		.join('');
}

function renderEntryFields() {
	const module = getSelectedModule();
	if (!module) {
		entryFieldContainer.innerHTML = '<p class="muted">Select a module to create entries.</p>';
		return;
	}

	entryFieldContainer.innerHTML = module.fields.map((field) => createFieldInputMarkup(field)).join('');
}

function createFieldInputMarkup(field: FieldDefinition): string {
	const id = `entry-field-${field.id}`;
	const requiredAttr = field.required ? 'required' : '';
	const help = field.helpText ? `<small>${escapeHtml(field.helpText)}</small>` : '';

	if (field.type === 'textarea' || field.type === 'richText') {
		return `
			<label class="stack" for="${escapeHtml(id)}">
				<span>${escapeHtml(field.label)} ${field.required ? '<em>*</em>' : ''}</span>
				<textarea id="${escapeHtml(id)}" rows="${field.type === 'richText' ? '6' : '4'}" ${requiredAttr} placeholder="${field.type === 'richText' ? 'Write Markdown...' : ''}"></textarea>
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
