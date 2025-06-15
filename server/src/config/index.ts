/**
 * Configuration Management Module
 * Handles loading and validation of server configuration from config.json
 */

import { readFile } from "fs/promises";
import path from "path";
import { Config } from "../types/index.js";

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  server: {
    name: "Claude Custom Prompts",
    version: "1.0.6",
    port: 3456,
  },
  prompts: {
    file: "promptsConfig.json",
  },
  transports: {
    default: "sse",
    sse: { enabled: true },
    stdio: { enabled: true },
    http: { enabled: true },
  },
};

/**
 * Configuration manager class
 */
export class ConfigManager {
  private config: Config;
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = DEFAULT_CONFIG;
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<Config> {
    try {
      const configContent = await readFile(this.configPath, "utf8");
      this.config = JSON.parse(configContent) as Config;

      // Validate and set defaults for any missing properties
      this.validateAndSetDefaults();

      return this.config;
    } catch (error) {
      console.error(
        `Error loading configuration from ${this.configPath}:`,
        error
      );
      console.info("Using default configuration");
      this.config = DEFAULT_CONFIG;
      return this.config;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Get server configuration
   */
  getServerConfig() {
    return this.config.server;
  }

  /**
   * Get prompts configuration
   */
  getPromptsConfig() {
    return this.config.prompts;
  }

  /**
   * Get transports configuration
   */
  getTransportsConfig() {
    return this.config.transports;
  }

  /**
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : this.config.server.port;
  }

  /**
   * Determine transport from command line arguments or configuration
   */
  getTransport(args: string[]): string {
    const transportArg = args.find((arg: string) =>
      arg.startsWith("--transport=")
    );
    return transportArg
      ? transportArg.split("=")[1]
      : this.config.transports.default;
  }

  /**
   * Check if a transport is enabled
   */
  isTransportEnabled(transport: string): boolean {
    const transportConfig = this.config.transports[transport];
    if (
      transportConfig &&
      typeof transportConfig === "object" &&
      "enabled" in transportConfig
    ) {
      const config = transportConfig as { enabled: boolean };
      return config.enabled === true;
    }
    return false;
  }

  /**
   * Get prompts file path relative to config directory
   */
  getPromptsFilePath(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, this.config.prompts.file);
  }

  /**
   * Validate configuration and set defaults for missing properties
   */
  private validateAndSetDefaults(): void {
    // Ensure server config exists
    if (!this.config.server) {
      this.config.server = DEFAULT_CONFIG.server;
    } else {
      this.config.server = {
        ...DEFAULT_CONFIG.server,
        ...this.config.server,
      };
    }

    // Ensure prompts config exists
    if (!this.config.prompts) {
      this.config.prompts = DEFAULT_CONFIG.prompts;
    } else {
      this.config.prompts = {
        ...DEFAULT_CONFIG.prompts,
        ...this.config.prompts,
      };
    }

    // Ensure transports config exists
    if (!this.config.transports) {
      this.config.transports = DEFAULT_CONFIG.transports;
    } else {
      this.config.transports = {
        ...DEFAULT_CONFIG.transports,
        ...this.config.transports,
      };
    }
  }
}

/**
 * Create and initialize a configuration manager
 */
export async function createConfigManager(
  configPath: string
): Promise<ConfigManager> {
  const configManager = new ConfigManager(configPath);
  await configManager.loadConfig();
  return configManager;
}

/**
 * Validate that the selected transport is enabled
 */
export function validateTransport(
  configManager: ConfigManager,
  transport: string
): void {
  if (!configManager.isTransportEnabled(transport)) {
    throw new Error(
      `Transport '${transport}' is not enabled in the configuration`
    );
  }
}
