/**
 * Logging Module
 * Handles file logging and transport-aware console logging
 */

import { appendFile, writeFile } from "fs/promises";
import { LogLevel, TransportType } from "../types/index.js";

/**
 * Logger interface compatible with existing code
 */
export interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

/**
 * Logging configuration options
 */
export interface LoggingConfig {
  logFile: string;
  transport: string;
  enableDebug?: boolean;
}

/**
 * Enhanced logger implementation with file and console logging
 */
export class EnhancedLogger implements Logger {
  private logFile: string;
  private transport: string;
  private enableDebug: boolean;

  constructor(config: LoggingConfig) {
    this.logFile = config.logFile;
    this.transport = config.transport;
    this.enableDebug = config.enableDebug || false;
  }

  /**
   * Initialize the log file with a clean start
   */
  async initLogFile(): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      await writeFile(
        this.logFile,
        `--- MCP Server Log Started at ${timestamp} ---\n`,
        "utf8"
      );
    } catch (error) {
      console.error(`Error initializing log file:`, error);
    }
  }

  /**
   * Write a message to the log file
   */
  private async logToFile(
    level: LogLevel,
    message: string,
    ...args: any[]
  ): Promise<void> {
    try {
      let logMessage = `[${new Date().toISOString()}] [${level}] ${message}`;
      if (args.length > 0) {
        logMessage += ` ${args
          .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : arg))
          .join(" ")}`;
      }
      await appendFile(this.logFile, logMessage + "\n", "utf8");
    } catch (error) {
      console.error("Error writing to log file:", error);
    }
  }

  /**
   * Log to console only when not using STDIO transport
   */
  private logToConsole(level: LogLevel, message: string, ...args: any[]): void {
    if (this.transport !== TransportType.STDIO) {
      switch (level) {
        case LogLevel.INFO:
          console.log(`[INFO] ${message}`, ...args);
          break;
        case LogLevel.ERROR:
          console.error(`[ERROR] ${message}`, ...args);
          break;
        case LogLevel.WARN:
          console.warn(`[WARN] ${message}`, ...args);
          break;
        case LogLevel.DEBUG:
          if (this.enableDebug) {
            console.log(`[DEBUG] ${message}`, ...args);
          }
          break;
      }
    }
  }

  /**
   * Info level logging
   */
  info(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.INFO, message, ...args);
    this.logToFile(LogLevel.INFO, message, ...args);
  }

  /**
   * Error level logging
   */
  error(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.ERROR, message, ...args);
    this.logToFile(LogLevel.ERROR, message, ...args);
  }

  /**
   * Warning level logging
   */
  warn(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.WARN, message, ...args);
    this.logToFile(LogLevel.WARN, message, ...args);
  }

  /**
   * Debug level logging
   */
  debug(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.DEBUG, message, ...args);
    this.logToFile(LogLevel.DEBUG, message, ...args);
  }

  /**
   * Update transport type (useful when transport is determined after logger creation)
   */
  setTransport(transport: string): void {
    this.transport = transport;
  }

  /**
   * Enable or disable debug logging
   */
  setDebugEnabled(enabled: boolean): void {
    this.enableDebug = enabled;
  }

  /**
   * Log startup information
   */
  logStartupInfo(transport: string, config: any): void {
    this.info(`Server starting up - Process ID: ${process.pid}`);
    this.info(`Node version: ${process.version}`);
    this.info(`Working directory: ${process.cwd()}`);
    this.info(`Using transport: ${transport}`);
    this.info(`Command-line arguments: ${JSON.stringify(process.argv)}`);
    this.debug("Configuration:", JSON.stringify(config, null, 2));
  }

  /**
   * Log memory usage information
   */
  logMemoryUsage(): void {
    this.info(
      `Server process memory usage: ${JSON.stringify(process.memoryUsage())}`
    );
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggingConfig): EnhancedLogger {
  return new EnhancedLogger(config);
}

/**
 * Create a simple logger for areas that don't need the full enhanced logger
 * Now supports verbosity control via command-line flags
 */
export function createSimpleLogger(transport: string = "sse"): Logger {
  const enableConsole = transport !== TransportType.STDIO;

  // Check command-line flags for verbosity control
  const args = process.argv.slice(2);
  const isVerbose =
    args.includes("--verbose") || args.includes("--debug-startup");
  const isQuiet = args.includes("--quiet");

  return {
    info: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.log(`[INFO] ${message}`, ...args);
      }
    },
    error: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.error(`[ERROR] ${message}`, ...args);
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.warn(`[WARN] ${message}`, ...args);
      }
    },
    debug: (message: string, ...args: any[]) => {
      if (enableConsole && isVerbose) {
        console.log(`[DEBUG] ${message}`, ...args);
      }
    },
  };
}

/**
 * Setup console redirection for STDIO transport
 * This prevents log messages from interfering with JSON MCP messages
 */
export function setupConsoleRedirection(logger: Logger): void {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = (...args) => {
    logger.debug("CONSOLE: " + args.join(" "));
  };

  console.error = (...args) => {
    logger.error("CONSOLE_ERROR: " + args.join(" "));
  };
}

/**
 * Setup process event handlers for logging
 */
export function setupProcessEventHandlers(logger: Logger): void {
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down server...");
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", error);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  });

  // Log when the stdin closes (which happens when the parent process terminates)
  process.stdin.on("end", () => {
    logger.info("STDIN stream ended - parent process may have terminated");
    process.exit(0);
  });
}
