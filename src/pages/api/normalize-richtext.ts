import type { APIRoute } from 'astro';

import { markdownToRichText } from '../../lib/rich-text';

interface NormalizeRequest {
	markdown?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
	let payload: NormalizeRequest;

	try {
		payload = (await request.json()) as NormalizeRequest;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (typeof payload.markdown !== 'string') {
		return new Response(JSON.stringify({ error: 'markdown must be a string' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const document = markdownToRichText(payload.markdown);
	return new Response(JSON.stringify(document), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
