/**
 * Server Management Module
 * Handles HTTP server lifecycle, process management, and orchestration
 */

import { createServer, Server } from "http";
import { ApiManager } from "../api/index.js";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { TransportManager } from "../transport/index.js";

/**
 * Server Manager class
 */
export class ServerManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private transportManager: TransportManager;
  private apiManager?: ApiManager;
  private httpServer?: Server;
  private port: number;

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    transportManager: TransportManager,
    apiManager?: ApiManager
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.transportManager = transportManager;
    this.apiManager = apiManager;
    this.port = configManager.getPort();
  }

  /**
   * Start the server based on transport type
   */
  async startServer(): Promise<void> {
    try {
      this.logger.info(
        `Starting server with ${this.transportManager.getTransportType()} transport`
      );

      // Setup process event handlers
      this.setupProcessEventHandlers();

      if (this.transportManager.isStdio()) {
        await this.startStdioServer();
      } else if (this.transportManager.isSse()) {
        await this.startSseServer();
      } else if (this.transportManager.isHttp()) {
        await this.startHttpServer();
      } else {
        throw new Error(
          `Unsupported transport type: ${this.transportManager.getTransportType()}`
        );
      }

      this.logger.info("Server started successfully");
    } catch (error) {
      this.logger.error("Error starting server:", error);
      throw error;
    }
  }

  /**
   * Start server with STDIO transport
   */
  private async startStdioServer(): Promise<void> {
    // For STDIO, we don't need an HTTP server
    await this.transportManager.setupStdioTransport();
  }

  /**
   * Start server with SSE transport
   */
  private async startSseServer(): Promise<void> {
    if (!this.apiManager) {
      throw new Error("API Manager is required for SSE transport");
    }

    // Create Express app
    const app = this.apiManager.createApp();

    // Setup SSE transport endpoints
    this.transportManager.setupSseTransport(app);

    // Create HTTP server
    this.httpServer = createServer(app);

    // Setup HTTP server event handlers
    this.setupHttpServerEventHandlers();

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.port, "0.0.0.0", () => {
        this.logger.info(
          `MCP Prompts Server running on http://0.0.0.0:${this.port}`
        );
        this.logger.info(
          `Connect to http://0.0.0.0:${this.port}/mcp for MCP connections`
        );
        resolve();
      });

      this.httpServer!.on("error", (error: any) => {
        if (error.code === "EADDRINUSE") {
          this.logger.error(
            `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
          );
        } else {
          this.logger.error("Server error:", error);
        }
        reject(error);
      });
    });
  }

  /**
   * Start server with HTTP transport
   */
  private async startHttpServer(): Promise<void> {
    if (!this.apiManager) {
      throw new Error("API Manager is required for HTTP transport");
    }

    console.error(`🌐 Starting HTTP server on port ${this.port} (from PORT env: ${process.env.PORT})`);

    // Create Express app
    const app = this.apiManager.createApp();

    // Setup HTTP transport endpoints
    this.transportManager.setupHttpTransport(app);

    // Create HTTP server
    this.httpServer = createServer(app);

    // Setup HTTP server event handlers
    this.setupHttpServerEventHandlers();

    // Start listening
    await new Promise<void>((resolve, reject) => {
      console.error(`🌐 Attempting to listen on 0.0.0.0:${this.port}...`);
      this.httpServer!.listen(this.port, "0.0.0.0", () => {
        console.error(`✅ HTTP server listening on 0.0.0.0:${this.port}`);
        this.logger.info(
          `MCP Prompts Server running on http://0.0.0.0:${this.port} (HTTP transport)`
        );
        this.logger.info(
          `Connect to http://0.0.0.0:${this.port}/mcp for MCP connections`
        );
        resolve();
      });

      this.httpServer!.on("error", (error: any) => {
        console.error(`❌ HTTP server error:`, error);
        if (error.code === "EADDRINUSE") {
          console.error(`❌ Port ${this.port} is already in use`);
          this.logger.error(
            `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
          );
        } else {
          console.error(`❌ Server error code: ${error.code}, message: ${error.message}`);
          this.logger.error("Server error:", error);
        }
        reject(error);
      });
    });
  }

  /**
   * Setup HTTP server event handlers
   */
  private setupHttpServerEventHandlers(): void {
    if (!this.httpServer) return;

    this.httpServer.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        this.logger.error(
          `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
        );
      } else {
        this.logger.error("Server error:", error);
      }
      process.exit(1);
    });

    this.httpServer.on("close", () => {
      this.logger.info("HTTP server closed");
    });
  }

  /**
   * Setup process event handlers
   */
  private setupProcessEventHandlers(): void {
    // Handle graceful shutdown
    process.on("SIGINT", () => {
      this.logger.info("Received SIGINT, shutting down server...");
      this.shutdown();
    });

    process.on("SIGTERM", () => {
      this.logger.info("Received SIGTERM, shutting down server...");
      this.shutdown();
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      this.logger.error("Uncaught exception:", error);
      this.shutdown(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      this.logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.shutdown(1);
    });

    // Log system info for debugging
    this.logSystemInfo();
  }

  /**
   * Log system information
   */
  private logSystemInfo(): void {
    this.logger.info(
      `Server process memory usage: ${JSON.stringify(process.memoryUsage())}`
    );
    this.logger.info(`Process ID: ${process.pid}`);
    this.logger.info(`Node version: ${process.version}`);
    this.logger.info(`Working directory: ${process.cwd()}`);
  }

  /**
   * Graceful shutdown
   */
  shutdown(exitCode: number = 0): void {
    this.logger.info("Initiating graceful shutdown...");

    // Close HTTP server if running
    if (this.httpServer) {
      this.httpServer.close((error) => {
        if (error) {
          this.logger.error("Error closing HTTP server:", error);
        } else {
          this.logger.info("HTTP server closed successfully");
        }
        this.finalizeShutdown(exitCode);
      });
    } else {
      this.finalizeShutdown(exitCode);
    }
  }

  /**
   * Finalize shutdown process
   */
  private finalizeShutdown(exitCode: number): void {
    // Close transport connections
    if (this.transportManager.isSse() || this.transportManager.isHttp()) {
      this.transportManager.closeAllConnections();
    }

    this.logger.info("Server shutdown complete");
    process.exit(exitCode);
  }

  /**
   * Restart the server
   */
  async restart(reason: string = "Manual restart"): Promise<void> {
    this.logger.info(`Restarting server: ${reason}`);

    try {
      // Shutdown current server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => {
            this.logger.info("Server closed for restart");
            resolve();
          });
        });
      }

      // Wait a moment before restarting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Start server again
      await this.startServer();

      this.logger.info("Server restarted successfully");
    } catch (error) {
      this.logger.error("Error during server restart:", error);
      throw error;
    }
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    if (this.transportManager.isStdio()) {
      // For STDIO, we consider it running if the process is alive
      return true;
    } else {
      // For SSE and HTTP, check if HTTP server is listening
      return this.httpServer?.listening || false;
    }
  }

  /**
   * Get server status information
   */
  getStatus(): {
    running: boolean;
    transport: string;
    port?: number;
    connections?: number;
    uptime: number;
  } {
    return {
      running: this.isRunning(),
      transport: this.transportManager.getTransportType(),
      port: (this.transportManager.isSse() || this.transportManager.isHttp()) ? this.port : undefined,
      connections: this.transportManager.isSse()
        ? this.transportManager.getActiveConnectionsCount()
        : undefined,
      uptime: process.uptime(),
    };
  }

  /**
   * Get the HTTP server instance (for SSE transport)
   */
  getHttpServer(): Server | undefined {
    return this.httpServer;
  }

  /**
   * Get the port number
   */
  getPort(): number {
    return this.port;
  }
}

/**
 * Create and configure a server manager
 */
export function createServerManager(
  logger: Logger,
  configManager: ConfigManager,
  transportManager: TransportManager,
  apiManager?: ApiManager
): ServerManager {
  return new ServerManager(logger, configManager, transportManager, apiManager);
}

/**
 * Server startup helper function
 */
export async function startMcpServer(
  logger: Logger,
  configManager: ConfigManager,
  transportManager: TransportManager,
  apiManager?: ApiManager
): Promise<ServerManager> {
  const serverManager = createServerManager(
    logger,
    configManager,
    transportManager,
    apiManager
  );

  await serverManager.startServer();
  return serverManager;
}
