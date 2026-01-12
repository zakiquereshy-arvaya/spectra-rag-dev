/**
 * Debounce and Throttle Utilities
 * Prevents excessive function calls
 */

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Debounce a function - delays execution until after wait milliseconds
 * have elapsed since the last call
 */
export function debounce<T extends AnyFunction>(
	fn: T,
	wait: number
): {
	(...args: Parameters<T>): void;
	cancel: () => void;
	flush: () => void;
} {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;

	const debounced = (...args: Parameters<T>) => {
		lastArgs = args;

		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			if (lastArgs) {
				fn.apply(null, lastArgs);
				lastArgs = null;
			}
			timeoutId = null;
		}, wait);
	};

	debounced.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		lastArgs = null;
	};

	debounced.flush = () => {
		if (timeoutId !== null && lastArgs) {
			clearTimeout(timeoutId);
			fn.apply(null, lastArgs);
			lastArgs = null;
			timeoutId = null;
		}
	};

	return debounced;
}

/**
 * Throttle a function - ensures function is called at most once per wait milliseconds
 */
export function throttle<T extends AnyFunction>(
	fn: T,
	wait: number
): {
	(...args: Parameters<T>): void;
	cancel: () => void;
} {
	let lastTime = 0;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;

	const throttled = (...args: Parameters<T>) => {
		const now = Date.now();
		const remaining = wait - (now - lastTime);

		lastArgs = args;

		if (remaining <= 0) {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			lastTime = now;
			fn.apply(null, args);
		} else if (timeoutId === null) {
			timeoutId = setTimeout(() => {
				lastTime = Date.now();
				timeoutId = null;
				if (lastArgs) {
					fn.apply(null, lastArgs);
				}
			}, remaining);
		}
	};

	throttled.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		lastArgs = null;
	};

	return throttled;
}

/**
 * Leading edge debounce - executes immediately, then debounces subsequent calls
 */
export function debounceLeading<T extends AnyFunction>(
	fn: T,
	wait: number
): {
	(...args: Parameters<T>): void;
	cancel: () => void;
} {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastCallTime = 0;

	const debounced = (...args: Parameters<T>) => {
		const now = Date.now();

		if (now - lastCallTime >= wait) {
			lastCallTime = now;
			fn.apply(null, args);
		}

		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			timeoutId = null;
		}, wait);
	};

	debounced.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	return debounced;
}

/**
 * Request deduplication - prevents duplicate concurrent requests
 */
export function deduplicateRequests<T>(
	fn: (...args: unknown[]) => Promise<T>,
	keyFn: (...args: unknown[]) => string = (...args) => JSON.stringify(args)
): (...args: unknown[]) => Promise<T> {
	const pending = new Map<string, Promise<T>>();

	return async (...args: unknown[]): Promise<T> => {
		const key = keyFn(...args);

		if (pending.has(key)) {
			return pending.get(key)!;
		}

		const promise = fn(...args).finally(() => {
			pending.delete(key);
		});

		pending.set(key, promise);
		return promise;
	};
}
