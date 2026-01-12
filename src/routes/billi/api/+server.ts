import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BILLI_WEBHOOK_URL } from '$env/static/private';


export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	
	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await event.request.json();
		const { message, sessionId } = body;

		if (!message || typeof message !== 'string') {
			return json({ error: 'Message is required' }, { status: 400 });
		}

		// Get user information from session
		const userName = session.user?.name || session.user?.email || 'Unknown User';

		// Generate a session date for the conversation memory
		const sessionDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
		const formattedSessionId = `_${sessionDate}`;

		// Minimal payload - only what Extract Message Context node needs
		// The workflow's Extract Message Context expects: body.text, body.from.name, body.localTimestamp
		// Wrap in 'body' to match the structure it expects (similar to Azure Bot Framework messages)
		const webhookPayload = {
			body: {
				text: message,
				from: {
					name: userName
				},
				localTimestamp: new Date().toISOString()
			}
		};

		// Send to n8n webhook
		const response = await fetch(BILLI_WEBHOOK_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(webhookPayload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Billi webhook error:', {
				status: response.status,
				statusText: response.statusText,
				body: errorText
			});
			return json(
				{ error: `Failed to send message to Billi: ${response.statusText}` },
				{ status: response.status }
			);
		}

		// The n8n workflow sends the reply via Bot Connector
		// The workflow should return the agent output or the Bot Connector response
		const responseData = await response.json();
		
		console.log('Billi webhook response:', JSON.stringify(responseData, null, 2));
		
		// Handle different response formats
		// n8n webhooks typically return an array with workflow execution results
		let output = responseData;
		if (Array.isArray(responseData) && responseData.length > 0) {
			// Get the output from the last node (Send Reply via Bot Connector)
			// The agent output is in the jsonBody.text field that was sent to Bot Connector
			const lastNodeOutput = responseData[responseData.length - 1];
			
			// Try to extract from various possible locations:
			// 1. Direct output field
			// 2. The text field from the Bot Connector request body
			// 3. The response from Bot Connector API
			if (lastNodeOutput?.json) {
				output = lastNodeOutput.json;
			} else if (lastNodeOutput?.output) {
				output = lastNodeOutput.output;
			} else {
				output = lastNodeOutput;
			}
		}

		// Extract the response text - check multiple possible fields
		// The agent output might be in the text field of the Bot Connector request
		// or in the response from Bot Connector
		let responseText = output?.output || output?.text || output?.response || output?.body?.text;
		
		// If we got the Bot Connector response, try to extract the sent message
		if (!responseText && output?.jsonBody) {
			try {
				const jsonBody = typeof output.jsonBody === 'string' 
					? JSON.parse(output.jsonBody) 
					: output.jsonBody;
				responseText = jsonBody?.text;
			} catch (e) {
				// Ignore parse errors
			}
		}

		if (!responseText) {
			console.warn('Could not extract response text from:', output);
			responseText = 'No response received from Billi';
		}

		return json({ 
			output: responseText,
			sessionId: formattedSessionId 
		});

	} catch (error: any) {
		console.error('Billi API error:', {
			message: error.message,
			stack: error.stack,
			name: error.name,
		});
		return json(
			{
				error: error.message || 'Internal error',
			},
			{ status: 500 }
		);
	}
};
