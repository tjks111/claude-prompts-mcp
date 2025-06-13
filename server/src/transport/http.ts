/**
 * HTTP Transport for MCP
 * Simple HTTP-based transport that doesn't require SSE connections
 */

import express, { Request, Response } from "express";
import { Logger } from "../logging/index.js";

export class HttpMcpTransport {
  private logger: Logger;
  private mcpServer: any;

  constructor(logger: Logger, mcpServer: any) {
    this.logger = logger;
    this.mcpServer = mcpServer;
  }

  /**
   * Setup HTTP-based MCP endpoints
   */
  setupHttpTransport(app: express.Application): void {
    this.logger.info("Setting up HTTP MCP transport endpoints");

    // Handle GET requests to /mcp endpoint (for health checks and info)
    app.get("/mcp", (req: Request, res: Response) => {
      this.logger.info("GET request to /mcp endpoint from:", req.ip, "User-Agent:", req.get('User-Agent'));
      res.json({
        message: "Claude Prompts MCP Server - HTTP Transport",
        version: "1.0.0",
        transport: "http",
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
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test-client", version: "1.0.0" }
            },
            id: 1
          }
        }
      });
    });

    // Handle MCP requests via HTTP POST
    app.post("/mcp", express.json(), async (req: Request, res: Response) => {
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
    app.post("/messages", express.json(), async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Handle root POST requests
    app.post("/", express.json(), async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });
  }

  /**
   * Handle MCP request directly via HTTP
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
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

      const request = req.body;

      // Handle different MCP request types
      if (request.method === "initialize") {
        await this.handleInitialize(req, res);
      } else if (request.method === "prompts/list") {
        await this.handlePromptsList(req, res);
      } else if (request.method === "prompts/get") {
        await this.handlePromptsGet(req, res);
      } else if (request.method === "tools/list") {
        await this.handleToolsList(req, res);
      } else if (request.method === "tools/call") {
        await this.handleToolsCall(req, res);
      } else {
        // Default response for unknown methods
        res.json({
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          },
          id: request.id || null
        });
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
    this.logger.info("Handling MCP initialize request");
    
    const clientProtocolVersion = req.body.params?.protocolVersion;
    this.logger.info("🔄 Client protocol version:", clientProtocolVersion);
    
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
          version: "1.0.0"
        }
      },
      id: req.body.id || null
    };

    this.logger.info("🔄 Sending MCP initialize response:", JSON.stringify(response, null, 2));
    res.json(response);
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