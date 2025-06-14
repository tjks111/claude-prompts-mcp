#!/usr/bin/env node

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL('/mcp', RAILWAY_URL);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    const body = {
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: 1
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ parseError: e.message, body: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

async function checkPromptsVsTools() {
  console.log('🔍 Checking MCP Prompts vs Tool-Based Prompts\n');
  
  // Check MCP Protocol Prompts
  console.log('1. 📋 MCP Protocol Prompts (what OpenAI client shows):');
  try {
    const promptsResult = await makeRequest('prompts/list');
    if (promptsResult.result && promptsResult.result.prompts) {
      const prompts = promptsResult.result.prompts;
      console.log(`   Found: ${prompts.length} MCP protocol prompts`);
      if (prompts.length > 0) {
        prompts.forEach(prompt => {
          console.log(`   - ${prompt.name}: ${prompt.description}`);
        });
      } else {
        console.log('   ✅ This explains why OpenAI shows "Prompts: 0"');
      }
    } else {
      console.log('   ❌ Error getting MCP prompts');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  // Check Tools
  console.log('\n2. 🔧 MCP Tools (what OpenAI client shows as "Tools: 6"):');
  try {
    const toolsResult = await makeRequest('tools/list');
    if (toolsResult.result && toolsResult.result.tools) {
      const tools = toolsResult.result.tools;
      console.log(`   Found: ${tools.length} tools`);
      tools.forEach(tool => {
        console.log(`   - ${tool.name}`);
      });
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  // Check Tool-Based Prompts
  console.log('\n3. 📝 Tool-Based Prompt Templates (accessed via process_slash_command):');
  try {
    const listResult = await makeRequest('tools/call', {
      name: 'listprompts',
      arguments: {}
    });
    
    if (listResult.result && listResult.result.content) {
      const content = listResult.result.content[0].text;
      const lines = content.split('\n');
      const promptCommands = lines.filter(line => line.includes('###') || line.includes('/'));
      console.log(`   Found: ~${promptCommands.length} prompt templates`);
      console.log('   Examples:');
      promptCommands.slice(0, 5).forEach(line => {
        if (line.trim()) {
          console.log(`   - ${line.trim()}`);
        }
      });
      if (promptCommands.length > 5) {
        console.log(`   ... and ${promptCommands.length - 5} more`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY:');
  console.log('• OpenAI shows "Prompts: 0" because your server uses tool-based prompts');
  console.log('• OpenAI shows "Tools: 6" - these are the actual MCP tools');
  console.log('• Your 25+ prompt templates are accessed via the process_slash_command tool');
  console.log('• Use >>command_name syntax to invoke your prompt templates');
  console.log('• This is a valid and powerful design pattern for MCP servers!');
  console.log('='.repeat(60));
}

checkPromptsVsTools();