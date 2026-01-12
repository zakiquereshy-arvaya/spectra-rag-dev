/**
 * Retry Utility with Exponential Backoff
 * Provides resilient API calls with automatic retries
 */

export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
	retryOn?: (error: Error, attempt: number) => boolean;
	onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryOn' | 'onRetry'>> = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 10000,
	backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'retryOn' | 'onRetry'>>): number {
	const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
	const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
	// Add jitter (0-25% of delay) to prevent thundering herd
	const jitter = cappedDelay * Math.random() * 0.25;
	return Math.floor(cappedDelay + jitter);
}

/**
 * Default retry condition - retry on network errors and 5xx status codes
 */
function defaultRetryOn(error: Error): boolean {
	// Retry on network errors
	if (error.name === 'TypeError' && error.message.includes('fetch')) {
		return true;
	}

	// Retry on specific error messages
	const retryableMessages = [
		'network',
		'timeout',
		'ECONNRESET',
		'ECONNREFUSED',
		'ETIMEDOUT',
		'rate limit',
		'too many requests',
		'503',
		'502',
		'504',
	];

	const errorMessage = error.message.toLowerCase();
	return retryableMessages.some((msg) => errorMessage.includes(msg.toLowerCase()));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const retryOn = options.retryOn || defaultRetryOn;

	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Check if we should retry
			if (attempt > opts.maxRetries || !retryOn(lastError, attempt)) {
				throw lastError;
			}

			// Calculate delay and wait
			const delayMs = calculateDelay(attempt, opts);

			// Call onRetry callback if provided
			if (options.onRetry) {
				options.onRetry(lastError, attempt, delayMs);
			}

			await sleep(delayMs);
		}
	}

	throw lastError || new Error('Retry failed');
}

/**
 * Fetch with retry, timeout, and abort signal support
 */
export interface FetchWithRetryOptions extends RetryOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	options: FetchWithRetryOptions = {}
): Promise<Response> {
	const { timeoutMs = 30000, signal, ...retryOptions } = options;

	return withRetry(async () => {
		// Create abort controller for timeout
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

		// Combine signals if external signal provided
		const combinedSignal = signal
			? combineAbortSignals(signal, timeoutController.signal)
			: timeoutController.signal;

		try {
			const response = await fetch(url, {
				...init,
				signal: combinedSignal,
			});

			// Throw on 5xx errors to trigger retry
			if (response.status >= 500) {
				throw new Error(`Server error: ${response.status}`);
			}

			return response;
		} finally {
			clearTimeout(timeoutId);
		}
	}, retryOptions);
}

/**
 * Combine multiple abort signals into one
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
	const controller = new AbortController();

	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			return controller.signal;
		}
		signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
	}

	return controller.signal;
}

/**
 * Create a fetch function with built-in retry for a specific API
 */
export function createRetryableFetch(baseOptions: FetchWithRetryOptions = {}) {
	return (url: string, init?: RequestInit, options?: FetchWithRetryOptions) =>
		fetchWithRetry(url, init, { ...baseOptions, ...options });
}
