# LLM Responses MCP Server

A Model Context Protocol (MCP) server that enables collaborative debates between multiple AI agents, allowing them to discuss and reach consensus on user prompts.

## Overview

This project implements an MCP server that facilitates multi-turn conversations between LLMs with these key features:

1. **Session-based collaboration** - LLMs can register as participants in a debate session
2. **Deliberative consensus** - LLMs can engage in extended discussions to reach agreement
3. **Real-time response sharing** - All participants can view and respond to each other's contributions

The server provides four main tool calls:

1. `register-participant`: Allows an LLM to join a collaboration session with its initial response
2. `submit-response`: Allows an LLM to submit follow-up responses during the debate
3. `get-responses`: Allows an LLM to retrieve all responses from other LLMs in the session
4. `get-session-status`: Allows an LLM to check if the registration waiting period has completed

This enables a scenario where multiple AI agents (like the "Council of Ephors") can engage in extended deliberation about a user's question, debating with each other until they reach a solid consensus.

## Installation

```bash
# Install dependencies
bun install
```

## Development

```bash
# Build the TypeScript code
bun run build

# Start the server in development mode
bun run dev
```

## Testing with MCP Inspector

The project includes support for the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is a tool for testing and debugging MCP servers.

```bash
# Run the server with MCP Inspector
bun run inspect
```

The `inspect` script uses `npx` to run the MCP Inspector, which will launch a web interface in your browser for interacting with your MCP server.

This will allow you to:
- Explore available tools and resources
- Test tool calls with different parameters
- View the server's responses
- Debug your MCP server implementation

## Usage

The server exposes two endpoints:

- `/sse` - Server-Sent Events endpoint for MCP clients to connect
- `/messages` - HTTP endpoint for MCP clients to send messages

### MCP Tools

#### register-participant

Register as a participant in a collaboration session:

```typescript
// Example tool call
const result = await client.callTool({
  name: 'register-participant',
  arguments: {
    name: 'Socrates',
    prompt: 'What is the meaning of life?',
    initial_response: 'The meaning of life is to seek wisdom through questioning...',
    persona_metadata: {
      style: 'socratic',
      era: 'ancient greece'
    } // Optional
  }
});
```

The server waits for a 3-second registration period after the last participant joins before responding. The response includes all participants' initial responses, enabling each LLM to immediately respond to other participants' views when the registration period ends.

#### submit-response

Submit a follow-up response during the debate:

```typescript
// Example tool call
const result = await client.callTool({
  name: 'submit-response',
  arguments: {
    sessionId: 'EPH4721R-Socrates', // Session ID received after registration
    prompt: 'What is the meaning of life?',
    response: 'In response to Plato, I would argue that...'
  }
});
```

#### get-responses

Retrieve all responses from the debate session:

```typescript
// Example tool call
const result = await client.callTool({
  name: 'get-responses',
  arguments: {
    sessionId: 'EPH4721R-Socrates', // Session ID received after registration
    prompt: 'What is the meaning of life?' // Optional
  }
});
```

The response includes all participants' contributions in chronological order.

#### get-session-status

Check if the registration waiting period has elapsed:

```typescript
// Example tool call
const result = await client.callTool({
  name: 'get-session-status',
  arguments: {
    prompt: 'What is the meaning of life?'
  }
});
```

## Collaborative Debate Flow

1. LLMs register as participants with their initial responses to the prompt
2. The server waits 3 seconds after the last registration before sending responses
3. When the registration period ends, all participants receive the compendium of initial responses from all participants
4. Participants can then submit follow-up responses, responding to each other's points
5. The debate continues until the participants reach a consensus or a maximum number of rounds is reached

## License

MIT 

## Deployment to EC2

This project includes Docker configuration for easy deployment to EC2 or any other server environment.

### Prerequisites

- An EC2 instance running Amazon Linux 2 or Ubuntu
- Security group configured to allow inbound traffic on port 62886
- SSH access to the instance

### Deployment Steps

1. Clone the repository to your EC2 instance:
   ```bash
   git clone <your-repository-url>
   cd <repository-directory>
   ```

2. Make the deployment script executable:
   ```bash
   chmod +x deploy.sh
   ```

3. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

The script will:
- Install Docker and Docker Compose if they're not already installed
- Build the Docker image
- Start the container in detached mode
- Display the public URL where your MCP server is accessible

### Manual Deployment

If you prefer to deploy manually:

1. Build the Docker image:
   ```bash
   docker-compose build
   ```

2. Start the container:
   ```bash
   docker-compose up -d
   ```

3. Verify the container is running:
   ```bash
   docker-compose ps
   ```

### Accessing the Server

Once deployed, your MCP server will be accessible at:
- `http://<ec2-public-ip>:62886/sse` - SSE endpoint
- `http://<ec2-public-ip>:62886/messages` - Messages endpoint

Make sure port 62886 is open in your EC2 security group! 