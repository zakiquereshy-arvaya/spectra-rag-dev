/**
 * HTML Sanitization & Markdown Rendering
 * Uses `marked` for full markdown and `DOMPurify` to prevent XSS.
 */
import { Marked } from 'marked';
import { browser } from '$app/environment';

const marked = new Marked({
	breaks: true,
	gfm: true,
});

const ALLOWED_TAGS = [
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'p', 'br', 'hr',
	'ul', 'ol', 'li',
	'strong', 'em', 'del', 's',
	'code', 'pre',
	'blockquote',
	'a',
	'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'span', 'div', 'sup', 'sub',
	'details', 'summary',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'title'];

let DOMPurify: typeof import('dompurify').default | null = null;
if (browser) {
	import('dompurify').then((m) => { DOMPurify = m.default; });
}

export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export function formatMessageSafe(content: string): string {
	const escaped = escapeHtml(content);
	return escaped.replace(/\n/g, '<br>');
}

/**
 * Render full markdown with safe HTML output.
 * DOMPurify sanitizes when available (browser); on server the raw HTML is
 * returned (only consumed by {@html} in client-hydrated components).
 */
export function formatMessageWithMarkdown(content: string): string {
	if (!content) return '';

	const raw = marked.parse(content);
	const html = typeof raw === 'string' ? raw : '';

	if (DOMPurify) {
		return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ADD_ATTR: ['target'] });
	}

	return html;
}
