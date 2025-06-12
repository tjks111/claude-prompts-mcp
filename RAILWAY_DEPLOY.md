# 🚀 Railway Deployment Guide

Deploy your Claude Prompts MCP Server to Railway with one click!

## ✨ One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/claude-prompts-mcp)

## 🔧 Manual Deployment

### Step 1: Fork or Clone Repository
1. Fork this repository to your GitHub account
2. Or clone it locally and push to your own repository

### Step 2: Deploy to Railway
1. Go to [Railway.app](https://railway.app)
2. Sign in with your GitHub account
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your forked repository
5. Railway will automatically detect the configuration and deploy

### Step 3: Configure Environment (Optional)
Railway will automatically:
- Set the `PORT` environment variable
- Build the TypeScript project
- Start the server with SSE transport
- Provide HTTPS endpoint

## 🌐 Access Your Deployed Server

After deployment, Railway will provide you with a URL like:
```
https://your-app-name.railway.app
```

### Available Endpoints:
- **Health Check**: `https://your-app-name.railway.app/health`
- **MCP Connection**: `https://your-app-name.railway.app/mcp`
- **Prompts API**: `https://your-app-name.railway.app/prompts`
- **Messages**: `https://your-app-name.railway.app/messages`

## 🔌 Connect to Your MCP Server

### For Web-based MCP Clients:
```javascript
// Connect via Server-Sent Events
const eventSource = new EventSource('https://your-app-name.railway.app/mcp');
```

### For Claude Desktop (via HTTP):
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "claude-prompts-railway": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-stdio", "https://your-app-name.railway.app/mcp"]
    }
  }
}
```

## ⚙️ Configuration

The server automatically configures itself for Railway:
- **Port**: Uses Railway's `PORT` environment variable
- **Transport**: SSE (Server-Sent Events) for web compatibility
- **CORS**: Enabled for cross-origin requests
- **Logging**: Production-friendly quiet mode

## 📊 Features Available

Your deployed server includes:
- ✅ 24+ Pre-built prompts across 13 categories
- ✅ Real-time prompt management via MCP tools
- ✅ Hot-reload capabilities
- ✅ Advanced template engine (Nunjucks)
- ✅ Prompt chains and workflows
- ✅ REST API endpoints
- ✅ Health monitoring

## 🛠️ Customization

### Add Your Own Prompts:
1. Fork the repository
2. Add your prompts to the `server/prompts/` directory
3. Update `server/promptsConfig.json` to include your new categories
4. Push changes - Railway will auto-deploy

### Environment Variables:
You can set these in Railway's dashboard:
- `NODE_ENV=production` (automatically set)
- `PORT` (automatically set by Railway)
- `MCP_PROMPTS_CONFIG_PATH` (optional: custom config path)

## 🔍 Monitoring

### Health Check:
```bash
curl https://your-app-name.railway.app/health
```

### View Available Prompts:
```bash
curl https://your-app-name.railway.app/prompts
```

## 🚨 Troubleshooting

### Build Issues:
- Check Railway logs in the dashboard
- Ensure all dependencies are in `package.json`
- Verify TypeScript compiles locally

### Connection Issues:
- Verify the URL is accessible
- Check CORS settings if connecting from browser
- Ensure SSE is supported by your client

### Performance:
- Railway provides automatic scaling
- Monitor usage in Railway dashboard
- Consider upgrading plan for high traffic

## 💡 Tips

1. **Custom Domain**: Add your own domain in Railway settings
2. **Environment Variables**: Use Railway's dashboard to set config
3. **Logs**: View real-time logs in Railway dashboard
4. **Scaling**: Railway auto-scales based on traffic
5. **Updates**: Push to your repo to trigger auto-deployment

## 🔗 Useful Links

- [Railway Documentation](https://docs.railway.app)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Claude Desktop Setup](https://claude.ai/desktop)

---

🎉 **Your MCP server is now running on Railway with enterprise-grade infrastructure!**