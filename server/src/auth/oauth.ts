/**
 * MCP OAuth 2.1 Authentication Implementation
 * Based on MCP Authorization Specification 2025-03-26
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization
 */

import express, { Request, Response } from "express";
import crypto from "crypto";
import { Logger } from "../logging/index.js";

export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  issuer: string;
  supportedGrantTypes: string[];
  supportedResponseTypes: string[];
  supportedScopes: string[];
}

export interface AccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  created_at: number;
}

export interface AuthorizationRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/**
 * MCP OAuth 2.1 Server Implementation
 * Implements the MCP Authorization Specification requirements
 */
export class McpOAuthServer {
  private logger: Logger;
  private config: OAuthConfig;
  private clients: Map<string, any> = new Map();
  private authorizationCodes: Map<string, any> = new Map();
  private accessTokens: Map<string, AccessToken> = new Map();
  private refreshTokens: Map<string, any> = new Map();

  constructor(logger: Logger, baseUrl: string) {
    this.logger = logger;
    this.config = {
      authorizationEndpoint: `${baseUrl}/authorize`,
      tokenEndpoint: `${baseUrl}/token`,
      registrationEndpoint: `${baseUrl}/register`,
      issuer: baseUrl,
      supportedGrantTypes: [
        "authorization_code",
        "client_credentials",
        "refresh_token"
      ],
      supportedResponseTypes: ["code"],
      supportedScopes: ["mcp", "prompts", "tools", "read", "write"]
    };
  }

