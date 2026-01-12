/**
 * HTML Sanitization Utilities
 * Prevents XSS attacks by escaping HTML entities
 */

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Format message content safely for display
 * Escapes HTML entities first, then converts newlines to <br>
 */
export function formatMessageSafe(content: string): string {
	// First escape any HTML to prevent XSS
	const escaped = escapeHtml(content);
	// Then convert newlines to <br> tags
	return escaped.replace(/\n/g, '<br>');
}

/**
 * Format message with markdown-like formatting (safe)
 * Supports: **bold**, *italic*, `code`, ```code blocks```
 */
export function formatMessageWithMarkdown(content: string): string {
	// First escape HTML
	let formatted = escapeHtml(content);

	// Convert code blocks (```code```) - must be done before inline code
	formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-200 dark:bg-gray-700 p-2 rounded my-2 overflow-x-auto"><code>$1</code></pre>');

	// Convert inline code (`code`)
	formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">$1</code>');

	// Convert bold (**text**)
	formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

	// Convert italic (*text*)
	formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

	// Convert newlines to <br> (but not inside pre blocks)
	formatted = formatted.replace(/\n/g, '<br>');

	return formatted;
}
