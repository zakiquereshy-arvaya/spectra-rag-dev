// Model Context Protocol (MCP) Types

export interface MCPRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: Record<string, any>;
}

export interface MCPResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: any;
	error?: {
		code: number;
		message: string;
		data?: any;
	};
}

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, {
			type: string;
			description: string;
			enum?: string[];
		}>;
		required?: string[];
	};
}

export interface MCPToolCall {
	name: string;
	arguments: Record<string, any>;
}

export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface MCPPrompt {
	name: string;
	description?: string;
	arguments?: Array<{
		name: string;
		description?: string;
		type?: string;
		required?: boolean;
	}>;
}

// MCP Server Capabilities
export interface MCPServerCapabilities {
	tools?: {
		listChanged?: boolean;
	};
	resources?: {
		subscribe?: boolean;
		listChanged?: boolean;
	};
	prompts?: {
		listChanged?: boolean;
	};
}

// MCP Initialize Request/Response
export interface MCPInitializeRequest extends MCPRequest {
	method: 'initialize';
	params: {
		protocolVersion: string;
		capabilities: Record<string, any>;
		clientInfo: {
			name: string;
			version: string;
		};
	};
}

export interface MCPInitializeResponse extends MCPResponse {
	result: {
		protocolVersion: string;
		capabilities: MCPServerCapabilities;
		serverInfo: {
			name: string;
			version: string;
		};
	};
}

// MCP Tools List Request/Response
export interface MCPToolsListRequest extends MCPRequest {
	method: 'tools/list';
}

export interface MCPToolsListResponse extends MCPResponse {
	result: {
		tools: MCPTool[];
	};
}

// MCP Tools Call Request/Response
export interface MCPToolsCallRequest extends MCPRequest {
	method: 'tools/call';
	params: {
		name: string;
		arguments?: Record<string, any>;
	};
}

export interface MCPToolsCallResponse extends MCPResponse {
	result: {
		content: Array<{
			type: 'text' | 'image' | 'resource';
			text?: string;
			data?: string;
			mimeType?: string;
			uri?: string;
		}>;
		isError?: boolean;
	};
}
