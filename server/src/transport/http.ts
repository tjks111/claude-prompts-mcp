/**
 * HTTP Transport for MCP
 * Simple HTTP-based transport that doesn't require SSE connections
 */

import express, { Request, Response } from "express";
import { Logger } from "../logging/index.js";
import { McpOAuthServer } from "../auth/index.js";

export class HttpMcpTransport {
  private logger: Logger;
  private mcpServer: any;
  private oauthServer: McpOAuthServer;

  constructor(logger: Logger, mcpServer: any) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    
    // Initialize OAuth server with base URL
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:8080";
    
    this.oauthServer = new McpOAuthServer(logger, baseUrl);
  }

  /**
   * Validate authentication for MCP requests
   */
  private validateAuthentication(req: Request): { isValid: boolean; error?: string } {
    const authRequired = process.env.MCP_REQUIRE_AUTH === 'true';
    
    if (!authRequired) {
      return { isValid: true };
    }

    // Check for Bearer token (OAuth or API key)
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { 
        isValid: false, 
        error: "Missing Authorization header with Bearer token" 
      };
    }
    
    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    // First try OAuth token validation
    const isValidOAuthToken = this.oauthServer.validateAccessToken(token);
    if (isValidOAuthToken) {
      this.logger.info("✅ OAuth 2.1 Bearer token authentication successful");
      return { isValid: true };
    }
    
    // Fallback to API key validation
    const validApiKeys = (process.env.MCP_API_KEYS || '').split(',').filter(key => key.trim());
    const isValidApiKey = validApiKeys.includes(token);
    
    if (isValidApiKey) {
      this.logger.info("✅ API key authentication successful");
      return { isValid: true };
    }
    
    return { 
      isValid: false, 
      error: "Invalid or expired access token/API key" 
    };
  }

  /**
   * Setup HTTP-based MCP endpoints
   */
  setupHttpTransport(app: express.Application): void {
    this.logger.info("Setting up HTTP MCP transport endpoints with OAuth 2.1 support");

    // Add CORS and debugging middleware
    app.use((req: Request, res: Response, next) => {
      // Enable CORS for all origins
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
      
      // Log all incoming requests
      this.logger.info(`📥 ${req.method} ${req.path} from ${req.ip} - User-Agent: ${req.get('User-Agent')}`);
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      
      next();
    });

    // EMERGENCY DEBUG: Log ALL incoming requests at Express level
    app.use((req: Request, res: Response, next) => {
      console.error("🚨 EXPRESS REQUEST DEBUG:", {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        url: req.url,
        originalUrl: req.originalUrl,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
        host: req.get('Host'),
        origin: req.get('Origin'),
        ip: req.ip,
        ips: req.ips,
        headers: req.headers
      });
      next();
    });

    // Note: JSON parsing middleware is already added by ApiManager
    // We don't need to add it again here to avoid conflicts

    // Setup OAuth 2.1 endpoints (MCP Authorization Specification 2025-03-26)
    this.oauthServer.setupOAuthEndpoints(app);

    // Handle GET requests to /mcp endpoint (for health checks and info)
    app.get("/mcp", (req: Request, res: Response) => {
      this.logger.info("GET request to /mcp endpoint from:", req.ip, "User-Agent:", req.get('User-Agent'));
      
      // Apply authentication to GET requests as well for consistency
      const authResult = this.validateAuthentication(req);
      if (!authResult.isValid) {
        this.logger.warn("🔒 GET /mcp request rejected - authentication failed:", authResult.error);
        res.status(401).json({
          error: "Unauthorized",
          message: authResult.error,
          authRequired: process.env.MCP_REQUIRE_AUTH === 'true'
        });
        return;
      }
      
      res.json({
        message: "Claude Prompts MCP Server - HTTP Transport",
        version: "1.0.3", // Updated version for auth fix
        transport: "http",
        authenticated: process.env.MCP_REQUIRE_AUTH === 'true',
        endpoints: {
          mcp: "POST /mcp - Send MCP requests",
          messages: "POST /messages - Send MCP messages",
          health: "GET /health - Health check",
          prompts: "GET /prompts - List all prompts"
        },
        usage: "Send MCP requests as JSON-RPC 2.0 messages to POST /mcp",
        example: {
          method: "POST",
          url: "/mcp",
          body: {
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "test-client", version: "1.0.0" }
            },
            id: 1
          }
        }
      });
    });

    // 🚨 CRITICAL FIX: OpenAI is hitting /mpc instead of /mcp (typo fix)
    console.error("🚨 REGISTERING /mpc -> /mcp REDIRECT FOR OPENAI TYPO");
    app.post("/mpc", (req: Request, res: Response) => {
      console.error("🚨 OPENAI TYPO DETECTED: /mpc -> redirecting to /mcp");
      this.logger.info("OpenAI hit /mpc endpoint - redirecting to /mcp");
      
      // Forward the request to the correct /mcp endpoint
      req.url = '/mcp';
      req.originalUrl = '/mcp';
      
      // Call the MCP handler directly
      this.handleMcpRequest(req, res);
    });

    // EMERGENCY: Simple POST test endpoint
    console.error("🚨 REGISTERING POST /test-post ENDPOINT");
    app.post("/test-post", (req: Request, res: Response) => {
      console.error("🚨 EMERGENCY POST TEST ENDPOINT HIT!");
      this.logger.info("🚨 EMERGENCY POST TEST ENDPOINT HIT!");
      res.json({
        success: true,
        message: "POST request received successfully!",
        method: req.method,
        path: req.path,
        body: req.body,
        timestamp: new Date().toISOString()
      });
    });

    // Handle MCP requests via HTTP POST
    console.error("🚨 REGISTERING POST /mcp ENDPOINT");
    app.post("/mcp", async (req: Request, res: Response) => {
      console.error("🔥 POST /mcp request received!");
      this.logger.info("🔥 POST /mcp request received!");
      await this.handleMcpRequest(req, res);
    });

    // Handle OpenAI's /mpc endpoint (typo in OpenAI client?)
    console.error("🚨 REGISTERING POST /mpc ENDPOINT (OpenAI compatibility)");
    app.post("/mpc", async (req: Request, res: Response) => {
      console.error("🔥 POST /mpc request received from OpenAI!");
      this.logger.info("🔥 POST /mpc request received from OpenAI!");
      await this.handleMcpRequest(req, res);
    });

    // Handle GET requests to /messages endpoint (for info)
    app.get("/messages", (req: Request, res: Response) => {
      this.logger.info("GET request to /messages endpoint");
      res.json({
        message: "MCP Messages Endpoint",
        usage: "Send MCP messages as JSON-RPC 2.0 to POST /messages",
        transport: "http"
      });
    });

    // Handle messages via HTTP POST
    app.post("/messages", async (req: Request, res: Response) => {
      this.logger.info("🔥 POST /messages request received!");
      await this.handleMcpRequest(req, res);
    });

    // Handle root POST requests
    app.post("/", async (req: Request, res: Response) => {
      this.logger.info("🔥 POST / request received!");
      await this.handleMcpRequest(req, res);
    });
  }

  /**
   * Handle MCP request directly via HTTP
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      // EMERGENCY DEBUG: Log ALL incoming requests
      console.error("🚨 INCOMING REQUEST DEBUG:", {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        url: req.url,
        originalUrl: req.originalUrl,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
        contentLength: req.get('Content-Length'),
        host: req.get('Host'),
        origin: req.get('Origin'),
        referer: req.get('Referer'),
        allHeaders: req.headers,
        bodyExists: !!req.body,
        bodyType: typeof req.body,
        bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'NO BODY',
        rawBody: req.body,
        query: req.query,
        params: req.params
      });

      // Enhanced logging for OpenAI MCP debugging
      console.error("🔍 MCP Request received:", {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
        body: JSON.stringify(req.body, null, 2),
        headers: {
          authorization: req.get('Authorization') ? '[PRESENT]' : '[MISSING]',
          'x-api-key': req.get('X-API-Key') ? '[PRESENT]' : '[MISSING]',
        }
      });

      this.logger.debug("Received MCP HTTP request:", {
        method: req.method,
        path: req.path,
        body: req.body,
        headers: req.headers
      });

      // Authentication (OAuth 2.1 + API Key support)
      const authRequired = process.env.MCP_REQUIRE_AUTH === 'true';
      console.error(`🔐 Authentication ${authRequired ? 'ENABLED' : 'DISABLED'}`);

      const authResult = this.validateAuthentication(req);
      if (!authResult.isValid) {
        this.logger.warn("🔒 MCP request rejected - authentication failed:", authResult.error);
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: `Unauthorized - ${authResult.error}`
          },
          id: req.body?.id || null
        });
        return;
      }
      
      if (!authRequired) {
        this.logger.info("🔓 Authentication disabled - allowing request");
      }

      const request = req.body;

      // EMERGENCY DEBUG: Log the exact request being processed
      console.error("🚨 PROCESSING MCP REQUEST:", {
        method: request?.method,
        id: request?.id,
        hasParams: !!request?.params,
        requestType: typeof request,
        requestKeys: request ? Object.keys(request) : 'NO REQUEST'
      });

      // Handle different MCP request types
      if (request.method === "initialize") {
        console.error("🔄 CALLING handleInitialize");
        await this.handleInitialize(req, res);
        console.error("✅ handleInitialize COMPLETED");
      } else if (request.method === "prompts/list") {
        console.error("📋 CALLING handlePromptsList");
        await this.handlePromptsList(req, res);
        console.error("✅ handlePromptsList COMPLETED");
      } else if (request.method === "prompts/get") {
        console.error("📄 CALLING handlePromptsGet");
        await this.handlePromptsGet(req, res);
        console.error("✅ handlePromptsGet COMPLETED");
      } else if (request.method === "tools/list") {
        console.error("🔧 CALLING handleToolsList");
        await this.handleToolsList(req, res);
        console.error("✅ handleToolsList COMPLETED");
      } else if (request.method === "tools/call") {
        console.error("⚡ CALLING handleToolsCall");
        await this.handleToolsCall(req, res);
        console.error("✅ handleToolsCall COMPLETED");
      } else {
        console.error("❌ UNKNOWN METHOD:", request.method);
        // Default response for unknown methods
        res.json({
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          },
          id: request.id || null
        });
        console.error("✅ ERROR RESPONSE SENT");
      }
    } catch (error) {
      this.logger.error("Error handling MCP HTTP request:", error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error)
        },
        id: req.body?.id || null
      });
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(req: Request, res: Response): Promise<void> {
    console.error("🚨 INITIALIZE: Starting handleInitialize");
    this.logger.info("Handling MCP initialize request");
    
    try {
      const clientProtocolVersion = req.body.params?.protocolVersion;
      console.error("🚨 INITIALIZE: Client protocol version:", clientProtocolVersion);
      this.logger.info("🔄 Client protocol version:", clientProtocolVersion);
      
      // Support both 2024-11-05 and 2025-03-26 protocol versions
      const supportedVersions = ["2024-11-05", "2025-03-26"];
      const protocolVersion = supportedVersions.includes(clientProtocolVersion) 
        ? clientProtocolVersion 
        : "2025-03-26"; // Default to latest
      
      console.error("🚨 INITIALIZE: Using protocol version:", protocolVersion);
      
      const response = {
        jsonrpc: "2.0",
        result: {
          protocolVersion: protocolVersion,
          capabilities: {
            prompts: { listChanged: true },
            tools: { listChanged: true }
          },
          serverInfo: {
            name: "claude-prompts-mcp",
            version: "1.0.0"
          }
        },
        id: req.body.id || null
      };

      console.error("🚨 INITIALIZE: About to send response:", JSON.stringify(response, null, 2));
      this.logger.info("🔄 Sending MCP initialize response:", JSON.stringify(response, null, 2));
      
      // Check if response has already been sent
      if (res.headersSent) {
        console.error("❌ INITIALIZE: Headers already sent! Cannot send response");
        return;
      }
      
      // Check if client expects SSE format (OpenAI sends Accept: text/event-stream)
      const acceptHeader = req.get('Accept');
      console.error("🚨 INITIALIZE: Client Accept header:", acceptHeader);
      
      if (acceptHeader && acceptHeader.includes('text/event-stream')) {
        console.error("🚨 INITIALIZE: Sending SSE format response");
        // Send as Server-Sent Events format
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        });
        
        // Send the response as SSE data
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        res.end();
        console.error("✅ INITIALIZE: SSE response sent successfully");
      } else {
        console.error("🚨 INITIALIZE: Sending JSON format response");
        res.json(response);
        console.error("✅ INITIALIZE: JSON response sent successfully");
      }
      
    } catch (error) {
      console.error("❌ INITIALIZE: Error in handleInitialize:", error);
      this.logger.error("Error in handleInitialize:", error);
      
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error in initialize",
            data: error instanceof Error ? error.message : String(error)
          },
          id: req.body?.id || null
        });
      }
    }
  }

  /**
   * Handle prompts/list request
   */
  private async handlePromptsList(req: Request, res: Response): Promise<void> {
    this.logger.info("Handling MCP prompts/list request");
    
    try {
      // Get prompts from the MCP server
      const prompts = await this.getPromptsFromServer();
      
      res.json({
        jsonrpc: "2.0",
        result: {
          prompts: prompts
        },
        id: req.body.id || null
      });
    } catch (error) {
      this.logger.error("Error getting prompts list:", error);
      res.json({
        jsonrpc: "2.0",
        result: {
          prompts: []
        },
        id: req.body.id || null
      });
    }
  }

  /**
   * Handle prompts/get request
   */
  private async handlePromptsGet(req: Request, res: Response): Promise<void> {
    this.logger.info("Handling MCP prompts/get request");
    
    const { name, arguments: args } = req.body.params || {};
    
    try {
      // Get specific prompt from the MCP server
      const prompt = await this.getPromptFromServer(name, args);
      
      res.json({
        jsonrpc: "2.0",
        result: prompt,
        id: req.body.id || null
      });
    } catch (error) {
      this.logger.error("Error getting prompt:", error);
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32602,
          message: `Prompt not found: ${name}`
        },
        id: req.body.id || null
      });
    }
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(req: Request, res: Response): Promise<void> {
    this.logger.info("Handling MCP tools/list request");
    
    try {
      // Get tools from the MCP server
      const tools = await this.getToolsFromServer();
      
      res.json({
        jsonrpc: "2.0",
        result: {
          tools: tools
        },
        id: req.body.id || null
      });
    } catch (error) {
      this.logger.error("Error getting tools list:", error);
      res.json({
        jsonrpc: "2.0",
        result: {
          tools: []
        },
        id: req.body.id || null
      });
    }
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(req: Request, res: Response): Promise<void> {
    this.logger.info("Handling MCP tools/call request");
    
    const { name, arguments: args } = req.body.params || {};
    
    try {
      // Call tool on the MCP server
      const result = await this.callToolOnServer(name, args);
      
      res.json({
        jsonrpc: "2.0",
        result: result,
        id: req.body.id || null
      });
    } catch (error) {
      this.logger.error("Error calling tool:", error);
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32602,
          message: `Tool call failed: ${name}`
        },
        id: req.body.id || null
      });
    }
  }

  /**
   * Get prompts from MCP server
   */
  private async getPromptsFromServer(): Promise<any[]> {
    try {
      // Access the MCP server's registered prompts directly
      if (this.mcpServer && this.mcpServer._registeredPrompts) {
        const prompts = Object.entries(this.mcpServer._registeredPrompts).map(([name, prompt]: [string, any]) => {
          return {
            name,
            description: prompt.description,
            arguments: prompt.argsSchema ? this.promptArgumentsFromSchema(prompt.argsSchema) : undefined,
          };
        });
        return prompts;
      }
      return [];
    } catch (error) {
      this.logger.error("Error accessing MCP server prompts:", error);
      return [];
    }
  }

  /**
   * Convert schema to prompt arguments format
   */
  private promptArgumentsFromSchema(schema: any): any {
    // This is a simplified version of the schema conversion
    // In a real implementation, you'd want to properly convert the Zod schema
    try {
      if (schema && schema._def && schema._def.shape) {
        const shape = schema._def.shape();
        const properties: any = {};
        const required: string[] = [];
        
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = { type: "string" }; // Simplified - should properly detect types
          if (!(value as any).isOptional()) {
            required.push(key);
          }
        }
        
        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }
    } catch (error) {
      this.logger.warn("Error converting schema to prompt arguments:", error);
    }
    return undefined;
  }

  /**
   * Get specific prompt from MCP server
   */
  private async getPromptFromServer(name: string, args: any): Promise<any> {
    try {
      if (this.mcpServer && this.mcpServer._registeredPrompts) {
        const prompt = this.mcpServer._registeredPrompts[name];
        if (!prompt) {
          throw new Error(`Prompt ${name} not found`);
        }
        
        // Validate arguments if schema exists
        if (prompt.argsSchema && args) {
          const parseResult = await prompt.argsSchema.safeParseAsync(args);
          if (!parseResult.success) {
            throw new Error(`Invalid arguments for prompt ${name}: ${parseResult.error.message}`);
          }
          args = parseResult.data;
        }
        
        // Call the prompt callback
        const result = await prompt.callback(args || {});
        return result;
      }
      throw new Error("Prompt handler not available");
    } catch (error) {
      this.logger.error("Error accessing MCP server prompt:", error);
      throw error;
    }
  }

  /**
   * Get tools from MCP server
   */
  private async getToolsFromServer(): Promise<any[]> {
    try {
      if (this.mcpServer && this.mcpServer._registeredTools) {
        const tools = Object.entries(this.mcpServer._registeredTools).map(([name, tool]: [string, any]) => {
          return {
            name,
            description: tool.description,
            inputSchema: tool.argsSchema ? this.schemaToJsonSchema(tool.argsSchema) : undefined,
          };
        });
        return tools;
      }
      return [];
    } catch (error) {
      this.logger.error("Error accessing MCP server tools:", error);
      return [];
    }
  }

  /**
   * Convert Zod schema to JSON schema format
   */
  private schemaToJsonSchema(schema: any): any {
    // Simplified schema conversion
    try {
      if (schema && schema._def && schema._def.shape) {
        const shape = schema._def.shape();
        const properties: any = {};
        const required: string[] = [];
        
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = { type: "string" }; // Simplified
          if (!(value as any).isOptional()) {
            required.push(key);
          }
        }
        
        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }
    } catch (error) {
      this.logger.warn("Error converting schema:", error);
    }
    return { type: "object" };
  }

  /**
   * Call tool on MCP server
   */
  private async callToolOnServer(name: string, args: any): Promise<any> {
    try {
      if (this.mcpServer && this.mcpServer._registeredTools) {
        const tool = this.mcpServer._registeredTools[name];
        if (!tool) {
          throw new Error(`Tool ${name} not found`);
        }
        
        // Validate arguments if schema exists
        if (tool.argsSchema && args) {
          const parseResult = await tool.argsSchema.safeParseAsync(args);
          if (!parseResult.success) {
            throw new Error(`Invalid arguments for tool ${name}: ${parseResult.error.message}`);
          }
          args = parseResult.data;
        }
        
        // Call the tool callback
        const result = await tool.callback(args || {});
        return result;
      }
      throw new Error("Tool handler not available");
    } catch (error) {
      this.logger.error("Error calling MCP server tool:", error);
      throw error;
    }
  }
}