  /**
   * Setup OAuth endpoints according to MCP specification
   */
  setupOAuthEndpoints(app: express.Application): void {
    this.logger.info("Setting up MCP OAuth 2.1 endpoints");

    // OAuth 2.0 Authorization Server Metadata (RFC 8414)
    app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
      this.handleMetadataDiscovery(req, res);
    });

    // Authorization endpoint
    app.get("/authorize", (req: Request, res: Response) => {
      this.handleAuthorizationRequest(req, res);
    });

    // Token endpoint
    app.post("/token", express.json(), (req: Request, res: Response) => {
      this.handleTokenRequest(req, res);
    });

    // Dynamic Client Registration (RFC 7591)
    app.post("/register", express.json(), (req: Request, res: Response) => {
      this.handleClientRegistration(req, res);
    });

    // Token introspection endpoint
    app.post("/introspect", express.json(), (req: Request, res: Response) => {
      this.handleTokenIntrospection(req, res);
    });

    this.logger.info("MCP OAuth 2.1 endpoints configured successfully");
  }

  /**
   * Handle OAuth 2.0 Authorization Server Metadata discovery
   * RFC 8414 compliance
   */
  private handleMetadataDiscovery(req: Request, res: Response): void {
    this.logger.info("OAuth metadata discovery request");

    const metadata = {
      issuer: this.config.issuer,
      authorization_endpoint: this.config.authorizationEndpoint,
      token_endpoint: this.config.tokenEndpoint,
      registration_endpoint: this.config.registrationEndpoint,
      introspection_endpoint: `${this.config.issuer}/introspect`,
      response_types_supported: this.config.supportedResponseTypes,
      grant_types_supported: this.config.supportedGrantTypes,
      scopes_supported: this.config.supportedScopes,
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none" // For public clients
      ],
      code_challenge_methods_supported: ["S256"], // PKCE required
      service_documentation: "https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization",
      ui_locales_supported: ["en"],
      mcp_protocol_version: "2025-03-26"
    };

    res.json(metadata);
  }

  /**
   * Handle authorization requests (OAuth 2.1 Authorization Code flow)
   */
  private handleAuthorizationRequest(req: Request, res: Response): void {
    this.logger.info("Authorization request received:", req.query);

    try {
      const {
        response_type,
        client_id,
        redirect_uri,
        scope,
        state,
        code_challenge,
        code_challenge_method
      } = req.query as any;

      // Validate required parameters
      if (!response_type || !client_id || !redirect_uri) {
        return this.sendError(res, "invalid_request", "Missing required parameters");
      }

      if (response_type !== "code") {
        return this.sendError(res, "unsupported_response_type", "Only authorization code flow is supported");
      }

      // PKCE is required for all clients (OAuth 2.1 requirement)
      if (!code_challenge || code_challenge_method !== "S256") {
        return this.sendError(res, "invalid_request", "PKCE with S256 is required");
      }

      // Validate client
      const client = this.clients.get(client_id);
      if (!client) {
        return this.sendError(res, "invalid_client", "Unknown client");
      }

      // Validate redirect URI
      if (!client.redirect_uris.includes(redirect_uri)) {
        return this.sendError(res, "invalid_request", "Invalid redirect URI");
      }

      // Generate authorization code
      const authCode = this.generateSecureToken();
      const codeData = {
        client_id,
        redirect_uri,
        scope: scope || "mcp",
        code_challenge,
        code_challenge_method,
        created_at: Date.now(),
        expires_at: Date.now() + 600000 // 10 minutes
      };

      this.authorizationCodes.set(authCode, codeData);

      // For demo purposes, auto-approve (in production, show consent screen)
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", authCode);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }

      this.logger.info("Authorization approved, redirecting to:", redirectUrl.toString());
      res.redirect(redirectUrl.toString());

    } catch (error) {
      this.logger.error("Authorization request error:", error);
      this.sendError(res, "server_error", "Internal server error");
    }
  }

  /**
   * Handle token requests (OAuth 2.1 Token endpoint)
   */
  private handleTokenRequest(req: Request, res: Response): void {
    this.logger.info("Token request received:", req.body);

    try {
      const { grant_type } = req.body;

      switch (grant_type) {
        case "authorization_code":
          return this.handleAuthorizationCodeGrant(req, res);
        case "client_credentials":
          return this.handleClientCredentialsGrant(req, res);
        case "refresh_token":
          return this.handleRefreshTokenGrant(req, res);
        default:
          return this.sendError(res, "unsupported_grant_type", "Grant type not supported");
      }
    } catch (error) {
      this.logger.error("Token request error:", error);
      this.sendError(res, "server_error", "Internal server error");
    }
  }

  /**
   * Handle authorization code grant
   */
  private handleAuthorizationCodeGrant(req: Request, res: Response): void {
    const {
      code,
      redirect_uri,
      client_id,
      code_verifier
    } = req.body;

    // Validate required parameters
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return this.sendError(res, "invalid_request", "Missing required parameters");
    }

    // Validate authorization code
    const codeData = this.authorizationCodes.get(code);
    if (!codeData) {
      return this.sendError(res, "invalid_grant", "Invalid authorization code");
    }

    // Check expiration
    if (Date.now() > codeData.expires_at) {
      this.authorizationCodes.delete(code);
      return this.sendError(res, "invalid_grant", "Authorization code expired");
    }

    // Validate PKCE
    const codeChallenge = crypto
      .createHash("sha256")
      .update(code_verifier)
      .digest("base64url");

    if (codeChallenge !== codeData.code_challenge) {
      return this.sendError(res, "invalid_grant", "Invalid code verifier");
    }

    // Validate client and redirect URI
    if (codeData.client_id !== client_id || codeData.redirect_uri !== redirect_uri) {
      return this.sendError(res, "invalid_grant", "Client or redirect URI mismatch");
    }

    // Generate tokens
    const accessToken = this.generateAccessToken(client_id, codeData.scope);
    const refreshToken = this.generateRefreshToken(client_id, codeData.scope);

    // Clean up authorization code (one-time use)
    this.authorizationCodes.delete(code);

    this.logger.info("Access token issued for client:", client_id);

    res.json({
      access_token: accessToken.access_token,
      token_type: "Bearer",
      expires_in: accessToken.expires_in,
      refresh_token: refreshToken,
      scope: accessToken.scope
    });
  }

  /**
   * Handle client credentials grant
   */
  private handleClientCredentialsGrant(req: Request, res: Response): void {
    const { client_id, client_secret, scope } = req.body;

    // Validate client credentials
    const client = this.clients.get(client_id);
    if (!client || client.client_secret !== client_secret) {
      return this.sendError(res, "invalid_client", "Invalid client credentials");
    }

    // Generate access token
    const accessToken = this.generateAccessToken(client_id, scope || "mcp");

    this.logger.info("Client credentials token issued for:", client_id);

    res.json({
      access_token: accessToken.access_token,
      token_type: "Bearer",
      expires_in: accessToken.expires_in,
      scope: accessToken.scope
    });
  }

  /**
   * Handle refresh token grant
   */
  private handleRefreshTokenGrant(req: Request, res: Response): void {
    const { refresh_token, client_id } = req.body;

    const refreshData = this.refreshTokens.get(refresh_token);
    if (!refreshData || refreshData.client_id !== client_id) {
      return this.sendError(res, "invalid_grant", "Invalid refresh token");
    }

    // Generate new access token
    const accessToken = this.generateAccessToken(client_id, refreshData.scope);

    this.logger.info("Token refreshed for client:", client_id);

    res.json({
      access_token: accessToken.access_token,
      token_type: "Bearer",
      expires_in: accessToken.expires_in,
      scope: accessToken.scope
    });
  }

  /**
   * Handle dynamic client registration (RFC 7591)
   */
  private handleClientRegistration(req: Request, res: Response): void {
    this.logger.info("Client registration request:", req.body);

    try {
      const {
        redirect_uris,
        client_name,
        client_uri,
        grant_types,
        response_types,
        scope
      } = req.body;

      // Validate required parameters
      if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return this.sendError(res, "invalid_redirect_uri", "Valid redirect URIs required");
      }

      // Validate redirect URIs (must be HTTPS or localhost)
      for (const uri of redirect_uris) {
        const url = new URL(uri);
        if (url.protocol !== "https:" && url.hostname !== "localhost") {
          return this.sendError(res, "invalid_redirect_uri", "Redirect URIs must be HTTPS or localhost");
        }
      }

      // Generate client credentials
      const clientId = this.generateSecureToken();
      const clientSecret = this.generateSecureToken();

      const client = {
        client_id: clientId,
        client_secret: clientSecret,
        client_name: client_name || "MCP Client",
        client_uri: client_uri,
        redirect_uris,
        grant_types: grant_types || ["authorization_code"],
        response_types: response_types || ["code"],
        scope: scope || "mcp",
        created_at: Date.now()
      };

      this.clients.set(clientId, client);

      this.logger.info("Client registered:", clientId);

      res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        scope: client.scope
      });

    } catch (error) {
      this.logger.error("Client registration error:", error);
      this.sendError(res, "server_error", "Internal server error");
    }
  }

  /**
   * Handle token introspection
   */
  private handleTokenIntrospection(req: Request, res: Response): void {
    const { token } = req.body;

    const tokenData = this.accessTokens.get(token);
    if (!tokenData) {
      res.json({ active: false });
      return;
    }

    const isExpired = Date.now() > (tokenData.created_at + tokenData.expires_in * 1000);
    if (isExpired) {
      this.accessTokens.delete(token);
      res.json({ active: false });
      return;
    }

    res.json({
      active: true,
      scope: tokenData.scope,
      client_id: tokenData.access_token, // This would be stored with the token
      token_type: tokenData.token_type,
      exp: Math.floor((tokenData.created_at + tokenData.expires_in * 1000) / 1000)
    });
  }

  /**
   * Validate access token for MCP requests
   */
  validateAccessToken(token: string): boolean {
    const tokenData = this.accessTokens.get(token);
    if (!tokenData) {
      return false;
    }

    const isExpired = Date.now() > (tokenData.created_at + tokenData.expires_in * 1000);
    if (isExpired) {
      this.accessTokens.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Generate secure access token
   */
  private generateAccessToken(clientId: string, scope: string): AccessToken {
    const token = this.generateSecureToken();
    const expiresIn = 3600; // 1 hour

    const accessToken: AccessToken = {
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope,
      created_at: Date.now()
    };

    this.accessTokens.set(token, accessToken);
    return accessToken;
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(clientId: string, scope: string): string {
    const token = this.generateSecureToken();
    this.refreshTokens.set(token, {
      client_id: clientId,
      scope,
      created_at: Date.now()
    });
    return token;
  }

  /**
   * Generate cryptographically secure token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Send OAuth error response
   */
  private sendError(res: Response, error: string, description?: string): void {
    res.status(400).json({
      error,
      error_description: description
    });
  }

  /**
   * Get OAuth configuration
   */
  getConfig(): OAuthConfig {
    return this.config;
  }
}