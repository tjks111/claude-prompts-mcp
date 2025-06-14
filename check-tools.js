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

async function checkTools() {
  console.log('🔧 Checking available tools...\n');
  
  try {
    const result = await makeRequest('tools/list');
    
    if (result.result && result.result.tools) {
      const tools = result.result.tools;
      console.log(`Found ${tools.length} tools:\n`);
      
      tools.forEach((tool, i) => {
        console.log(`${i + 1}. ${tool.name}`);
        console.log(`   Description: ${tool.description || 'No description'}`);
        
        if (tool.inputSchema && tool.inputSchema.properties) {
          const props = Object.keys(tool.inputSchema.properties);
          console.log(`   Parameters: ${props.join(', ')}`);
        }
        console.log('');
      });
      
      // Check for prompt management tools specifically
      const promptTools = tools.filter(t => 
        t.name.includes('prompt') || 
        t.name.includes('category') ||
        t.description?.toLowerCase().includes('prompt') ||
        t.description?.toLowerCase().includes('category')
      );
      
      console.log(`\n📝 Prompt Management Tools (${promptTools.length}):`);
      promptTools.forEach(tool => {
        console.log(`- ${tool.name}: ${tool.description}`);
      });
      
    } else {
      console.log('❌ No tools found or error in response');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

checkTools();