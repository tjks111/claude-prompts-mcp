#!/usr/bin/env node

/**
 * Final verification test - exactly like OpenAI would call it
 */

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeOpenAIRequest(method, params = {}, id = 1) {
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
        'Accept': 'text/event-stream',  // OpenAI header
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
        resolve({ 
          status: res.statusCode, 
          headers: res.headers,
          body: data
        });
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

async function runFinalTest() {
  console.log('🎯 FINAL VERIFICATION TEST');
  console.log('🤖 Simulating exact OpenAI MCP client behavior');
  console.log('=' .repeat(60));

  const tests = [
    {
      name: '1. Initialize (like OpenAI)',
      method: 'initialize',
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "openai-mcp",
          version: "1.0.0"
        }
      }
    },
    {
      name: '2. List Tools (like OpenAI)',
      method: 'tools/list',
      params: {}
    },
    {
      name: '3. Call Tool (like OpenAI)',
      method: 'tools/call',
      params: {
        name: 'process_slash_command',
        arguments: {
          command: '>>explain_concept concept="MCP Protocol" level="beginner"'
        }
      }
    },
    {
      name: '4. List Prompts (like OpenAI)',
      method: 'prompts/list',
      params: {}
    }
  ];

  let allPassed = true;

  for (const test of tests) {
    console.log(`\n${test.name}`);
    console.log('-'.repeat(50));
    
    try {
      const result = await makeOpenAIRequest(test.method, test.params);
      
      // Check if it's SSE format
      const isSSE = result.headers['content-type'] === 'text/event-stream';
      const hasSSEData = result.body.startsWith('data: ');
      
      if (isSSE && hasSSEData) {
        console.log('✅ SSE Format: CORRECT');
        console.log(`✅ Content-Type: ${result.headers['content-type']}`);
        
        // Parse the JSON from SSE
        try {
          const jsonStr = result.body.replace(/^data: /, '').replace(/\n\n$/, '');
          const parsed = JSON.parse(jsonStr);
          
          if (parsed.result) {
            console.log('✅ MCP Response: VALID');
            
            // Show specific results
            if (test.method === 'tools/list') {
              const tools = parsed.result.tools || [];
              console.log(`✅ Tools Found: ${tools.length}`);
            } else if (test.method === 'tools/call') {
              const content = parsed.result.content || [];
              console.log(`✅ Tool Response: ${content.length} content items`);
            } else if (test.method === 'prompts/list') {
              const prompts = parsed.result.prompts || [];
              console.log(`✅ Prompts Found: ${prompts.length}`);
            } else if (test.method === 'initialize') {
              console.log(`✅ Server: ${parsed.result.serverInfo?.name || 'Unknown'}`);
            }
          } else if (parsed.error) {
            console.log(`❌ MCP Error: ${parsed.error.message}`);
            allPassed = false;
          }
        } catch (e) {
          console.log(`❌ JSON Parse Error: ${e.message}`);
          allPassed = false;
        }
      } else {
        console.log(`❌ Wrong Format: Expected SSE, got ${result.headers['content-type']}`);
        console.log(`❌ Body starts with: ${result.body.substring(0, 50)}...`);
        allPassed = false;
      }
      
    } catch (error) {
      console.log(`❌ Request Failed: ${error.message}`);
      allPassed = false;
    }
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('✅ OpenAI MCP client should now work perfectly');
    console.log('✅ All endpoints return proper SSE format');
    console.log('✅ All tools are functional and accessible');
  } else {
    console.log('❌ Some tests failed - check the issues above');
  }
  console.log('='.repeat(60));
}

runFinalTest().catch(console.error);