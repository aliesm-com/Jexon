import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';

import { RICH_TEXT_VERSION, type RichBlock, type RichInline, type RichTextDocument } from './content-model';

interface AstNode {
	type: string;
	children?: AstNode[];
	value?: string;
	url?: string;
	title?: string;
	lang?: string;
	depth?: number;
	ordered?: boolean;
	start?: number;
	checked?: boolean | null;
	alt?: string;
}

interface AstRoot extends AstNode {
	children: AstNode[];
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function markdownToRichText(markdown: string): RichTextDocument {
	const normalized = markdown.replace(/\r\n/g, '\n').trim();
	const tree = parser.parse(normalized) as AstRoot;

	const blocks = (tree.children ?? [])
		.flatMap((node) => convertBlock(node))
		.filter((block): block is RichBlock => Boolean(block));

	return {
		type: 'doc',
		version: RICH_TEXT_VERSION,
		blocks,
	};
}

function convertBlock(node: AstNode): RichBlock[] {
	switch (node.type) {
		case 'paragraph': {
			return [
				{
					type: 'paragraph',
					children: toInlineChildren(node.children ?? []),
				},
			];
		}
		case 'heading': {
			const depth = Number.isFinite(node.depth) ? Number(node.depth) : 1;
			return [
				{
					type: 'heading',
					level: Math.min(6, Math.max(1, depth)),
					children: toInlineChildren(node.children ?? []),
				},
			];
		}
		case 'list': {
			const children = node.children ?? [];
			const items = children
				.filter((item) => item.type === 'listItem')
				.map((item) => ({ children: toInlineChildren(flattenListItem(item)) }));

			return [
				{
					type: 'list',
					ordered: Boolean(node.ordered),
					start: node.start,
					items,
				},
			];
		}
		case 'blockquote': {
			const segments = (node.children ?? []).flatMap((child) => {
				if (child.type === 'paragraph' || child.type === 'heading') {
					return toInlineChildren(child.children ?? []);
				}
				return [{ type: 'text', text: collectText(child) } as RichInline];
			});
			return [{ type: 'quote', children: segments }];
		}
		case 'code': {
			return [
				{
					type: 'code',
					language: node.lang,
					text: node.value ?? '',
				},
			];
		}
		case 'thematicBreak': {
			return [{ type: 'divider' }];
		}
		case 'table': {
			return tableToBlocks(node);
		}
		default: {
			const fallbackText = collectText(node);
			if (!fallbackText) {
				return [];
			}
			return [{ type: 'paragraph', children: [{ type: 'text', text: fallbackText }] }];
		}
	}
}

function tableToBlocks(tableNode: AstNode): RichBlock[] {
	const rows = tableNode.children ?? [];
	const lines = rows
		.filter((row) => row.type === 'tableRow')
		.map((row) => {
			const cells = row.children ?? [];
			return cells
				.filter((cell) => cell.type === 'tableCell')
				.map((cell) => collectText(cell).trim())
				.join(' | ');
		})
		.filter(Boolean);

	if (!lines.length) {
		return [];
	}

	return [{ type: 'code', language: 'table', text: lines.join('\n') }];
}

function flattenListItem(listItem: AstNode): AstNode[] {
	const output: AstNode[] = [];
	for (const child of listItem.children ?? []) {
		if (child.type === 'paragraph') {
			output.push(...(child.children ?? []));
			continue;
		}
		output.push(child);
	}
	return output;
}

function toInlineChildren(nodes: AstNode[], activeMarks: Array<'bold' | 'italic' | 'strike' | 'code'> = []): RichInline[] {
	const output: RichInline[] = [];

	for (const node of nodes) {
		switch (node.type) {
			case 'text': {
				output.push({
					type: 'text',
					text: node.value ?? '',
					marks: activeMarks.length ? [...activeMarks] : undefined,
				});
				break;
			}
			case 'strong': {
				output.push(...toInlineChildren(node.children ?? [], appendMark(activeMarks, 'bold')));
				break;
			}
			case 'emphasis': {
				output.push(...toInlineChildren(node.children ?? [], appendMark(activeMarks, 'italic')));
				break;
			}
			case 'delete': {
				output.push(...toInlineChildren(node.children ?? [], appendMark(activeMarks, 'strike')));
				break;
			}
			case 'inlineCode': {
				output.push({
					type: 'text',
					text: node.value ?? '',
					marks: appendMark(activeMarks, 'code'),
				});
				break;
			}
			case 'break': {
				output.push({ type: 'break' });
				break;
			}
			case 'link': {
				output.push({
					type: 'link',
					href: node.url ?? '',
					title: node.title,
					children: toInlineChildren(node.children ?? [], activeMarks),
				});
				break;
			}
			case 'image': {
				output.push({
					type: 'link',
					href: node.url ?? '',
					title: node.alt,
					children: [{ type: 'text', text: node.alt || node.url || 'image' }],
				});
				break;
			}
			default: {
				const nested = node.children ? toInlineChildren(node.children, activeMarks) : [];
				if (nested.length) {
					output.push(...nested);
					break;
				}
				const fallback = collectText(node);
				if (fallback) {
					output.push({ type: 'text', text: fallback, marks: activeMarks.length ? activeMarks : undefined });
				}
				break;
			}
		}
	}

	return output.length ? output : [{ type: 'text', text: '' }];
}

function appendMark(
	marks: Array<'bold' | 'italic' | 'strike' | 'code'>,
	nextMark: 'bold' | 'italic' | 'strike' | 'code',
): Array<'bold' | 'italic' | 'strike' | 'code'> {
	return marks.includes(nextMark) ? marks : [...marks, nextMark];
}

function collectText(node: AstNode): string {
	if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
		return node.value ?? '';
	}

	return (node.children ?? []).map((child) => collectText(child)).join(' ').trim();
}
