import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';

import type { PublishOptions } from '../lib/content-model';
import { uploadEditorImageToS3 } from '../lib/s3-client';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const turndown = new TurndownService({ headingStyle: 'atx' });
const NETWORK_REQUIRED_MESSAGE = 'این عملیات نیاز به اینترنت دارد.';

const editors = new Map<string, Editor>();

export function destroyAllRichEditors(): void {
	for (const ed of editors.values()) {
		ed.destroy();
	}
	editors.clear();
}

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error('Unexpected FileReader result'));
				return;
			}
			resolve(result.includes(',') ? (result.split(',').pop() ?? '') : result);
		};
		reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
		reader.readAsDataURL(file);
	});
}

export function mountRichTextEditors(
	container: HTMLElement,
	deps: {
		getUploadPayload: () => { s3KeyPrefix: string; s3: NonNullable<PublishOptions['s3']> };
		getText?: (key: 'promptLinkUrl' | 'imageUploadFailed' | 'startWritingPlaceholder') => string;
		onNotice: (message: string, type: 'ok' | 'error' | 'info') => void;
	},
): void {
	const hosts = container.querySelectorAll<HTMLElement>('[data-rich-text-host]');

	for (const host of hosts) {
		const fieldId = host.dataset.richTextHost;
		if (!fieldId) {
			continue;
		}

		const docEl = host.querySelector<HTMLElement>('[data-rich-doc]');
		const store = host.querySelector<HTMLTextAreaElement>('[data-rich-md]');
		if (!docEl || !store) {
			continue;
		}

		const initialMd = store.value || '';
		const initialHtml = initialMd.trim() ? md.render(initialMd) : '<p></p>';
		const editor = new Editor({
			element: docEl,
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3] },
				}),
				Link.configure({
					openOnClick: false,
					HTMLAttributes: { rel: 'noopener noreferrer' },
				}),
				Image.configure({
					inline: false,
					allowBase64: false,
				}),
				Placeholder.configure({ placeholder: deps.getText?.('startWritingPlaceholder') || 'Start writing…' }),
			],
			editorProps: {
				attributes: {
					class: 'rich-prose',
					spellcheck: 'true',
				},
			},
			content: initialHtml,
			onUpdate: ({ editor: ed }) => {
				store.value = turndown.turndown(ed.getHTML());
			},
		});

		editors.set(fieldId, editor);

		const toolbar = host.querySelector<HTMLElement>('[data-rich-toolbar]');
		if (!toolbar) {
			continue;
		}

		toolbar.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
			if (!btn || btn.disabled) {
				return;
			}
			const cmd = btn.dataset.cmd;
			e.preventDefault();
			if (!cmd) {
				return;
			}

			switch (cmd) {
				case 'bold':
					editor.chain().focus().toggleBold().run();
					break;
				case 'italic':
					editor.chain().focus().toggleItalic().run();
					break;
				case 'strike':
					editor.chain().focus().toggleStrike().run();
					break;
				case 'code':
					editor.chain().focus().toggleCode().run();
					break;
				case 'h2':
					editor.chain().focus().toggleHeading({ level: 2 }).run();
					break;
				case 'h3':
					editor.chain().focus().toggleHeading({ level: 3 }).run();
					break;
				case 'bullet':
					editor.chain().focus().toggleBulletList().run();
					break;
				case 'ordered':
					editor.chain().focus().toggleOrderedList().run();
					break;
				case 'blockquote':
					editor.chain().focus().toggleBlockquote().run();
					break;
				case 'link': {
					const previousUrl = editor.getAttributes('link').href as string | undefined;
					const url = window.prompt(deps.getText?.('promptLinkUrl') || 'Link URL', previousUrl ?? 'https://');
					if (url === null) {
						break;
					}
					const trimmed = url.trim();
					if (trimmed === '') {
						editor.chain().focus().unsetLink().run();
						break;
					}
					editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
					break;
				}
				case 'image': {
					const input = document.createElement('input');
					input.type = 'file';
					input.accept = 'image/*';
					input.onchange = async () => {
						const file = input.files?.[0];
						if (!file) {
							return;
						}
						if (!navigator.onLine) {
							deps.onNotice(NETWORK_REQUIRED_MESSAGE, 'error');
							return;
						}
						try {
							const payload = deps.getUploadPayload();
							const dataBase64 = await readFileAsBase64(file);
							const data = await uploadEditorImageToS3({
								fileName: file.name,
								mimeType: file.type || 'application/octet-stream',
								dataBase64,
								s3KeyPrefix: payload.s3KeyPrefix,
								s3: payload.s3,
							});
							if (data.url) {
								editor.chain().focus().setImage({ src: data.url, alt: file.name }).run();
							}
						} catch (err) {
							const message =
								!navigator.onLine
									? NETWORK_REQUIRED_MESSAGE
									: err instanceof Error
										? err.message
										: deps.getText?.('imageUploadFailed') || 'Image upload failed';
							deps.onNotice(message, 'error');
						}
					};
					input.click();
					break;
				}
				default:
					break;
			}
		});
	}
}
