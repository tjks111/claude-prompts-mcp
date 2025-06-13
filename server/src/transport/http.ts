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

    // Handle MCP requests via HTTP POST
    app.post("/mcp", express.json(), async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
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
    
    res.json({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
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
    });
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
      // Access the MCP server's prompt handlers
      if (this.mcpServer && this.mcpServer.listPrompts) {
        const result = await this.mcpServer.listPrompts();
        return result.prompts || [];
      }
      return [];
    } catch (error) {
      this.logger.error("Error accessing MCP server prompts:", error);
      return [];
    }
  }

  /**
   * Get specific prompt from MCP server
   */
  private async getPromptFromServer(name: string, args: any): Promise<any> {
    try {
      if (this.mcpServer && this.mcpServer.getPrompt) {
        return await this.mcpServer.getPrompt({ name, arguments: args });
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
      if (this.mcpServer && this.mcpServer.listTools) {
        const result = await this.mcpServer.listTools();
        return result.tools || [];
      }
      return [];
    } catch (error) {
      this.logger.error("Error accessing MCP server tools:", error);
      return [];
    }
  }

  /**
   * Call tool on MCP server
   */
  private async callToolOnServer(name: string, args: any): Promise<any> {
    try {
      if (this.mcpServer && this.mcpServer.callTool) {
        return await this.mcpServer.callTool({ name, arguments: args });
      }
      throw new Error("Tool handler not available");
    } catch (error) {
      this.logger.error("Error calling MCP server tool:", error);
      throw error;
    }
  }
}