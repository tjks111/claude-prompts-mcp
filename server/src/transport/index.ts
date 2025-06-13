/**
 * Transport Management Module
 * Handles STDIO and SSE transport setup and lifecycle management
 */

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express, { Request, Response } from "express";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";

/**
 * Transport types supported by the server
 */
export enum TransportType {
  STDIO = "stdio",
  SSE = "sse",
}

/**
 * Transport Manager class
 */
export class TransportManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private mcpServer: any;
  private transport: string;
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    mcpServer: any,
    transport: string
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.mcpServer = mcpServer;
    this.transport = transport;
  }

  /**
   * Determine transport from command line arguments or configuration
   */
  static determineTransport(
    args: string[],
    configManager: ConfigManager
  ): string {
    const transportArg = args.find((arg: string) =>
      arg.startsWith("--transport=")
    );
    return transportArg
      ? transportArg.split("=")[1]
      : configManager.getConfig().transports.default;
  }

  /**
   * Validate that the selected transport is enabled
   */
  validateTransport(): void {
    if (!this.configManager.isTransportEnabled(this.transport)) {
      throw new Error(
        `Transport '${this.transport}' is not enabled in the configuration`
      );
    }
  }

  /**
   * Setup STDIO transport
   */
  async setupStdioTransport(): Promise<void> {
    this.logger.info("Starting server with STDIO transport");

    // Create and configure the STDIO transport
    const stdioTransport = new StdioServerTransport();

    // Setup console redirection for STDIO mode
    this.setupStdioConsoleRedirection();

    // Setup STDIO event handlers
    this.setupStdioEventHandlers();

    // Connect the server to the transport
    try {
      await this.mcpServer.connect(stdioTransport);
      this.logger.info("STDIO transport connected successfully");
    } catch (error) {
      this.logger.error("Error connecting to STDIO transport:", error);
      process.exit(1);
    }
  }

  /**
   * Setup console redirection for STDIO transport
   */
  private setupStdioConsoleRedirection(): void {
    // Ensure we don't mix log messages with JSON messages
    console.log = (...args) => {
      this.logger.info("CONSOLE: " + args.join(" "));
    };

    console.error = (...args) => {
      this.logger.error("CONSOLE_ERROR: " + args.join(" "));
    };
  }

  /**
   * Setup STDIO event handlers
   */
  private setupStdioEventHandlers(): void {
    // Log when the stdin closes (which happens when the parent process terminates)
    process.stdin.on("end", () => {
      this.logger.info(
        "STDIN stream ended - parent process may have terminated"
      );
      process.exit(0);
    });
  }

  /**
   * Setup SSE transport with Express integration
   */
  setupSseTransport(app: express.Application): void {
    this.logger.info("Setting up SSE transport endpoints");

    // SSE endpoint for MCP connections
    app.get("/mcp", async (req: Request, res: Response) => {
      this.logger.info("New SSE connection from " + req.ip);

      // Set headers for SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Issues with certain proxies

      // Create a unique ID for this connection
      const connectionId = Date.now().toString();

      // Create a new transport for this connection
      const sseTransport = new SSEServerTransport("/messages", res);
      this.sseTransports.set(connectionId, sseTransport);

      // Log connection data for debugging
      this.logger.debug("Connection headers:", req.headers);

      // Remove the transport when the connection is closed
      res.on("close", () => {
        this.logger.info(`SSE connection ${connectionId} closed`);
        this.sseTransports.delete(connectionId);
      });

      try {
        await this.mcpServer.connect(sseTransport);
        this.logger.info(
          `SSE transport ${connectionId} connected successfully`
        );
      } catch (error) {
        this.logger.error("Error connecting to SSE transport:", error);
        this.sseTransports.delete(connectionId);
        res.status(500).end();
      }
    });

    // POST endpoint for MCP connections (alternative to SSE)
    app.post(
      "/mcp",
      express.json(),
      async (req: Request, res: Response) => {
        this.logger.debug("Received MCP POST request:", req.body);

        try {
          // Try to handle the request with each transport
          const transports = Array.from(this.sseTransports.values());

          if (transports.length === 0) {
            this.logger.error("No active SSE connections found for MCP POST");
            return res.status(503).json({ error: "No active MCP connections" });
          }

          let handled = false;
          let lastError = null;

          for (const transport of transports) {
            try {
              // Use any available method to process the request
              const sseTransport = transport as any;

              if (typeof sseTransport.handleRequest === "function") {
                this.logger.debug("Using handleRequest method for MCP POST");
                handled = await sseTransport.handleRequest(req, res);
              } else if (typeof sseTransport.processRequest === "function") {
                this.logger.debug("Using processRequest method for MCP POST");
                handled = await sseTransport.processRequest(req, res);
              }

              if (handled) {
                this.logger.debug("MCP POST request handled successfully");
                break;
              }
            } catch (e) {
              lastError = e;
              this.logger.error("Error processing MCP POST request with transport:", e);
            }
          }

          if (!handled) {
            this.logger.error("No transport handled the MCP POST request");
            if (lastError) {
              this.logger.error("Last error:", lastError);
            }
            res.status(404).json({ error: "No matching transport found for MCP request" });
          }
        } catch (error) {
          this.logger.error("Error handling MCP POST request:", error);
          res.status(500).json({
            error: "Internal server error",
            details: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );

    // Messages endpoint for SSE transport
    app.post(
      "/messages",
      express.json(),
      async (req: Request, res: Response) => {
        this.logger.debug("Received message:", req.body);

        try {
          // Try to handle the request with each transport
          const transports = Array.from(this.sseTransports.values());

          if (transports.length === 0) {
            this.logger.error("No active SSE connections found");
            return res.status(503).json({ error: "No active SSE connections" });
          }

          let handled = false;
          let lastError = null;

          for (const transport of transports) {
            try {
              // Use any available method to process the request
              const sseTransport = transport as any;

              if (typeof sseTransport.handleRequest === "function") {
                this.logger.debug("Using handleRequest method");
                handled = await sseTransport.handleRequest(req, res);
              } else if (typeof sseTransport.processRequest === "function") {
                this.logger.debug("Using processRequest method");
                handled = await sseTransport.processRequest(req, res);
              }

              if (handled) {
                this.logger.debug("Request handled successfully");
                break;
              }
            } catch (e) {
              lastError = e;
              this.logger.error("Error processing request with transport:", e);
            }
          }

          if (!handled) {
            this.logger.error("No transport handled the request");
            if (lastError) {
              this.logger.error("Last error:", lastError);
            }
            res.status(404).json({ error: "No matching transport found" });
          }
        } catch (error) {
          this.logger.error("Error handling message:", error);
          res.status(500).json({
            error: "Internal server error",
            details: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  /**
   * Get transport type
   */
  getTransportType(): string {
    return this.transport;
  }

  /**
   * Check if transport is STDIO
   */
  isStdio(): boolean {
    return this.transport === TransportType.STDIO;
  }

  /**
   * Check if transport is SSE
   */
  isSse(): boolean {
    return this.transport === TransportType.SSE;
  }

  /**
   * Get active SSE connections count
   */
  getActiveConnectionsCount(): number {
    return this.sseTransports.size;
  }

  /**
   * Close all active SSE connections
   */
  closeAllConnections(): void {
    this.logger.info(
      `Closing ${this.sseTransports.size} active SSE connections`
    );
    this.sseTransports.clear();
  }
}

/**
 * Create and configure a transport manager
 */
export function createTransportManager(
  logger: Logger,
  configManager: ConfigManager,
  mcpServer: any,
  transport: string
): TransportManager {
  const transportManager = new TransportManager(
    logger,
    configManager,
    mcpServer,
    transport
  );

  // Validate transport configuration
  transportManager.validateTransport();

  return transportManager;
}
