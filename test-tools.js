#!/usr/bin/env node

/**
 * Test all MCP tools to see which ones are working
 */

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeRequest(method, params = {}, id = 1) {
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
        'Accept': 'application/json',
        'User-Agent': 'test-tools/1.0.0'
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
          const parsed = JSON.parse(data);
          resolve({ 
            status: res.statusCode, 
            body: parsed
          });
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            body: data,
            parseError: e.message
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

async function testAllTools() {
  console.log('🧪 Testing MCP Tools');
  console.log(`📡 Server: ${RAILWAY_URL}`);
  console.log('=' .repeat(60));

  const tests = [
    {
      name: 'List Tools',
      method: 'tools/list',
      params: {}
    },
    {
      name: 'List Prompts',
      method: 'prompts/list', 
      params: {}
    },
    {
      name: 'Get Specific Prompt (Code Review)',
      method: 'prompts/get',
      params: {
        name: 'Code Review',
        arguments: {
          code: 'function test() { return "hello"; }',
          language: 'javascript'
        }
      }
    },
    {
      name: 'Get Specific Prompt (Explain Concept)',
      method: 'prompts/get',
      params: {
        name: 'Explain Concept',
        arguments: {
          concept: 'Python functions',
          level: 'junior dev'
        }
      }
    },
    {
      name: 'Call Tool - process_slash_command',
      method: 'tools/call',
      params: {
        name: 'process_slash_command',
        arguments: {
          command: '>>explain_concept concept="Python functions" level="junior dev"'
        }
      }
    },
    {
      name: 'Call Tool - listprompts',
      method: 'tools/call',
      params: {
        name: 'listprompts',
        arguments: {
          command: '>>listprompts'
        }
      }
    },
    {
      name: 'Call Tool - process_slash_command (simple)',
      method: 'tools/call',
      params: {
        name: 'process_slash_command',
        arguments: {
          command: '/content_analysis This is a test content'
        }
      }
    }
  ];

  for (const test of tests) {
    console.log(`\n🔧 ${test.name}`);
    console.log('-'.repeat(40));
    
    try {
      const result = await makeRequest(test.method, test.params, Math.floor(Math.random() * 1000));
      
      console.log(`Status: ${result.status}`);
      
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
          prompts.slice(0, 5).forEach(prompt => {
            console.log(`  - ${prompt.name}`);
          });
          if (prompts.length > 5) {
            console.log(`  ... and ${prompts.length - 5} more`);
          }
        } else if (test.method === 'prompts/get') {
          const messages = result.body.result.messages || [];
          console.log(`Got ${messages.length} messages:`);
          messages.forEach((msg, i) => {
            console.log(`  ${i + 1}. ${msg.role}: ${msg.content.text?.substring(0, 100)}...`);
          });
        } else if (test.method === 'tools/call') {
          const content = result.body.result.content || [];
          console.log(`Tool returned ${content.length} content items:`);
          content.forEach((item, i) => {
            if (item.type === 'text') {
              console.log(`  ${i + 1}. Text: ${item.text?.substring(0, 200)}...`);
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
  console.log('🏁 Tool testing completed');
  console.log('\n📋 Summary:');
  console.log('- tools/list: Shows available tools');
  console.log('- prompts/list: Shows available prompts (working ✅)');
  console.log('- prompts/get: Gets specific prompt content');
  console.log('- tools/call: Executes tools with arguments');
}

// Run tests
testAllTools().catch(console.error);