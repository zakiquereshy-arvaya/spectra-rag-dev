<!-- src/routes/moe/+page.svelte - Billi AI Assistant -->
<script lang="ts">
	import type { PageData } from './$types';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut, quintOut } from 'svelte/easing';
	import MessageList from '$lib/components/MessageList.svelte';
	import TimeEntryForm from '$lib/components/TimeEntryForm.svelte';
	import PatchNotesSticky from '$lib/components/PatchNotesSticky.svelte';
	import McpApprovalCard from '$lib/components/McpApprovalCard.svelte';
	import type { ChatMessage, ToolResultData } from '$lib/api/chat';
	import { getSessionId, clearSessionId } from '$lib/stores/chat-persistence';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';

	let { data }: { data: PageData } = $props();

	let messages = $state<ChatMessage[]>([]);
	let inputMessage = $state('');
	let isLoading = $state(false);
	let isLoadingHistory = $state(true);
	let sessionId = $state('');
	let streamingContent = $state('');
	let showPatchNotes = $state(false);

	// Current mode indicator from classification
	let currentMode = $state<'calendar' | 'billing' | 'assistant' | 'monday' | 'box'>('assistant');
	let currentConfidence = $state<number>(0);

	// Time entry form state
	let showTimeEntryForm = $state(false);
	let pendingTimeEntry = $state<{ hours: number; entryDate: string } | null>(null);

	// Tool status for progress indicator
	let toolStatus = $state<{ tool: string; label: string } | null>(null);

	// Collected tool results during streaming
	let pendingToolResult = $state<ToolResultData | null>(null);

	// MCP tool approval state
	interface McpApprovalData {
		expert?: 'monday' | 'box';
		conversationId: string;
		responseId: string;
		approvalRequestId: string;
		toolName: string;
		serverLabel: string;
		arguments: Record<string, unknown>;
	}
	let pendingMcpApproval = $state<McpApprovalData | null>(null);
	let mcpApprovalProcessing = $state(false);
	let accumulatedContent = $state('');

	function loadAlwaysAllowedTools(): Set<string> {
		try {
			const stored = sessionStorage.getItem('mcp_always_allowed_tools');
			return stored ? new Set(JSON.parse(stored)) : new Set();
		} catch { return new Set(); }
	}
	function saveAlwaysAllowedTools(tools: Set<string>) {
		try { sessionStorage.setItem('mcp_always_allowed_tools', JSON.stringify([...tools])); } catch {}
	}
	let alwaysAllowedTools = $state<Set<string>>(new Set());

	// Slash command dropdown
	let showSlashMenu = $state(false);
	let slashFilter = $state('');

	let abortController: AbortController | null = null;
	let historyAbortController: AbortController | null = null;
	let textareaElement: HTMLTextAreaElement;
	let chatScrollElement: HTMLDivElement;
	let shouldStickToBottom = $state(true);
	const AUTO_SCROLL_THRESHOLD = 120;

	/**
	 * Extract a bracket-balanced JSON payload from a marker like [TAG:{...}]
	 * Returns [jsonString, fullMatchLength] or null if not found.
	 */
	function extractMarkerJson(text: string, tag: string): [string, number] | null {
		const prefix = `[${tag}:`;
		const start = text.indexOf(prefix);
		if (start === -1) return null;

		const jsonStart = start + prefix.length;
		let depth = 0;
		let inString = false;
		let escape = false;

		for (let i = jsonStart; i < text.length; i++) {
			const ch = text[i];
			if (escape) { escape = false; continue; }
			if (ch === '\\' && inString) { escape = true; continue; }
			if (ch === '"') { inString = !inString; continue; }
			if (inString) continue;
			if (ch === '{' || ch === '[') depth++;
			if (ch === '}' || ch === ']') {
				depth--;
				if (depth === 0) {
					// i is at the closing } of the JSON object
					// Next char should be ]
					const jsonStr = text.slice(jsonStart, i + 1);
					const endIdx = (text[i + 1] === ']') ? i + 2 : i + 1;
					// Skip optional trailing newline
					const finalEnd = (text[endIdx] === '\n') ? endIdx + 1 : endIdx;
					return [jsonStr, finalEnd - start];
				}
			}
		}
		return null;
	}

	/** Remove a marker from text using bracket-balanced extraction */
	function stripMarker(text: string, tag: string): string {
		const result = extractMarkerJson(text, tag);
		if (!result) return text;
		const prefix = `[${tag}:`;
		const start = text.indexOf(prefix);
		return text.slice(0, start) + text.slice(start + result[1]);
	}

	// Get user name from session
	let userName = $derived(data.session?.user?.name || '');

	const slashCommands = [
		{ command: '/log', label: 'Log Time', description: 'Log hours for a project', action: 'log_time' },
		{ command: '/availability', label: 'Check Availability', description: 'Check someone\'s calendar', action: 'check_availability' },
		{ command: '/book', label: 'Book Meeting', description: 'Schedule a Teams meeting', action: 'book_meeting' },
		{ command: '/monday', label: 'Monday Updates', description: 'View action items from Monday.com', action: 'monday_updates' },
		{ command: '/tasks', label: 'My Tasks', description: 'Show my assigned action items', action: 'monday_tasks' },
		{ command: '/boards', label: 'Monday Boards', description: 'List boards and recent updates', action: 'monday_boards' },
		{ command: '/box', label: 'Box Knowledge', description: 'Ask the Box knowledge agent', action: 'box_knowledge' },
	];

	let filteredSlashCommands = $derived.by(() =>
		slashFilter
			? slashCommands.filter(
					(c) =>
						c.command.startsWith('/' + slashFilter) ||
						c.label.toLowerCase().includes(slashFilter.toLowerCase())
				)
			: slashCommands
	);

	const patchNotesSections = [
		{
			title: 'Monday Expert + Routing',
			items: [
				'Added a dedicated Monday expert path in the MoE router with Azure Foundry agent support.',
				'Extended intent classification with a new monday category and task/board-focused pattern matching.',
				'Wired stream config to pass Azure agent endpoint/id through the /moe pipeline.',
				'Added Monday quick commands and actions for updates, assigned tasks, and board summaries.'
			]
		},
		{
			title: 'MCP Approval Workflow',
			items: [
				'Added an interactive approval card for MCP tool calls with Allow Once, Always Allow, and Deny actions.',
				'Built a new /moe/approve SSE endpoint to continue Monday conversations after approval decisions.',
				'Added auto-approve support for user-saved always-allowed tools via session storage.',
				'Implemented multi-round approval handling so nested tool approvals can continue cleanly.'
			]
		},
		{
			title: 'Monday + Message Experience',
			items: [
				'Added a structured Monday report card that parses markdown sections into an accordion view.',
				'Improved message bubbles with long-response collapse/expand controls for large assistant replies.',
				'Expanded quick-action landing state with Monday prompts and richer empty-state guidance.',
				'Updated availability and team availability cards with denser summaries and expandable timeline/detail views.'
			]
		},
		{
			title: 'Markdown + Visual Polish',
			items: [
				'Upgraded message rendering from basic formatting to full markdown via marked + DOMPurify sanitization.',
				'Added comprehensive prose styles for headings, lists, tables, blockquotes, links, and details blocks.',
				'Applied markdown rendering to streaming responses for consistent in-progress output formatting.',
				'Added supporting dependencies for Azure agent integration and markdown sanitization.'
			]
		},
		{
			title: 'v1.2 Add-on: Box Expert',
			items: [
				'Added a new Box expert path in the MoE router with dedicated Box agent initialization.',
				'Added a new box intent category with knowledge/SOP-first classification heuristics.',
				'Generalized MCP approval continuation to route by expert (Monday or Box).',
				'Added Box quick action, slash command, and mode badge styling in the chat UI.'
			]
		}
	];

	function getDistanceFromBottom(element: HTMLDivElement): number {
		return element.scrollHeight - element.scrollTop - element.clientHeight;
	}

	function updateStickToBottom() {
		if (!chatScrollElement) return;
		shouldStickToBottom = getDistanceFromBottom(chatScrollElement) < AUTO_SCROLL_THRESHOLD;
	}

	function scrollChatToBottom(behavior: ScrollBehavior = 'smooth') {
		if (!chatScrollElement) return;
		chatScrollElement.scrollTo({
			top: chatScrollElement.scrollHeight,
			behavior
		});
	}

	function handleChatScroll() {
		updateStickToBottom();
	}

	function togglePatchNotes() {
		showPatchNotes = !showPatchNotes;
	}

	function closePatchNotes() {
		showPatchNotes = false;
	}

	$effect(() => {
		alwaysAllowedTools = loadAlwaysAllowedTools();
	});

	$effect(() => {
		sessionId = getSessionId('moe');
		historyAbortController = new AbortController();
		let disposed = false;

		(async () => {
			try {
				const response = await fetch(`/moe/history?sessionId=${encodeURIComponent(sessionId)}`, {
					signal: historyAbortController?.signal
				});
				if (response.ok) {
					const data = await response.json();
					if (data.messages && data.messages.length > 0) {
						messages = data.messages;
					}
				}
			} catch (error: any) {
				if (error?.name !== 'AbortError') {
					console.error('Error loading history:', error);
				}
			} finally {
				if (!disposed) {
					isLoadingHistory = false;
				}
			}
		})();

		return () => {
			disposed = true;
			historyAbortController?.abort();
			abortController?.abort();
		};
	});

	$effect.pre(() => {
		messages.length;
		streamingContent;
		isLoading;
		toolStatus?.label;
		updateStickToBottom();
	});

	$effect(() => {
		messages.length;
		streamingContent;
		isLoading;
		toolStatus?.label;
		if (!chatScrollElement || !shouldStickToBottom) return;
		requestAnimationFrame(() => {
			scrollChatToBottom(streamingContent ? 'auto' : 'smooth');
		});
	});

	async function handleClearChat() {
		if (confirm('Clear chat history?')) {
			await fetch(`/moe/history?sessionId=${encodeURIComponent(sessionId)}`, {
				method: 'DELETE',
			});
			clearSessionId('moe');
			sessionId = getSessionId('moe');
			messages = [];
			streamingContent = '';
			currentMode = 'assistant';
			currentConfidence = 0;
			pendingMcpApproval = null;
			mcpApprovalProcessing = false;
			accumulatedContent = '';
		}
	}

	// Determine suggestion pills based on tool result type
	function getSuggestions(toolResult: ToolResultData | null): Array<{ label: string; action: string }> {
		if (!toolResult) return [];
		switch (toolResult.type) {
			case 'availability':
				if (Array.isArray((toolResult.data as any)?.results)) {
					return [
						{ label: 'Check another day', action: 'Check availability for ' },
					];
				}
				return [
					{ label: 'Book a meeting', action: 'Book a meeting with ' + (toolResult.data.user_email?.split('@')[0] || '') },
					{ label: 'Check another day', action: 'Check availability for ' },
				];
			case 'booking':
				return [
					{ label: 'Check availability', action: 'Check availability for ' },
				];
			case 'time_entry':
				return [
					{ label: 'Log more time', action: 'log_time' },
				];
			default:
				return [];
		}
	}

	async function sendMessage(messageOverride?: string) {
		const messageToSend = (messageOverride || inputMessage).trim();
		if (!messageToSend || isLoading) return;

		// Check if this is a time entry request
		const { isTimeEntry, hours, entryDate } = isTimeEntryIntent(messageToSend);
		if (isTimeEntry && !messageOverride) {
			// Store pending time entry data and show form
			pendingTimeEntry = { hours, entryDate };
			showTimeEntryForm = true;
			inputMessage = '';
			return;
		}

		abortController?.abort();
		abortController = new AbortController();

		const userMessage: ChatMessage = {
			role: 'user',
			content: messageToSend,
			timestamp: new Date().toISOString(),
		};

		messages = [...messages, userMessage];
		shouldStickToBottom = true;
		inputMessage = '';
		isLoading = true;
		streamingContent = '';
		currentMode = 'assistant';
		currentConfidence = 0;
		toolStatus = null;
		pendingToolResult = null;
		pendingMcpApproval = null;
		mcpApprovalProcessing = false;
		accumulatedContent = '';
		showSlashMenu = false;
		resetTextareaHeight();

		try {
			const response = await fetch('/moe/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: messageToSend,
					sessionId: sessionId,
				}),
				signal: abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Request failed: ${response.statusText}`);
			}

			if (!response.body) {
				throw new Error('Response body is null');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.slice(6));

							if (data.chunk) {
								let chunk = data.chunk;

								// Parse CLASSIFICATION markers
								const classificationMatch = chunk.match(/\[CLASSIFICATION:(.+?)\]/);
								if (classificationMatch) {
									try {
										const classification = JSON.parse(classificationMatch[1]);
										currentConfidence = classification.confidence;
										currentMode = classification.expert === 'appointments' ? 'calendar'
											: classification.expert === 'billing' ? 'billing'
											: classification.expert === 'monday' ? 'monday'
											: classification.expert === 'box' ? 'box'
											: 'assistant';
									} catch {}
									chunk = chunk.replace(/\[CLASSIFICATION:.+?\]\n?/, '');
								}

								// Parse TOOL_STATUS markers
								const statusJson = extractMarkerJson(chunk, 'TOOL_STATUS');
								if (statusJson) {
									try {
										const status = JSON.parse(statusJson[0]);
										toolStatus = { tool: status.tool, label: status.label };
									} catch {}
									chunk = stripMarker(chunk, 'TOOL_STATUS');
								}

								// Parse TOOL_RESULT markers (bracket-balanced to handle nested JSON)
								const resultJson = extractMarkerJson(chunk, 'TOOL_RESULT');
								if (resultJson) {
									try {
										const result = JSON.parse(resultJson[0]);
										pendingToolResult = result as ToolResultData;
										toolStatus = null;
									} catch {}
									chunk = stripMarker(chunk, 'TOOL_RESULT');
								}

								// Parse MCP_APPROVAL markers from Monday agent
								const approvalJson = extractMarkerJson(chunk, 'MCP_APPROVAL');
								if (approvalJson) {
									try {
										const approval = JSON.parse(approvalJson[0]) as McpApprovalData;
										pendingMcpApproval = approval;
										accumulatedContent = fullContent;
									} catch {}
									chunk = stripMarker(chunk, 'MCP_APPROVAL');
								}

								if (chunk) {
									fullContent += chunk;
									streamingContent = fullContent;
								}
							} else if (data.error) {
								throw new Error(data.error);
							} else if (data.done) {
								break;
							}
						} catch (parseError: any) {
							if (parseError.message && parseError.message !== 'Unexpected end of JSON input') {
								throw parseError;
							}
						}
					}
				}
			}

			fullContent = cleanStreamContent(fullContent);

			// If an MCP approval is pending, don't finalize the message yet
			if (pendingMcpApproval) {
				streamingContent = '';
				toolStatus = null;

				// Auto-approve if tool is in always-allowed list
				if (alwaysAllowedTools.has(pendingMcpApproval.toolName)) {
					await sendApproval(true, false);
				} else {
					isLoading = false;
				}
				return;
			}

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: fullContent || (pendingToolResult ? '' : 'No response received.'),
				timestamp: new Date().toISOString(),
				toolResult: pendingToolResult || undefined,
				suggestions: getSuggestions(pendingToolResult),
			};
			messages = [...messages, assistantMessage];
			streamingContent = '';
			toolStatus = null;
		} catch (error: any) {
			streamingContent = '';
			toolStatus = null;

			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}

			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error.message || 'An unexpected error occurred'}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
			pendingToolResult = null;
			textareaElement?.focus();
		}
	}

	function cleanStreamContent(text: string): string {
		text = text.replace(/\[CLASSIFICATION:.+?\]\n?/g, '');
		text = text.replace(/\[Processing.*?\]\n*/g, '');
		while (text.includes('[TOOL_STATUS:')) text = stripMarker(text, 'TOOL_STATUS');
		while (text.includes('[TOOL_RESULT:')) text = stripMarker(text, 'TOOL_RESULT');
		while (text.includes('[MCP_APPROVAL:')) text = stripMarker(text, 'MCP_APPROVAL');
		return text;
	}

	/**
	 * Process an SSE response stream from the approve endpoint.
	 * Returns { content, approval } -- if approval is non-null another round is needed.
	 */
	async function processApprovalStream(response: Response): Promise<{ content: string; approval: McpApprovalData | null }> {
		if (!response.body) throw new Error('Response body is null');

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let fullContent = '';
		let approval: McpApprovalData | null = null;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				try {
					const data = JSON.parse(line.slice(6));
					if (data.chunk) {
						let chunk = data.chunk;

						const classificationMatch = chunk.match(/\[CLASSIFICATION:(.+?)\]/);
						if (classificationMatch) {
							try {
								const cls = JSON.parse(classificationMatch[1]);
								currentConfidence = cls.confidence;
								currentMode = cls.expert === 'monday'
									? 'monday'
									: cls.expert === 'box'
										? 'box'
										: 'assistant';
							} catch {}
							chunk = chunk.replace(/\[CLASSIFICATION:.+?\]\n?/, '');
						}

						const approvalJson = extractMarkerJson(chunk, 'MCP_APPROVAL');
						if (approvalJson) {
							try { approval = JSON.parse(approvalJson[0]) as McpApprovalData; } catch {}
							chunk = stripMarker(chunk, 'MCP_APPROVAL');
						}

						if (chunk) {
							fullContent += chunk;
							streamingContent = accumulatedContent + fullContent;
						}
					} else if (data.error) {
						throw new Error(data.error);
					} else if (data.done) {
						break;
					}
				} catch (e: any) {
					if (e.message && e.message !== 'Unexpected end of JSON input') throw e;
				}
			}
		}

		return { content: cleanStreamContent(fullContent), approval };
	}

	async function sendApproval(approve: boolean, alwaysAllow: boolean) {
		if (!pendingMcpApproval) return;

		if (alwaysAllow) {
			alwaysAllowedTools = new Set([...alwaysAllowedTools, pendingMcpApproval.toolName]);
			saveAlwaysAllowedTools(alwaysAllowedTools);
		}

		const approvalData = pendingMcpApproval;
		pendingMcpApproval = null;
		mcpApprovalProcessing = true;
		isLoading = true;
		toolStatus = approve ? { tool: approvalData.toolName, label: `Running ${approvalData.toolName.replace(/_/g, ' ')}...` } : null;

		try {
			const response = await fetch('/moe/approve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId,
					conversationId: approvalData.conversationId,
					responseId: approvalData.responseId,
					approvalRequestId: approvalData.approvalRequestId,
					approve,
					reason: approve ? 'User approved' : 'User denied',
					expert: approvalData.expert || 'monday',
				}),
			});

			if (!response.ok) throw new Error(`Approval request failed: ${response.statusText}`);

			const { content, approval } = await processApprovalStream(response);
			accumulatedContent += content;

			if (approval) {
				pendingMcpApproval = approval;
				mcpApprovalProcessing = false;
				toolStatus = null;

				if (alwaysAllowedTools.has(approval.toolName)) {
					await sendApproval(true, false);
				} else {
					isLoading = false;
				}
				return;
			}

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: accumulatedContent || (approve ? 'Done.' : 'Tool call was denied.'),
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, assistantMessage];
			streamingContent = '';
			accumulatedContent = '';
		} catch (error: any) {
			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error.message || 'Failed to process tool approval'}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
			streamingContent = '';
			accumulatedContent = '';
		} finally {
			mcpApprovalProcessing = false;
			toolStatus = null;
			if (!pendingMcpApproval) {
				isLoading = false;
			}
			textareaElement?.focus();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
		if (e.key === 'Escape') {
			showSlashMenu = false;
		}
	}

	function handleInput() {
		autoGrowTextarea();

		// Slash command detection
		if (inputMessage === '/') {
			showSlashMenu = true;
			slashFilter = '';
		} else if (inputMessage.startsWith('/') && !inputMessage.includes(' ')) {
			showSlashMenu = true;
			slashFilter = inputMessage.slice(1);
		} else {
			showSlashMenu = false;
		}
	}

	function autoGrowTextarea() {
		if (!textareaElement) return;
		textareaElement.style.height = 'auto';
		textareaElement.style.height = Math.min(textareaElement.scrollHeight, 150) + 'px';
	}

	function resetTextareaHeight() {
		if (textareaElement) {
			textareaElement.style.height = 'auto';
		}
	}

	function selectSlashCommand(cmd: typeof slashCommands[0]) {
		showSlashMenu = false;
		inputMessage = '';
		resetTextareaHeight();
		handleQuickAction(cmd.action);
	}

	// Check if message indicates time entry intent
	function isTimeEntryIntent(message: string): { isTimeEntry: boolean; hours: number; entryDate: string } {
		const lower = message.toLowerCase();

		// Patterns that indicate time logging
		const timeEntryPatterns = [
			/\b(log|record|submit)\s+.*\s*(hours?|time)\b/,
			/\b\d+(\.\d+)?\s*(hours?|hrs?)\s+(for|on)\b/,
			/\btime\s+entry\b/,
			/\bbillable\b/,
			/\b(log|record|submit).*\b(customer|client|tasks?)\b/i,
		];

		const isTimeEntry = timeEntryPatterns.some(pattern => pattern.test(lower));

		// Extract hours if present
		let hours = 0;
		const hoursMatch = message.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?)/i);
		if (hoursMatch) {
			hours = parseFloat(hoursMatch[1]);
		}

		// Extract date if present (default to today in Eastern Time)
		const todayEastern = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		let entryDate = todayEastern;
		if (/yesterday/i.test(lower)) {
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			entryDate = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		}
		const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
		if (dateMatch) {
			entryDate = dateMatch[1];
		}

		return { isTimeEntry, hours, entryDate };
	}

	// Handle time entry form submission
	async function handleTimeEntrySubmit(formData: { customer: string; project: string; description: string; hours: number; entryDate: string }) {
		const { customer, project, description, hours, entryDate } = formData;

		showTimeEntryForm = false;
		isLoading = true;

		const todayEastern = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		const dateLabel = entryDate === todayEastern ? '' : ` on ${entryDate}`;

		// Add user message showing they logged time
		const userMessage: ChatMessage = {
			role: 'user',
			content: `Log ${hours} hours for ${customer} - ${project}${dateLabel}`,
			timestamp: new Date().toISOString(),
		};
		messages = [...messages, userMessage];
		shouldStickToBottom = true;

		try {
			const response = await fetch('/moe/time-entry', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					customer,
					project,
					description,
					hours,
					entryDate: entryDate || todayEastern,
				}),
			});

			const result = await response.json();

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: result.success
					? `Logged **${hours} hours** for **${customer}** - ${project}\n\n**Description:** ${description}`
					: `Error logging time: ${result.error || 'Unknown error'}`,
				timestamp: new Date().toISOString(),
				toolResult: result.success
					? {
						type: 'time_entry',
						data: {
							customer_name: customer,
							employee_name: userName,
							hours,
							tasks_completed: description,
							entry_date: entryDate || todayEastern,
							billable: !['arvaya', 'arvaya internal'].includes(customer.toLowerCase().trim()),
						},
					}
					: undefined,
				suggestions: result.success
					? [
						{ label: 'Log more time', action: 'log_time' },
					]
					: undefined,
			};
			messages = [...messages, assistantMessage];
			shouldStickToBottom = true;
		} catch (error: any) {
			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error.message || 'Failed to submit time entry'}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
			shouldStickToBottom = true;
		} finally {
			isLoading = false;
			pendingTimeEntry = null;
		}
	}

	// Handle time entry form cancellation
	function handleTimeEntryCancel() {
		showTimeEntryForm = false;
		pendingTimeEntry = null;
	}

	// Handle quick action from welcome screen or suggestion pills
	function handleQuickAction(action: string) {
		switch (action) {
			case 'log_time':
				pendingTimeEntry = { hours: 0, entryDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) };
				showTimeEntryForm = true;
				break;
			case 'check_availability':
				inputMessage = "Check availability for ";
				textareaElement?.focus();
				break;
			case 'book_meeting':
				inputMessage = "Book a meeting with ";
				textareaElement?.focus();
				break;
			case 'monday_updates':
				sendMessage("Show me the latest updates and action items from Monday.com");
				break;
			case 'monday_tasks':
				sendMessage("Show my assigned action items on Monday.com");
				break;
			case 'monday_boards':
				sendMessage("List the Monday.com boards and their recent updates");
				break;
			case 'box_knowledge':
				sendMessage('Give me full instructions for EOD Reporting');
				break;
			default:
				if (action.length > 15) {
					if (action.endsWith(' ')) {
						inputMessage = action;
						textareaElement?.focus();
					} else {
						sendMessage(action);
					}
				} else {
					inputMessage = action;
					textareaElement?.focus();
				}
		}
	}

	// Handle slot click from availability card
	function handleSlotClick(text: string) {
		inputMessage = text;
		textareaElement?.focus();
	}

	// Handle suggestion click
	function handleSuggestionClick(action: string) {
		handleQuickAction(action);
	}

	function getModeConfig(mode: 'calendar' | 'billing' | 'assistant' | 'monday' | 'box') {
		switch (mode) {
			case 'calendar':
				return {
					label: 'Calendar',
					icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
					color: 'text-sky-400 bg-sky-500/10 border-sky-500/20'
				};
			case 'billing':
				return {
					label: 'Time Entry',
					icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
					color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
				};
			case 'monday':
				return {
					label: 'Monday.com',
					icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
					color: 'text-red-400 bg-red-500/10 border-red-500/20'
				};
			case 'box':
				return {
					label: 'Box',
					icon: 'M3 7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
					color: 'text-[#0061FE] bg-[#0061FE]/12 border-[#0061FE]/30'
				};
			default:
				return {
					label: 'Assistant',
					icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
					color: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
				};
		}
	}

	let modeConfig = $derived.by(() => getModeConfig(currentMode));
	let modeSubLabel = $derived.by(() => {
		if (!isLoading) return 'Online';
		if (toolStatus?.label) return toolStatus.label;
		return `Working in ${modeConfig.label.toLowerCase()} mode`;
	});
</script>

<div class="relative flex h-screen flex-col overflow-hidden mesh-gradient-subtle">
	<div class="pointer-events-none absolute inset-0 dot-pattern opacity-30"></div>
	<div class="ambient-orb ambient-orb-amber"></div>
	<div class="ambient-orb ambient-orb-sky"></div>
	<div class="ambient-orb ambient-orb-violet"></div>

	<!-- Header -->
	<header class="glass sticky top-0 z-20 border-b border-white/5 px-6 py-4">
		<div class="max-w-4xl mx-auto flex justify-between items-center">
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 {isLoading ? 'avatar-thinking' : ''}">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
						</svg>
					</div>
					<div>
						<button
							type="button"
							onclick={togglePatchNotes}
							class="text-xl font-bold text-white hover:text-amber-300 transition-colors cursor-pointer"
							aria-expanded={showPatchNotes}
							aria-label="Toggle Billi patch notes"
						>
							Billi
						</button>
						<div class="mt-0.5 flex items-center gap-2">
							<span class="live-dot"></span>
							<p class="text-xs text-slate-400">{modeSubLabel}</p>
						</div>
					</div>
				</div>

				{#if isLoading}
					<div
						class="flex items-center gap-2 px-3 py-1.5 rounded-full border {modeConfig.color} text-xs font-medium"
						in:fly={{ x: -8, duration: 240, easing: cubicOut }}
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={modeConfig.icon}></path>
						</svg>
						{modeConfig.label}
						{#if currentConfidence > 0}
							<span class="opacity-70">({Math.round(currentConfidence * 100)}%)</span>
						{/if}
					</div>
				{/if}
			</div>

			<button
				onclick={handleClearChat}
				class="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 glass hover:border-red-500/50 rounded-lg transition-colors btn-press"
			>
				Clear Chat
			</button>
			<button
				type="button"
				onclick={togglePatchNotes}
				class="ml-2 px-3 py-1.5 text-sm text-amber-300 hover:text-amber-200 glass border border-amber-500/30 rounded-lg transition-colors btn-press"
				aria-label="Open Billi v1.2 patch notes"
			>
				v1.2 Notes
			</button>
		</div>
	</header>

	{#if showPatchNotes}
		<div
			class="fixed inset-0 z-30 flex items-start justify-center pt-24 px-4 bg-black/35 backdrop-blur-[1px]"
			transition:fade={{ duration: 140 }}
		>
			<div transition:scale={{ duration: 180, start: 0.95, easing: cubicOut }}>
				<PatchNotesSticky
					version="v1.2"
					releaseLabel="Billi Release"
					sections={patchNotesSections}
					onClose={closePatchNotes}
				/>
			</div>
		</div>
	{/if}

	<!-- Messages -->
	<div bind:this={chatScrollElement} onscroll={handleChatScroll} class="relative z-10 flex-1 overflow-y-auto px-6 py-6">
		<div class="max-w-4xl mx-auto">
			{#if isLoadingHistory}
				<div class="flex items-center justify-center py-12">
					<div class="flex items-center gap-3 text-slate-400">
						<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<span>Loading conversation...</span>
					</div>
				</div>
			{:else if showTimeEntryForm}
				<!-- Time Entry Form -->
				<div class="py-6">
					<TimeEntryForm
						onsubmit={handleTimeEntrySubmit}
						oncancel={handleTimeEntryCancel}
						initialHours={pendingTimeEntry?.hours || 0}
					/>
				</div>
			{:else}
				<MessageList
					{messages}
					{isLoading}
					{toolStatus}
					{userName}
					onQuickAction={handleQuickAction}
					onSlotClick={handleSlotClick}
					onSuggestionClick={handleSuggestionClick}
					onPatchNotesClick={togglePatchNotes}
				/>

				{#if streamingContent}
					<div
						class="py-3"
						in:fly={{ y: 10, duration: 280, easing: cubicOut }}
					>
						<div class="flex justify-start">
							<div class="flex-shrink-0 mr-3 mt-1">
								<div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 avatar-thinking">
									<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
									</svg>
								</div>
							</div>
							<div class="max-w-[85%]">
								<div class="glass-light streaming-shell rounded-2xl px-5 py-4 text-slate-200">
									<div class="mb-2 flex items-center gap-2 text-[11px] text-amber-300/90">
										<span class="live-dot"></span>
										<span>Billi is responding</span>
									</div>
									<div class="prose-chat text-sm max-w-none">
										{@html formatMessageWithMarkdown(streamingContent)}
									</div>
									<span class="inline-block w-2 h-5 bg-amber-500 rounded-full animate-pulse ml-1"></span>
								</div>
							</div>
						</div>
					</div>
				{/if}

				{#if pendingMcpApproval}
					<div class="py-3 max-w-[85%]">
						<McpApprovalCard
							toolName={pendingMcpApproval.toolName}
							serverLabel={pendingMcpApproval.serverLabel}
							args={pendingMcpApproval.arguments}
							isProcessing={mcpApprovalProcessing}
							onApprove={() => sendApproval(true, false)}
							onAlwaysAllow={() => sendApproval(true, true)}
							onDeny={() => sendApproval(false, false)}
						/>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Input -->
	<div class="glass sticky bottom-0 z-20 border-t border-white/8 px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<!-- Slash command dropdown -->
			{#if showSlashMenu && filteredSlashCommands.length > 0}
				<div
					class="mb-2 glass overflow-hidden rounded-xl border border-white/10"
					in:scale={{ duration: 180, easing: cubicOut, start: 0.96 }}
				>
					{#each filteredSlashCommands as cmd, i}
						<button
							class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
							onclick={() => selectSlashCommand(cmd)}
							transition:fly={{ y: 4, duration: 200, delay: Math.min(i * 24, 120), easing: quintOut }}
						>
							<span class="text-xs font-mono text-amber-400">{cmd.command}</span>
							<span class="text-sm text-white">{cmd.label}</span>
							<span class="text-xs text-slate-500 ml-auto">{cmd.description}</span>
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex gap-3">
				<div class="flex-1 relative">
					<textarea
						bind:this={textareaElement}
						bind:value={inputMessage}
						onkeydown={handleKeyDown}
						oninput={handleInput}
						placeholder="Ask Billi anything... (type / for commands)"
						class="w-full px-4 py-3 glass-input rounded-xl
						       text-white placeholder-slate-500
						       focus:outline-none
						       resize-none"
						rows="1"
						disabled={isLoading || isLoadingHistory}
						style="min-height: 44px; max-height: 150px;"
					></textarea>
				</div>
				<button
					onclick={() => sendMessage()}
					disabled={isLoading || isLoadingHistory || !inputMessage.trim()}
					class="px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-medium
					       hover:from-amber-400 hover:to-orange-500
					       disabled:opacity-50 disabled:cursor-not-allowed
					       focus:outline-none focus:ring-2 focus:ring-amber-500/50
					       transition-all self-end shadow-lg shadow-amber-500/20 btn-press btn-glow"
				>
					{#if isLoading}
						<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
						</svg>
					{/if}
				</button>
			</div>
			<p class="text-xs text-slate-600 mt-2 text-center">
				Press Enter to send · Shift+Enter for new line · Type <span class="text-slate-500">/</span> for commands
			</p>
		</div>
	</div>
</div>
