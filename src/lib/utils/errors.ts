/**
 * Unified Error Handling Utilities
 * Provides consistent error handling patterns across the application
 */

/**
 * Application error codes
 */
export enum ErrorCode {
	NETWORK_ERROR = 'NETWORK_ERROR',
	TIMEOUT_ERROR = 'TIMEOUT_ERROR',
	AUTH_ERROR = 'AUTH_ERROR',
	VALIDATION_ERROR = 'VALIDATION_ERROR',
	API_ERROR = 'API_ERROR',
	NOT_FOUND = 'NOT_FOUND',
	RATE_LIMITED = 'RATE_LIMITED',
	UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Structured application error
 */
export class AppError extends Error {
	public readonly code: ErrorCode;
	public readonly statusCode?: number;
	public readonly details?: Record<string, unknown>;
	public readonly isRetryable: boolean;

	constructor(
		message: string,
		code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
		options?: {
			statusCode?: number;
			details?: Record<string, unknown>;
			isRetryable?: boolean;
			cause?: Error;
		}
	) {
		super(message, { cause: options?.cause });
		this.name = 'AppError';
		this.code = code;
		this.statusCode = options?.statusCode;
		this.details = options?.details;
		this.isRetryable = options?.isRetryable ?? false;
	}

	/**
	 * Create a user-friendly error message
	 */
	toUserMessage(): string {
		switch (this.code) {
			case ErrorCode.NETWORK_ERROR:
				return 'Unable to connect. Please check your internet connection and try again.';
			case ErrorCode.TIMEOUT_ERROR:
				return 'The request took too long. Please try again.';
			case ErrorCode.AUTH_ERROR:
				return 'You need to sign in to continue.';
			case ErrorCode.VALIDATION_ERROR:
				return this.message || 'Please check your input and try again.';
			case ErrorCode.API_ERROR:
				return 'Something went wrong on our end. Please try again later.';
			case ErrorCode.NOT_FOUND:
				return 'The requested resource was not found.';
			case ErrorCode.RATE_LIMITED:
				return 'Too many requests. Please wait a moment and try again.';
			default:
				return 'An unexpected error occurred. Please try again.';
		}
	}

	/**
	 * Convert to JSON for logging/API responses
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			statusCode: this.statusCode,
			details: this.details,
			isRetryable: this.isRetryable,
		};
	}
}

/**
 * Parse an unknown error into an AppError
 */
export function parseError(error: unknown): AppError {
	// Already an AppError
	if (error instanceof AppError) {
		return error;
	}

	// Standard Error
	if (error instanceof Error) {
		// Check for specific error types
		if (error.name === 'AbortError') {
			return new AppError('Request was cancelled', ErrorCode.NETWORK_ERROR, {
				isRetryable: false,
				cause: error,
			});
		}

		if (error.name === 'TypeError' && error.message.includes('fetch')) {
			return new AppError('Network error', ErrorCode.NETWORK_ERROR, {
				isRetryable: true,
				cause: error,
			});
		}

		// Check message for common patterns
		const message = error.message.toLowerCase();

		if (message.includes('timeout') || message.includes('timed out')) {
			return new AppError(error.message, ErrorCode.TIMEOUT_ERROR, {
				isRetryable: true,
				cause: error,
			});
		}

		if (message.includes('unauthorized') || message.includes('401')) {
			return new AppError(error.message, ErrorCode.AUTH_ERROR, {
				statusCode: 401,
				isRetryable: false,
				cause: error,
			});
		}

		if (message.includes('not found') || message.includes('404')) {
			return new AppError(error.message, ErrorCode.NOT_FOUND, {
				statusCode: 404,
				isRetryable: false,
				cause: error,
			});
		}

		if (message.includes('rate limit') || message.includes('429') || message.includes('too many')) {
			return new AppError(error.message, ErrorCode.RATE_LIMITED, {
				statusCode: 429,
				isRetryable: true,
				cause: error,
			});
		}

		// Default to API error for other errors
		return new AppError(error.message, ErrorCode.API_ERROR, {
			isRetryable: true,
			cause: error,
		});
	}

	// Unknown error type
	const message = typeof error === 'string' ? error : 'An unknown error occurred';
	return new AppError(message, ErrorCode.UNKNOWN_ERROR, {
		isRetryable: false,
		details: { originalError: error },
	});
}

/**
 * Create an error response object for API endpoints
 */
export function createErrorResponse(error: unknown, requestId?: string | number | null): {
	jsonrpc: string;
	id: string | number | null;
	error: {
		code: number;
		message: string;
		data?: Record<string, unknown>;
	};
} {
	const appError = parseError(error);

	// Map error codes to JSON-RPC error codes
	const jsonRpcCode = (() => {
		switch (appError.code) {
			case ErrorCode.VALIDATION_ERROR:
				return -32602; // Invalid params
			case ErrorCode.NOT_FOUND:
				return -32601; // Method not found
			case ErrorCode.AUTH_ERROR:
				return -32600; // Invalid request
			default:
				return -32603; // Internal error
		}
	})();

	return {
		jsonrpc: '2.0',
		id: requestId ?? null,
		error: {
			code: jsonRpcCode,
			message: appError.message,
			data: appError.details,
		},
	};
}

/**
 * Safely extract error message from API response
 */
export function extractErrorMessage(response: unknown): string {
	if (!response || typeof response !== 'object') {
		return 'Unknown error';
	}

	const obj = response as Record<string, unknown>;

	// Try common error field patterns
	if (typeof obj.error === 'string') {
		return obj.error;
	}

	if (typeof obj.error === 'object' && obj.error !== null) {
		const errorObj = obj.error as Record<string, unknown>;
		if (typeof errorObj.message === 'string') {
			return errorObj.message;
		}
	}

	if (typeof obj.message === 'string') {
		return obj.message;
	}

	if (typeof obj.errorMessage === 'string') {
		return obj.errorMessage;
	}

	return 'Unknown error';
}
