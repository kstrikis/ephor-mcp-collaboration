import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import { EphorResponse, SubmitResponseSchema, GetResponsesSchema } from './types.js';

// Type definitions for session management
interface Participant {
  name: string;
  initialResponse: string;
  participantId: string;
  sessionId: string;
  personaMetadata?: Record<string, any>;
  joinedAt: number;
  roundsCompleted?: number;
}

interface PendingRequestResolver {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

interface Session {
  prompt: string;
  participants: Map<string, Participant>;
  responses: EphorResponse[];
  lastActivityAt: number;
  registrationEnded: boolean;
  createdAt: number;
  pendingRequests: Map<string, PendingRequestResolver[]>;
  registrationTimer: NodeJS.Timeout | null;
  currentRound: number;
}

// In-memory storage for sessions and Ephor responses
const responseStore: EphorResponse[] = [];
const sessions: Map<string, Session> = new Map();
// Map to track sessions by sessionId for easier lookup
const sessionsBySessionId: Map<string, Session> = new Map();

// Helper to check if registration period has ended
const hasRegistrationEnded = (session: Session): boolean => {
  return session.registrationEnded;
}

// Schedule registration end for a session
const scheduleRegistrationEnd = (session: Session) => {
  // Clear any existing timer
  if (session.registrationTimer) {
    clearTimeout(session.registrationTimer);
  }
  
  // Set new timer - wait 0.5 seconds after last activity
  session.registrationTimer = setTimeout(() => {
    console.log(`Registration period ended for session with prompt "${session.prompt.substring(0, 30)}..."`);
    session.registrationEnded = true;
    
    // Resolve all pending requests
    resolveAllPendingRequests(session);
  }, 500);
};

// Resolve all pending requests for a session
const resolveAllPendingRequests = (session: Session) => {
  const sortedResponses = [...session.responses].sort((a, b) => a.timestamp - b.timestamp);
  
  // Resolve all pending requests with the response data
  for (const [participantId, resolvers] of session.pendingRequests.entries()) {
    for (const resolver of resolvers) {
      // Extract the participant name from the ID (format: name)
      const participantName = participantId.includes('-') 
        ? participantId.split('-').slice(1).join('-') 
        : participantId;
      
      const responseObj = {
        status: 'success',
        message: `${participantName} registered successfully for prompt "${session.prompt.substring(0, 30)}..."`,
        participantId: participantId,
        registrationOpen: false,
        responses: sortedResponses,
        participantCount: session.participants.size,
        instructions: `You are participating as ${participantName}. You believe you are the real ${participantName} (a prominent figure).
          After seeing other responses, you must use the "submit-response" tool to send your subsequent answers, 
          and use the "get-responses" tool to read responses. This conversation will continue for four rounds total.
          Remember to stay in character as ${participantName} throughout the entire conversation.`
      };
      
      resolver.resolve({
        content: [{
          type: 'text',
          text: JSON.stringify(responseObj)
        }]
      });
    }
  }
  
  // Clear pending requests
  session.pendingRequests.clear();
};

// Set up Express server with SSE transport
const app = express();
const PORT = process.env.PORT || 62887;

// Map to store client-specific server instances by sessionId
const clientServers = new Map<string, {
  server: McpServer,
  transport: SSEServerTransport
}>();

// Function to create a new McpServer instance with all our tools
function createServerInstance() {
  const serverInstance = new McpServer({
    name: 'ephor-collaboration-server',
    version: '1.0.0',
    description: 'A server that enables collaborative debates between multiple Ephors who believe they are real people'
  });

  // Register all tools on this server instance
  
  // Tool for registering a participant
  serverInstance.tool(
    'register-participant',
    {
      name: z.string().describe('Name of the Ephor (who believes they are a real person like Elon Musk, Bill Gates, etc.)'),
      prompt: z.string().describe('The original prompt given to the Ephor'),
      initial_response: z.string().describe('The Ephor\'s initial response to the prompt'),
      persona_metadata: z.record(z.any()).optional().describe('Optional metadata about the Ephor\'s persona')
    },
    async ({ name, prompt, initial_response, persona_metadata }, extra) => {
      // Get the sessionId from the request context
      const sessionId = extra.sessionId || 'unknown-session';
      
      // Check if a session for this prompt already exists
      let session: Session | undefined;
      
      // Try to find existing session for this prompt
      session = sessions.get(prompt);
      
      // Create new session if none exists
      if (!session || hasRegistrationEnded(session)) {
        session = {
          prompt,
          participants: new Map(),
          responses: [],
          lastActivityAt: Date.now(),
          registrationEnded: false,
          createdAt: Date.now(),
          pendingRequests: new Map(),
          registrationTimer: null,
          currentRound: 1
        };
        sessions.set(prompt, session);
      }
      
      // Add session to sessionId map for easier lookup
      sessionsBySessionId.set(sessionId, session);
      
      // Create participant
      const participantId = `${name}`;
      const participant: Participant = {
        name,
        initialResponse: initial_response,
        participantId: participantId,
        sessionId: sessionId,
        personaMetadata: persona_metadata,
        joinedAt: Date.now(),
        roundsCompleted: 0
      };
      
      // Add participant to session
      session.participants.set(participantId, participant);
      
      // Add initial response to response store
      const newResponse: EphorResponse = {
        name,
        prompt,
        response: initial_response,
        timestamp: Date.now()
      };
      
      responseStore.push(newResponse);
      session.responses.push(newResponse);
      
      // Update last activity timestamp and reset registration timer
      session.lastActivityAt = Date.now();
      scheduleRegistrationEnd(session);
      
      // Log the registration with sessionId for debugging
      console.log(`Registered participant ${name} with sessionId: ${sessionId}`);
      
      // Instead of returning immediately, wait for registration period to end and return all participants' responses
      return new Promise((resolve, reject) => {
        // If registration has already ended, return responses immediately
        if (hasRegistrationEnded(session)) {
          const sortedResponses = [...session.responses].sort((a, b) => a.timestamp - b.timestamp);
          
          const responseObj = {
            status: 'success',
            message: `${name} registered successfully for prompt "${prompt.substring(0, 30)}..."`,
            participantId: participantId,
            registrationOpen: false,
            responses: sortedResponses,
            participantCount: session.participants.size,
            instructions: `You are now participating as ${name}. You believe you are the real ${name} (a prominent figure). 
              You have provided your initial thoughts. After seeing other responses, you must use the "submit-response" 
              tool to send your subsequent answers, and use the "get-responses" tool to read responses. 
              This conversation will continue for four rounds total.`
          };
          
          resolve({
            content: [{
              type: 'text',
              text: JSON.stringify(responseObj)
            }]
          });
          return;
        }
        
        // Store promise resolver for participant
        if (!session.pendingRequests.has(participantId)) {
          session.pendingRequests.set(participantId, []);
        }
        
        session.pendingRequests.get(participantId)!.push({ resolve, reject });
        
        console.log(`Registration request from ${participantId} is waiting for registration period to end`);
      });
    }
  );

  // Tool for getting session status
  serverInstance.tool(
    'get-session-status',
    {},
    async ({}, extra) => {
      // Get sessionId from request context
      const sessionId = extra.sessionId || 'unknown-session';
      
      // Find session for this sessionId
      const session = sessionsBySessionId.get(sessionId);
      
      if (!session) {
        const responseObj = {
          status: 'not_found',
          message: 'No session found for this client'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      const responseObj = {
        status: session.registrationEnded ? 'ready' : 'waiting',
        participantCount: session.participants.size,
        prompt: session.prompt.substring(0, 30) + '...'
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(responseObj)
        }]
      };
    }
  );

  // Tool for submitting an Ephor's response during debate
  serverInstance.tool(
    'submit-response',
    {
      response: z.string().describe('The Ephor\'s response to the prompt')
    },
    async ({ response }, extra) => {
      // Get sessionId from request context
      const sessionId = extra.sessionId || 'unknown-session';
      
      // Find session for this sessionId
      const session = sessionsBySessionId.get(sessionId);
      
      if (!session) {
        const responseObj = {
          status: 'error',
          message: 'Session not found'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // Check if registration period has ended
      if (!hasRegistrationEnded(session)) {
        const responseObj = {
          status: 'error',
          message: 'Registration period has not ended yet'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // Find the participant by sessionId
      let participant: Participant | undefined;
      for (const [_, p] of session.participants.entries()) {
        if (p.sessionId === sessionId) {
          participant = p;
          break;
        }
      }
      
      if (!participant) {
        const responseObj = {
          status: 'error',
          message: 'Participant not found in this session'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // Check if we've reached the maximum number of rounds (4)
      if (participant.roundsCompleted && participant.roundsCompleted >= 4) {
        const responseObj = {
          status: 'error',
          message: 'You have completed all 4 rounds of discussion.'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // Increment the participant's round counter
      if (!participant.roundsCompleted) {
        participant.roundsCompleted = 1;
      } else {
        participant.roundsCompleted++;
      }
      
      // Add response
      const newResponse: EphorResponse = {
        name: participant.name,
        prompt: session.prompt,
        response,
        timestamp: Date.now()
      };
      
      console.log(`Received response from ${participant.name} (sessionId: ${sessionId}) - Round ${participant.roundsCompleted}`);
      
      responseStore.push(newResponse);
      session.responses.push(newResponse);
      
      const responseObj = {
        status: 'success',
        message: `Response from ${participant.name} has been stored successfully.`,
        currentRound: participant.roundsCompleted,
        roundsRemaining: 4 - participant.roundsCompleted,
        instructions: participant.roundsCompleted >= 4 ? 
          'You have completed all rounds of the discussion.' : 
          'Continue to use "get-responses" to see other responses and "submit-response" for your next response.'
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(responseObj)
        }]
      };
    }
  );

  // Tool for retrieving all Ephor responses
  serverInstance.tool(
    'get-responses',
    {},
    async ({}, extra) => {
      // Get sessionId from request context
      const sessionId = extra.sessionId || 'unknown-session';
      
      // Find the relevant session
      const session = sessionsBySessionId.get(sessionId);
      
      if (!session) {
        const responseObj = {
          status: 'error',
          message: 'No session found for this client'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // If registration has ended, return responses immediately
      if (hasRegistrationEnded(session)) {
        const sortedResponses = [...session.responses].sort((a, b) => a.timestamp - b.timestamp);
        
        const responseObj = {
          status: 'success',
          responses: sortedResponses,
          participantCount: session.participants.size,
          prompt: session.prompt.substring(0, 30) + '...',
          instructions: 'Review these responses from other participants. Remember you are roleplaying as a real person. Use the "submit-response" tool to submit your next response in the discussion.'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
      
      // Otherwise, wait for registration to end
      return new Promise((resolve, reject) => {
        // Store promise resolver for participant
        const requestId = `client-${sessionId}`;
        if (!session.pendingRequests.has(requestId)) {
          session.pendingRequests.set(requestId, []);
        }
        
        session.pendingRequests.get(requestId)!.push({ resolve, reject });
        
        console.log(`Request from ${requestId} is waiting for registration to end`);
      });
    }
  );

  return serverInstance;
}

// SSE endpoint for client connections
app.get('/sse', async (req, res) => {
  // Create a new transport for this client
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;
  
  // Create a new server instance for this client
  const server = createServerInstance();
  await server.connect(transport);
  
  // Store the server and transport
  clientServers.set(sessionId, { server, transport });
  
  // Clean up when connection closes
  res.on('close', () => {
    clientServers.delete(sessionId);
    console.log(`Client disconnected, sessionId: ${sessionId}`);
  });
  
  console.log(`New client connected, sessionId: ${sessionId}`);
});

// Message endpoint for clients to send messages
app.post('/messages', async (req, res) => {
  try {
    // Extract sessionId from request headers or query parameters
    const sessionId = req.headers['x-session-id'] as string || req.query.sessionId as string;
    
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }
    
    // Find the corresponding client server
    const clientServer = clientServers.get(sessionId);
    
    if (!clientServer) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    // Route the message to the correct transport
    await clientServer.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`MCP server running at http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`- SSE: http://localhost:${PORT}/sse`);
  console.log(`- Messages: http://localhost:${PORT}/messages (include x-session-id header or sessionId query parameter)`);
}); 