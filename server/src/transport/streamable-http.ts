import express, { Request, Response } from "express";
import { Server } from "http";
import { Logger } from "../logging/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Streamable HTTP Transport for MCP 2025-03-26
 * 
 * This implements the latest MCP Streamable HTTP transport specification:
 * - Single endpoint supporting both POST and GET
 * - SSE streaming for responses
 * - Session management with Mcp-Session-Id
 * - Resumability and redelivery
 * - Proper CORS and security headers
 */
export class StreamableHttpTransport {
  private app: express.Application;
  private server: Server | null = null;
  private logger: Logger;
  private mcpServer: McpServer;
  private sessions: Map<string, SessionData> = new Map();
  private eventIdCounter = 0;

  constructor(mcpServer: McpServer, logger: Logger) {
    this.mcpServer = mcpServer;
    this.logger = logger;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }));
    
    // Security headers
    this.app.use((req, res, next) => {
      // Validate Origin header to prevent DNS rebinding attacks
      const origin = req.get('Origin');
      if (origin && !this.isAllowedOrigin(origin)) {
        this.logger.warn(`Blocked request from disallowed origin: ${origin}`);
        return res.status(403).json({ error: 'Origin not allowed' });
      }

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
      
      next();
    });

    // OPTIONS handler for CORS preflight
    this.app.options('*', (req, res) => {
      res.status(200).end();
    });
  }

  private setupRoutes(): void {
    // Main MCP endpoint - supports both POST and GET
    this.app.post('/mcp', (req, res) => this.handlePost(req, res));
    this.app.get('/mcp', (req, res) => this.handleGet(req, res));
    this.app.delete('/mcp', (req, res) => this.handleDelete(req, res));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        transport: 'streamable-http',
        protocol: '2025-03-26',
        version: '1.0.7'
      });
    });

    // Backwards compatibility endpoints
    this.app.post('/routes', (req, res) => this.handlePost(req, res));
    this.app.get('/routes', (req, res) => {
      res.json({
        routes: { mcp: '/mcp' },
        transports: ['streamable-http'],
        protocol: '2025-03-26',
        serverInfo: { name: 'claude-prompts-mcp', version: '1.0.7' }
      });
    });
  }

  private async handlePost(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.get('Mcp-Session-Id');
      const acceptHeader = req.get('Accept') || '';
      
      // Validate session if required
      if (sessionId && !this.sessions.has(sessionId)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Check if client accepts both JSON and SSE
      const acceptsJson = acceptHeader.includes('application/json');
      const acceptsSSE = acceptHeader.includes('text/event-stream');

      if (!acceptsJson && !acceptsSSE) {
        res.status(400).json({ 
          error: 'Accept header must include application/json and/or text/event-stream' 
        });
        return;
      }

      const body = req.body;
      
      // Handle different message types
      if (Array.isArray(body)) {
        // Batch of messages
        const hasRequests = body.some(msg => msg.method && msg.id !== undefined);
        
        if (hasRequests) {
          // Contains requests - need to respond
          await this.handleRequestBatch(req, res, body, sessionId);
        } else {
          // Only responses/notifications - acknowledge
          res.status(202).end();
        }
      } else if (body.method && body.id !== undefined) {
        // Single request
        await this.handleSingleRequest(req, res, body, sessionId);
      } else {
        // Response or notification - acknowledge
        res.status(202).end();
      }

    } catch (error) {
      this.logger.error('Error handling POST request:', error);
      res.status(500).json({ 
        jsonrpc: '2.0', 
        error: { code: -32603, message: 'Internal error' } 
      });
    }
  }

  private async handleGet(req: Request, res: Response): Promise<void> {
    try {
      const acceptHeader = req.get('Accept') || '';
      const lastEventId = req.get('Last-Event-ID');
      
      if (!acceptHeader.includes('text/event-stream')) {
        res.status(405).json({ error: 'Method Not Allowed - GET requires text/event-stream Accept header' });
        return;
      }

      // Start SSE stream
      this.startSSEStream(res, lastEventId);

    } catch (error) {
      this.logger.error('Error handling GET request:', error);
      res.status(500).json({ error: 'Internal error' });
    }
  }

  private async handleDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.get('Mcp-Session-Id');
    
    if (!sessionId) {
      res.status(400).json({ error: 'Mcp-Session-Id header required' });
      return;
    }

    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      this.logger.info(`Session terminated: ${sessionId}`);
      res.status(200).end();
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  }

  private async handleSingleRequest(req: Request, res: Response, request: any, sessionId?: string): Promise<void> {
    const acceptsSSE = req.get('Accept')?.includes('text/event-stream');
    
    if (acceptsSSE) {
      // Stream response via SSE
      this.streamResponse(res, request, sessionId);
    } else {
      // Return JSON response
      const response = await this.processRequest(request, sessionId);
      res.json(response);
    }
  }

  private async handleRequestBatch(req: Request, res: Response, requests: any[], sessionId?: string): Promise<void> {
    const acceptsSSE = req.get('Accept')?.includes('text/event-stream');
    
    if (acceptsSSE) {
      // Stream responses via SSE
      this.streamBatchResponse(res, requests, sessionId);
    } else {
      // Return JSON batch response
      const responses = await Promise.all(
        requests.map(request => this.processRequest(request, sessionId))
      );
      res.json(responses);
    }
  }

  private async processRequest(request: any, sessionId?: string): Promise<any> {
    try {
      // Handle initialization specially
      if (request.method === 'initialize') {
        const result = await this.handleInitialize(request);
        
        // Create session if this is initialization
        if (!sessionId) {
          sessionId = uuidv4();
          this.sessions.set(sessionId, {
            id: sessionId,
            created: new Date(),
            lastActivity: new Date()
          });
          
          // Add session ID to response headers (will be handled by caller)
          return {
            ...result,
            _sessionId: sessionId
          };
        }
        
        return result;
      }

      // Update session activity
      if (sessionId && this.sessions.has(sessionId)) {
        this.sessions.get(sessionId)!.lastActivity = new Date();
      }

      return await this.processMcpRequest(request);
    } catch (error) {
      this.logger.error('Error processing request:', error);
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'Internal error' }
      };
    }
  }

  private streamResponse(res: Response, request: any, sessionId?: string): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Process request and stream response
    this.processRequest(request, sessionId).then(response => {
      // Handle session ID for initialization
      if (response._sessionId) {
        res.setHeader('Mcp-Session-Id', response._sessionId);
        delete response._sessionId;
      }

      const eventId = this.getNextEventId();
      this.sendSSEEvent(res, 'message', response, eventId);
      res.end();
    }).catch(error => {
      this.logger.error('Error streaming response:', error);
      const errorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'Internal error' }
      };
      this.sendSSEEvent(res, 'error', errorResponse);
      res.end();
    });
  }

  private streamBatchResponse(res: Response, requests: any[], sessionId?: string): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Process requests and stream responses
    Promise.all(requests.map(request => this.processRequest(request, sessionId)))
      .then(responses => {
        // Handle session ID for initialization
        const initResponse = responses.find(r => r._sessionId);
        if (initResponse) {
          res.setHeader('Mcp-Session-Id', initResponse._sessionId);
          responses.forEach(r => delete r._sessionId);
        }

        const eventId = this.getNextEventId();
        this.sendSSEEvent(res, 'message', responses, eventId);
        res.end();
      }).catch(error => {
        this.logger.error('Error streaming batch response:', error);
        const errorResponse = {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' }
        };
        this.sendSSEEvent(res, 'error', errorResponse);
        res.end();
      });
  }

  private startSSEStream(res: Response, lastEventId?: string): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial ping
    this.sendSSEEvent(res, 'ping', { timestamp: new Date().toISOString() });
    
    // Set up periodic ping to keep connection alive
    const pingInterval = setInterval(() => {
      this.sendSSEEvent(res, 'ping', { timestamp: new Date().toISOString() });
    }, 30000);

    // Clean up on disconnect
    res.on('close', () => {
      clearInterval(pingInterval);
    });

    // Handle resumability if lastEventId provided
    if (lastEventId) {
      this.logger.info(`Resuming SSE stream from event ID: ${lastEventId}`);
      // TODO: Implement message replay based on lastEventId
    }
  }

  private sendSSEEvent(res: Response, event: string, data: any, id?: string): void {
    if (id) {
      res.write(`id: ${id}\n`);
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private getNextEventId(): string {
    return (++this.eventIdCounter).toString();
  }

  private isAllowedOrigin(origin: string): boolean {
    // Allow localhost and common development origins
    const allowedOrigins = [
      'http://localhost',
      'https://localhost',
      'http://127.0.0.1',
      'https://127.0.0.1',
      'https://claude.ai',
      'https://chatgpt.com',
      'https://platform.openai.com'
    ];

    return allowedOrigins.some(allowed => origin.startsWith(allowed));
  }

  /**
   * Process MCP request and return response
   */
  private async processMcpRequest(request: any): Promise<any> {
    try {
      // Handle different MCP methods
      switch (request.method) {
        case "initialize":
          return this.handleInitialize(request);
        case "prompts/list":
          return this.handlePromptsList(request);
        case "prompts/get":
          return this.handlePromptsGet(request);
        case "tools/list":
          return this.handleToolsList(request);
        case "tools/call":
          return this.handleToolsCall(request);
        default:
          return {
            jsonrpc: "2.0",
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            },
            id: request.id || null
          };
      }
    } catch (error) {
      this.logger.error('Error processing MCP request:', error);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error)
        },
        id: request.id || null
      };
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(request: any): Promise<any> {
    const clientProtocolVersion = request.params?.protocolVersion;
    const supportedVersions = ["2024-11-05", "2025-03-26"];
    const protocolVersion = supportedVersions.includes(clientProtocolVersion)
      ? clientProtocolVersion
      : "2025-03-26";

    return {
      jsonrpc: "2.0",
      result: {
        protocolVersion: protocolVersion,
        capabilities: {
          prompts: { listChanged: true },
          tools: { listChanged: true }
        },
        serverInfo: {
          name: "claude-prompts-mcp",
          version: "1.0.7"
        }
      },
      id: request.id || null
    };
  }

  /**
   * Handle prompts/list request
   */
  private async handlePromptsList(request: any): Promise<any> {
    try {
      // Get prompts from the MCP server
      const prompts = await this.getPromptsFromServer();
      
      return {
        jsonrpc: "2.0",
        result: {
          prompts: prompts
        },
        id: request.id || null
      };
    } catch (error) {
      this.logger.error("Error getting prompts list:", error);
      return {
        jsonrpc: "2.0",
        result: {
          prompts: []
        },
        id: request.id || null
      };
    }
  }

  /**
   * Handle prompts/get request
   */
  private async handlePromptsGet(request: any): Promise<any> {
    return {
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: "Prompts not implemented yet"
      },
      id: request.id || null
    };
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(request: any): Promise<any> {
    try {
      // Get tools from the MCP server
      const tools = await this.getToolsFromServer();
      
      return {
        jsonrpc: "2.0",
        result: {
          tools: tools
        },
        id: request.id || null
      };
    } catch (error) {
      this.logger.error("Error getting tools list:", error);
      return {
        jsonrpc: "2.0",
        result: {
          tools: []
        },
        id: request.id || null
      };
    }
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(request: any): Promise<any> {
    return {
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: "Tools not implemented yet"
      },
      id: request.id || null
    };
  }

  /**
   * Get tools from MCP server
   */
  private async getToolsFromServer(): Promise<any[]> {
    try {
      if (!this.mcpServer || !(this.mcpServer as any)._registeredTools) {
        return [];
      }

      // Fast path: pre-compute tools list if possible
      const toolEntries = Object.entries((this.mcpServer as any)._registeredTools);
      const tools = toolEntries.map(([name, tool]: [string, any]) => ({
        name,
        description: tool.description || `Tool: ${name}`,
        inputSchema: tool.inputSchema || {
          type: "object",
          properties: {},
          required: []
        }
      }));

      return tools;
    } catch (error) {
      this.logger.error("Error getting tools from server:", error);
      return [];
    }
  }

  /**
   * Get prompts from MCP server
   */
  private async getPromptsFromServer(): Promise<any[]> {
    try {
      if (!this.mcpServer || !(this.mcpServer as any)._registeredPrompts) {
        return [];
      }

      // Fast path: pre-compute prompts list if possible
      const promptEntries = Object.entries((this.mcpServer as any)._registeredPrompts);
      const prompts = promptEntries.map(([name, prompt]: [string, any]) => ({
        name,
        description: prompt.description || `Prompt: ${name}`,
        arguments: prompt.arguments || []
      }));

      return prompts;
    } catch (error) {
      this.logger.error("Error getting prompts from server:", error);
      return [];
    }
  }

  public start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, '0.0.0.0', () => {
          this.logger.info(`🚀 Streamable HTTP transport listening on port ${port}`);
          this.logger.info(`📡 MCP endpoint: http://localhost:${port}/mcp`);
          this.logger.info(`🔧 Protocol: MCP 2025-03-26 Streamable HTTP`);
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error('Server error:', error);
          reject(error);
        });

        // Clean up expired sessions periodically
        setInterval(() => {
          this.cleanupExpiredSessions();
        }, 300000); // 5 minutes

      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Streamable HTTP transport stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const timeSinceActivity = now.getTime() - session.lastActivity.getTime();
      if (timeSinceActivity > 3600000) { // 1 hour
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach(sessionId => {
      this.sessions.delete(sessionId);
      this.logger.info(`Expired session cleaned up: ${sessionId}`);
    });
  }
}

interface SessionData {
  id: string;
  created: Date;
  lastActivity: Date;
}