#!/usr/bin/env node

/**
 * Test tools with SSE format (like OpenAI)
 */

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeSSERequest(method, params = {}, id = 1) {
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
        'Accept': 'text/event-stream',  // This is what OpenAI sends
        'User-Agent': 'openai-mcp/1.0.0',
        'Cache-Control': 'no-store'
      },
      timeout: 15000
    };

    const body = {
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: id
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          // Parse SSE format: "data: {json}\n\n"
          if (data.startsWith('data: ')) {
            const jsonStr = data.replace(/^data: /, '').replace(/\n\n$/, '');
            const parsed = JSON.parse(jsonStr);
            resolve({ 
              status: res.statusCode, 
              body: parsed,
              format: 'SSE',
              contentType: res.headers['content-type']
            });
          } else {
            // Try regular JSON
            const parsed = JSON.parse(data);
            resolve({ 
              status: res.statusCode, 
              body: parsed,
              format: 'JSON',
              contentType: res.headers['content-type']
            });
          }
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            body: data,
            parseError: e.message,
            format: 'RAW',
            contentType: res.headers['content-type']
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

async function testToolsWithSSE() {
  console.log('🧪 Testing MCP Tools with SSE Format (OpenAI style)');
  console.log(`📡 Server: ${RAILWAY_URL}`);
  console.log('=' .repeat(60));

  const tests = [
    {
      name: 'Tools List (SSE)',
      method: 'tools/list',
      params: {}
    },
    {
      name: 'Prompts List (SSE)',
      method: 'prompts/list', 
      params: {}
    },
    {
      name: 'Tool Call - explain_concept (SSE)',
      method: 'tools/call',
      params: {
        name: 'process_slash_command',
        arguments: {
          command: '>>explain_concept concept="Python functions" level="junior dev"'
        }
      }
    },
    {
      name: 'Tool Call - listprompts (SSE)',
      method: 'tools/call',
      params: {
        name: 'listprompts',
        arguments: {
          command: '>>listprompts'
        }
      }
    }
  ];

  for (const test of tests) {
    console.log(`\n🔧 ${test.name}`);
    console.log('-'.repeat(40));
    
    try {
      const result = await makeSSERequest(test.method, test.params, Math.floor(Math.random() * 1000));
      
      console.log(`Status: ${result.status}`);
      console.log(`Format: ${result.format}`);
      console.log(`Content-Type: ${result.contentType}`);
      
      if (result.parseError) {
        console.log(`❌ Parse Error: ${result.parseError}`);
        console.log(`Raw Response: ${result.body.substring(0, 300)}...`);
      } else if (result.body.error) {
        console.log(`❌ MCP Error: ${result.body.error.message || result.body.error}`);
        console.log(`Error Code: ${result.body.error.code || 'unknown'}`);
      } else if (result.body.result) {
        console.log(`✅ Success!`);
        
        // Show relevant parts of the response
        if (test.method === 'tools/list') {
          const tools = result.body.result.tools || [];
          console.log(`Found ${tools.length} tools:`);
          tools.forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description || 'No description'}`);
          });
        } else if (test.method === 'prompts/list') {
          const prompts = result.body.result.prompts || [];
          console.log(`Found ${prompts.length} prompts:`);
          prompts.slice(0, 3).forEach(prompt => {
            console.log(`  - ${prompt.name}`);
          });
          if (prompts.length > 3) {
            console.log(`  ... and ${prompts.length - 3} more`);
          }
        } else if (test.method === 'tools/call') {
          const content = result.body.result.content || [];
          console.log(`Tool returned ${content.length} content items:`);
          content.forEach((item, i) => {
            if (item.type === 'text') {
              console.log(`  ${i + 1}. Text: ${item.text?.substring(0, 150)}...`);
            } else {
              console.log(`  ${i + 1}. ${item.type}: ${JSON.stringify(item).substring(0, 100)}...`);
            }
          });
        }
      } else {
        console.log(`⚠️  Unexpected response format`);
        console.log(`Response: ${JSON.stringify(result.body, null, 2).substring(0, 300)}...`);
      }
      
    } catch (error) {
      console.log(`❌ Request Error: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 SSE Tool testing completed');
  console.log('\n📋 Key Points:');
  console.log('- All requests use Accept: text/event-stream header');
  console.log('- Server should respond with Content-Type: text/event-stream');
  console.log('- Response format should be: "data: {json}\\n\\n"');
  console.log('- This matches exactly what OpenAI MCP client expects');
}

// Run tests
testToolsWithSSE().catch(console.error);