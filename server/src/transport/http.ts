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
   * Validate authentication for MCP requests (browser-friendly)
   */
  private validateAuthentication(req: Request): { isValid: boolean; error?: string } {
    const authRequired = process.env.MCP_REQUIRE_AUTH === 'true';
    
    if (!authRequired) {
      return { isValid: true };
    }

    // Check for Bearer token (OAuth or API key)
    const authHeader = req.get('Authorization');
    
    // For browser clients, be more lenient with missing auth
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Allow GET requests without auth for browser compatibility
      if (req.method === 'GET') {
        this.logger.info("🌐 Browser GET request - allowing without auth");
        return { isValid: true };
      }
      
      // Also allow POST requests from browser origins without auth for MCP compatibility
      const origin = req.get('Origin');
      const userAgent = req.get('User-Agent') || '';
      const isBrowserRequest = origin || userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari');
      
      if (isBrowserRequest) {
        this.logger.info("🌐 Browser POST request - allowing without auth for MCP compatibility");
        return { isValid: true };
      }
      
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

    // Add CORS middleware (optimized for browser MCP clients)
    app.use((req: Request, res: Response, next) => {
      // Enable CORS for all origins with comprehensive headers
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key, Cache-Control, Pragma');
      res.header('Access-Control-Expose-Headers', 'Content-Type, Cache-Control, Pragma');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours
      
      // Handle preflight requests quickly
      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }
      
      // Minimal logging for performance
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`${req.method} ${req.path} from ${req.ip}`);
      }
      
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
        version: "1.0.4", // Updated version for browser compatibility
        transport: "http",
        authenticated: process.env.MCP_REQUIRE_AUTH === 'true',
        browserCompatible: true,
        endpoints: {
          mcp: "POST /mcp - Send MCP requests",
          messages: "POST /messages - Send MCP messages",
          sse: "GET /sse - Server-Sent Events for browser clients",
          health: "GET /health - Health check",
          prompts: "GET /prompts - List all prompts"
        },
        cors: {
          enabled: true,
          allowOrigin: "*",
          allowMethods: "GET, POST, PUT, DELETE, OPTIONS, HEAD",
          allowHeaders: "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key, Cache-Control, Pragma"
        },
        usage: "Send MCP requests as JSON-RPC 2.0 messages to POST /mcp",
        browserUsage: {
          http: "https://claude-prompts-mcp-production-0a79.up.railway.app/mcp",
          sse: "https://claude-prompts-mcp-production-0a79.up.railway.app/sse"
        },
        example: {
          method: "POST",
          url: "/mcp",
          body: {
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "browser-client", version: "1.0.7" }
            },
            id: 1
          }
        }
      });
    });

    // Handle MCP requests via HTTP POST (optimized)
    app.post("/mcp", async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Handle OpenAI's /mpc endpoint compatibility
    app.post("/mpc", async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Handle alternative MCP endpoints that some clients might use
    app.post("/", async (req: Request, res: Response) => {
      // Only handle JSON-RPC requests to root
      if (req.body && req.body.jsonrpc === "2.0") {
        this.logger.info("MCP request to root endpoint");
        await this.handleMcpRequest(req, res);
      } else {
        // Return JSON response instead of redirect for API compatibility
        res.json({
          error: "Invalid request",
          message: "Expected JSON-RPC 2.0 request",
          endpoints: {
            mcp: "/mcp",
            sse: "/sse",
            health: "/health"
          }
        });
      }
    });

    app.post("/rpc", async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Handle OPTIONS for /routes endpoint (CORS preflight)
    app.options("/routes", (req: Request, res: Response) => {
      this.logger.info("OPTIONS request to /routes endpoint");
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(200).end();
    });

    // Handle /routes endpoint for MCP client discovery
    app.get("/routes", (req: Request, res: Response) => {
      this.logger.info("GET request to /routes endpoint for MCP client discovery");
      res.json({
        routes: {
          mcp: "/mcp",
          rpc: "/rpc", 
          sse: "/sse",
          health: "/health",
          messages: "/messages"
        },
        transports: ["http", "sse"],
        serverInfo: {
          name: "claude-prompts-mcp",
          version: "1.0.7"
        }
      });
    });

    app.post("/routes", async (req: Request, res: Response) => {
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
      await this.handleMcpRequest(req, res);
    });

    // Handle root POST requests
    app.post("/", async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Handle OPTIONS for SSE endpoint (CORS preflight)
    app.options("/sse", (req: Request, res: Response) => {
      this.logger.info("OPTIONS request to /sse endpoint");
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(200).end();
    });

    // Add SSE endpoint for MCP-over-SSE transport
    app.get("/sse", (req: Request, res: Response) => {
      this.logger.info("SSE MCP transport connection request");
      
      try {
        // Set SSE headers properly
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Authorization, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
        
        // Important: Set status code
        res.status(200);

        // Send MCP initialization response immediately for SSE transport
        const initResponse = {
          jsonrpc: "2.0",
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {
              prompts: {
                listChanged: true
              },
              tools: {
                listChanged: true
              }
            },
            serverInfo: {
              name: "claude-prompts-mcp",
              version: "1.0.7"
            }
          },
          id: null
        };

        // Send initialization as SSE data
        res.write(`data: ${JSON.stringify(initResponse)}\n\n`);

        // Store connection for potential future use
        const connectionId = Date.now().toString();
        this.logger.info(`SSE MCP connection established: ${connectionId}`);

        // Keep connection alive with MCP-style pings
        const keepAlive = setInterval(() => {
          try {
            // Send a simple ping in MCP format
            const ping = {
              jsonrpc: "2.0",
              method: "notifications/ping",
              params: { timestamp: new Date().toISOString() }
            };
            res.write(`data: ${JSON.stringify(ping)}\n\n`);
          } catch (error) {
            clearInterval(keepAlive);
            this.logger.error("SSE MCP ping failed:", error);
          }
        }, 30000); // 30 second intervals for MCP pings

        // Handle client disconnect
        req.on('close', () => {
          clearInterval(keepAlive);
          this.logger.info(`SSE MCP client disconnected: ${connectionId}`);
        });

        req.on('error', (error) => {
          clearInterval(keepAlive);
          this.logger.error("SSE MCP connection error:", error);
        });

        // Handle response errors
        res.on('error', (error) => {
          clearInterval(keepAlive);
          this.logger.error("SSE MCP response error:", error);
        });

      } catch (error) {
        this.logger.error("SSE MCP setup error:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "SSE MCP setup failed" });
        }
      }
    });

    // Handle SSE POST requests for MCP-over-SSE hybrid approach
    app.post("/sse", async (req: Request, res: Response) => {
      this.logger.info("SSE POST request - handling as MCP request");
      
      // Handle MCP requests sent to SSE endpoint
      // This supports hybrid SSE+HTTP approach where:
      // - SSE is used for server-to-client messages
      // - HTTP POST is used for client-to-server requests
      await this.handleMcpRequest(req, res);
    });

    // Handle SSE with query parameters for MCP requests
    app.get("/sse/:method", async (req: Request, res: Response) => {
      const method = req.params.method;
      this.logger.info(`SSE GET request with method: ${method}`);
      
      // Convert GET request to MCP format
      const mcpRequest = {
        jsonrpc: "2.0",
        method: method,
        params: req.query,
        id: Date.now()
      };
      
      // Create a mock request object for MCP handler
      const mockReq = {
        ...req,
        body: mcpRequest,
        method: 'POST'
      } as Request;
      
      await this.handleMcpRequest(mockReq, res);
    });

    // Handle SSE OPTIONS for CORS
    app.options("/sse", (req: Request, res: Response) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
      res.status(200).end();
    });

    // Debug endpoint to check routing
    app.get("/debug/routes", (req: Request, res: Response) => {
      res.json({
        message: "MCP Server Route Debug",
        availableRoutes: [
          "GET /mcp - Server info",
          "POST /mcp - MCP requests", 
          "GET /sse - Server-Sent Events",
          "POST /sse - MCP via SSE endpoint",
          "OPTIONS /sse - CORS preflight",
          "GET /health - Health check",
          "GET /prompts - List prompts",
          "GET /debug/routes - This debug info"
        ],
        timestamp: new Date().toISOString(),
        version: "1.0.4"
      });
    });
  }

  /**
   * Handle MCP request directly via HTTP (optimized)
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    // Add timeout protection
    const timeoutMs = 30000; // 30 second timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      // Minimal logging for performance
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug("MCP request:", {
          method: req.method,
          path: req.path,
          requestMethod: req.body?.method
        });
      }

      // Race between actual processing and timeout
      await Promise.race([
        this.processMcpRequest(req, res),
        timeoutPromise
      ]);

    } catch (error) {
      this.logger.error("Error handling MCP HTTP request:", error);
      if (!res.headersSent) {
        res.status(500);
        const errorResponse = {
          jsonrpc: "2.0",
          error: {
            code: error instanceof Error && error.message.includes('timeout') ? -32001 : -32603,
            message: error instanceof Error && error.message.includes('timeout') 
              ? "Request timeout" 
              : "Internal error",
            data: error instanceof Error ? error.message : String(error)
          },
          id: req.body?.id || null
        };
        this.sendResponse(req, res, errorResponse);
      }
    }
  }

  /**
   * Process MCP request (separated for timeout handling)
   */
  private async processMcpRequest(req: Request, res: Response): Promise<void> {
    // Fast authentication check
    const authResult = this.validateAuthentication(req);
    if (!authResult.isValid) {
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

    const request = req.body;

    // Fast method routing without excessive logging
    switch (request.method) {
      case "initialize":
        await this.handleInitialize(req, res);
        break;
      case "prompts/list":
        await this.handlePromptsList(req, res);
        break;
      case "prompts/get":
        await this.handlePromptsGet(req, res);
        break;
      case "tools/list":
        await this.handleToolsList(req, res);
        break;
      case "tools/call":
        await this.handleToolsCall(req, res);
        break;
      default:
        res.json({
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          },
          id: request.id || null
        });
    }
  }

  /**
   * Handle initialize request (optimized)
   */
  private async handleInitialize(req: Request, res: Response): Promise<void> {
    try {
      const clientProtocolVersion = req.body.params?.protocolVersion;
      
      // Support both 2024-11-05 and 2025-03-26 protocol versions
      const supportedVersions = ["2024-11-05", "2025-03-26"];
      const protocolVersion = supportedVersions.includes(clientProtocolVersion) 
        ? clientProtocolVersion 
        : "2025-03-26"; // Default to latest
      
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
            version: "1.0.7"
          }
        },
        id: req.body.id || null
      };

      // Check if response has already been sent
      if (res.headersSent) {
        return;
      }
      
      // Check if client expects SSE format (OpenAI sends Accept: text/event-stream)
      const acceptHeader = req.get('Accept');
      
      if (acceptHeader && acceptHeader.includes('text/event-stream')) {
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
      } else {
        res.json(response);
      }
      
    } catch (error) {
      this.logger.error("Error in handleInitialize:", error);
      
      if (!res.headersSent) {
        const errorResponse = {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error in initialize",
            data: error instanceof Error ? error.message : String(error)
          },
          id: req.body?.id || null
        };
        this.sendResponse(req, res, errorResponse);
      }
    }
  }

  /**
   * Send response in appropriate format (JSON or SSE)
   */
  private sendResponse(req: Request, res: Response, response: any): void {
    if (res.headersSent) {
      console.error("❌ Headers already sent! Cannot send response");
      return;
    }

    // Check if client expects SSE format (OpenAI sends Accept: text/event-stream)
    const acceptHeader = req.get('Accept');
    
    if (acceptHeader && acceptHeader.includes('text/event-stream')) {
      console.error("🚨 Sending SSE format response");
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
      console.error("✅ SSE response sent successfully");
    } else {
      console.error("🚨 Sending JSON format response");
      res.json(response);
      console.error("✅ JSON response sent successfully");
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
      
      const response = {
        jsonrpc: "2.0",
        result: {
          prompts: prompts
        },
        id: req.body.id || null
      };

      this.sendResponse(req, res, response);
    } catch (error) {
      this.logger.error("Error getting prompts list:", error);
      const errorResponse = {
        jsonrpc: "2.0",
        result: {
          prompts: []
        },
        id: req.body.id || null
      };
      this.sendResponse(req, res, errorResponse);
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
      
      const response = {
        jsonrpc: "2.0",
        result: prompt,
        id: req.body.id || null
      };

      this.sendResponse(req, res, response);
    } catch (error) {
      this.logger.error("Error getting prompt:", error);
      const errorResponse = {
        jsonrpc: "2.0",
        error: {
          code: -32602,
          message: `Prompt not found: ${name}`
        },
        id: req.body.id || null
      };
      this.sendResponse(req, res, errorResponse);
    }
  }

  /**
   * Handle tools/list request (optimized)
   */
  private async handleToolsList(req: Request, res: Response): Promise<void> {
    try {
      // Get tools from the MCP server with timeout
      const tools = await Promise.race([
        this.getToolsFromServer(),
        new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Tools list timeout')), 5000)
        )
      ]);
      
      const response = {
        jsonrpc: "2.0",
        result: {
          tools: tools
        },
        id: req.body.id || null
      };

      this.sendResponse(req, res, response);
    } catch (error) {
      this.logger.error("Error getting tools list:", error);
      const errorResponse = {
        jsonrpc: "2.0",
        result: {
          tools: []
        },
        id: req.body.id || null
      };
      this.sendResponse(req, res, errorResponse);
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
      
      const response = {
        jsonrpc: "2.0",
        result: result,
        id: req.body.id || null
      };

      this.sendResponse(req, res, response);
    } catch (error) {
      this.logger.error("Error calling tool:", error);
      const errorResponse = {
        jsonrpc: "2.0",
        error: {
          code: -32602,
          message: `Tool call failed: ${name}`
        },
        id: req.body.id || null
      };
      this.sendResponse(req, res, errorResponse);
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
   * Get tools from MCP server (optimized)
   */
  private async getToolsFromServer(): Promise<any[]> {
    try {
      if (!this.mcpServer || !this.mcpServer._registeredTools) {
        return [];
      }

      // Fast path: pre-compute tools list if possible
      const toolEntries = Object.entries(this.mcpServer._registeredTools);
      const tools = toolEntries.map(([name, tool]: [string, any]) => ({
        name,
        description: tool.description || `Tool: ${name}`,
        inputSchema: tool.argsSchema ? this.schemaToJsonSchemaFast(tool.argsSchema) : { type: "object" },
      }));
      
      return tools;
    } catch (error) {
      this.logger.error("Error accessing MCP server tools:", error);
      return [];
    }
  }

  /**
   * Convert Zod schema to JSON schema format (fast version)
   */
  private schemaToJsonSchemaFast(schema: any): any {
    // Ultra-fast schema conversion with minimal processing
    try {
      if (schema && schema._def && schema._def.shape) {
        const shape = schema._def.shape();
        const properties: any = {};
        
        // Fast iteration without required field detection for performance
        for (const key of Object.keys(shape)) {
          properties[key] = { type: "string" };
        }
        
        return {
          type: "object",
          properties,
        };
      }
    } catch (error) {
      // Silent fail for performance
    }
    return { type: "object" };
  }

  /**
   * Convert Zod schema to JSON schema format (legacy)
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