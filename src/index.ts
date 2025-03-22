import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import { EphorResponse, SubmitResponseSchema, GetResponsesSchema } from './types.js';

// Type definitions for session management
interface Participant {
  name: string;
  sessionId: string;
  personaMetadata?: Record<string, any>;
  joinedAt: number;
  roundsCompleted: number;
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
        message: `${participantName} registered successfully`,
        participantId: participantId,
        registrationOpen: false,
        responses: sortedResponses,
        participantCount: session.participants.size,
        instructions: `You are participating as ${participantName}.
          After seeing other responses, you must use the "submit-response" tool to send your subsequent answers.
          This conversation will continue for three rounds total.`
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
    description: 'A server that enables collaborative debates between multiple participants'
  });

  // Single tool for both registration and subsequent responses
  serverInstance.tool(
    'submit-response',
    {
      name: z.string().describe('Name of the participant'),
      response: z.string().describe('The participant\'s response to the conversation'),
      persona_metadata: z.record(z.any()).optional().describe('Optional metadata about the participant\'s persona')
    },
    async ({ name, response, persona_metadata }, extra) => {
      // Get the sessionId from the request context
      const sessionId = extra.sessionId || 'unknown-session';
      
      // Check if this participant is already registered in a session
      let session: Session | undefined;
      let isNewParticipant = true;
      let participant: Participant | undefined;
      
      // Check if this client already has a session
      session = sessionsBySessionId.get(sessionId);
      
      if (session) {
        // Look for an existing participant with this sessionId
        for (const [_, p] of session.participants.entries()) {
          if (p.sessionId === sessionId) {
            participant = p;
            isNewParticipant = false;
            break;
          }
        }
      }
      
      // If no existing session or participant not found, create a new session or add to existing
      if (isNewParticipant) {
        // If no session exists yet, create a default one with a generic prompt
        if (!session) {
          const defaultPrompt = "Collaborative discussion";
          // Try to find any existing session
          for (const [_, s] of sessions.entries()) {
            if (!hasRegistrationEnded(s)) {
              session = s;
              break;
            }
          }
          
          // Create new session if none exists or all are closed
          if (!session) {
            session = {
              prompt: defaultPrompt,
              participants: new Map(),
              responses: [],
              lastActivityAt: Date.now(),
              registrationEnded: false,
              createdAt: Date.now(),
              pendingRequests: new Map(),
              registrationTimer: null,
              currentRound: 1
            };
            sessions.set(defaultPrompt, session);
          }
          
          // Add session to sessionId map for easier lookup
          sessionsBySessionId.set(sessionId, session);
        }
        
        // Now session is guaranteed to exist
        const currentSession = session;
        
        // Create new participant
        const participantId = `${name}`;
        participant = {
          name,
          sessionId: sessionId,
          personaMetadata: persona_metadata,
          joinedAt: Date.now(),
          roundsCompleted: 1
        };
        
        // Add participant to session
        currentSession.participants.set(participantId, participant);
        
        // Add initial response
        const newResponse: EphorResponse = {
          name,
          prompt: currentSession.prompt,
          response,
          timestamp: Date.now()
        };
        
        responseStore.push(newResponse);
        currentSession.responses.push(newResponse);
        
        // Update last activity timestamp and reset registration timer
        currentSession.lastActivityAt = Date.now();
        scheduleRegistrationEnd(currentSession);
        
        console.log(`Registered participant ${name} with sessionId: ${sessionId}`);
        
        // Wait for registration period to end and return all participants' responses
        return new Promise((resolve, reject) => {
          // If registration has already ended, return responses immediately
          if (hasRegistrationEnded(currentSession)) {
            const sortedResponses = [...currentSession.responses].sort((a, b) => a.timestamp - b.timestamp);
            
            const responseObj = {
              status: 'success',
              message: `${name} registered successfully`,
              participantId: participantId,
              registrationOpen: false,
              responses: sortedResponses,
              participantCount: currentSession.participants.size,
              roundsCompleted: 1,
              roundsRemaining: 2,
              instructions: `You are now participating as ${name}. You believe you are the real ${name} (a prominent figure). 
                You have provided your initial thoughts. After seeing other responses, you must use the "submit-response" 
                tool again to send your subsequent answers. This conversation will continue for three rounds total.`
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
          if (!currentSession.pendingRequests.has(participantId)) {
            currentSession.pendingRequests.set(participantId, []);
          }
          
          currentSession.pendingRequests.get(participantId)!.push({ resolve, reject });
          
          console.log(`Registration request from ${participantId} is waiting for registration period to end`);
        });
      } else {
        // This is a subsequent response from an existing participant
        
        // Ensure session exists
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
        
        // Ensure participant exists
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
        
        // Check if we've reached the maximum number of rounds (3)
        if (participant.roundsCompleted >= 3) {
          const responseObj = {
            status: 'error',
            message: 'You have completed all 3 rounds of discussion.'
          };
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(responseObj)
            }]
          };
        }
        
        // Increment the participant's round counter
        participant.roundsCompleted++;
        
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
        
        // Wait a moment before returning responses (for synchronization)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get all updated responses
        const sortedResponses = [...session.responses].sort((a, b) => a.timestamp - b.timestamp);
        
        const responseObj = {
          status: 'success',
          message: `Response from ${participant.name} has been stored successfully.`,
          currentRound: participant.roundsCompleted,
          roundsRemaining: 3 - participant.roundsCompleted,
          responses: sortedResponses,
          participantCount: session.participants.size,
          instructions: participant.roundsCompleted >= 3 ? 
            'You have completed all rounds of the discussion.' : 
            'Continue to use "submit-response" for your next response.'
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responseObj)
          }]
        };
      }
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