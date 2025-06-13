# Authentication Configuration

This MCP server supports multiple authentication methods for secure access.

## Environment Variables

### Required for Authentication
- `MCP_REQUIRE_AUTH=true` - Enable authentication (default: false)

### API Key Authentication (Recommended for simple setups)
- `MCP_API_KEYS=key1,key2,key3` - Comma-separated list of valid API keys

### OAuth 2.1 Authentication (Advanced)
The server includes full OAuth 2.1 support with PKCE for advanced authentication scenarios.

## Configuration Examples

### 1. Disable Authentication (Default)
```bash
# No environment variables needed
# Authentication is disabled by default
```

### 2. Simple API Key Authentication
```bash
export MCP_REQUIRE_AUTH=true
export MCP_API_KEYS=mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d,another-secret-key
```

### 3. OAuth 2.1 Authentication
```bash
export MCP_REQUIRE_AUTH=true
# OAuth tokens are generated dynamically through the OAuth endpoints
# See /register, /authorize, /token endpoints
```

## Usage

### With API Key
```bash
curl -H "Authorization: Bearer mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d" \
     https://your-server.com/mcp
```

### With OAuth Token
```bash
curl -H "Authorization: Bearer <oauth-access-token>" \
     https://your-server.com/mcp
```

## Security Notes

1. **API Keys**: Use long, random strings for API keys (minimum 32 characters recommended)
2. **HTTPS**: Always use HTTPS in production
3. **Environment Variables**: Store sensitive keys in environment variables, never in code
4. **Rotation**: Regularly rotate API keys and OAuth tokens

## Railway Deployment

For Railway deployments, set environment variables in the Railway dashboard:

1. Go to your Railway project
2. Navigate to Variables tab
3. Add:
   - `MCP_REQUIRE_AUTH=true`
   - `MCP_API_KEYS=your-secret-api-key-here`

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check that `MCP_REQUIRE_AUTH=true` and your API key is in `MCP_API_KEYS`
2. **Missing Bearer Token**: Ensure Authorization header format is `Bearer <token>`
3. **Invalid Token**: Verify the token matches exactly what's configured in `MCP_API_KEYS`

### Debug Logs

The server logs authentication attempts. Look for:
- `🔐 Authentication ENABLED/DISABLED`
- `✅ API key authentication successful`
- `✅ OAuth 2.1 Bearer token authentication successful`
- `🔒 MCP request rejected - authentication failed`