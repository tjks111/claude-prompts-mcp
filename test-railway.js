#!/usr/bin/env node

/**
 * Remote test script for Railway deployment
 */

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeRequest(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RAILWAY_URL);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'openai-mcp/1.0.0',
        ...headers
      }
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
            headers: res.headers, 
            body: parsed,
            rawBody: data
          });
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            headers: res.headers, 
            body: data,
            rawBody: data,
            parseError: e.message
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testRailwayDeployment() {
  console.log('🚀 Testing Railway MCP Server Deployment');
  console.log(`📡 Server URL: ${RAILWAY_URL}`);
  console.log(`🔑 Test API Key: ${TEST_API_KEY.substring(0, 20)}...`);
  console.log('=' .repeat(60));

  const tests = [
    {
      name: 'Health Check (GET /health)',
      test: async () => {
        return await makeRequest('/health');
      }
    },
    {
      name: 'GET /mcp without auth',
      test: async () => {
        return await makeRequest('/mcp');
      }
    },
    {
      name: 'GET /mcp with API key',
      test: async () => {
        return await makeRequest('/mcp', 'GET', {
          'Authorization': `Bearer ${TEST_API_KEY}`
        });
      }
    },
    {
      name: 'POST /mcp initialize without auth',
      test: async () => {
        return await makeRequest('/mcp', 'POST', {}, {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" }
          },
          id: 1
        });
      }
    },
    {
      name: 'POST /mcp initialize with API key (OpenAI simulation)',
      test: async () => {
        return await makeRequest('/mcp', 'POST', {
          'Authorization': `Bearer ${TEST_API_KEY}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-store'
        }, {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "openai-mcp", version: "1.0.0" }
          },
          id: 1
        });
      }
    },
    {
      name: 'POST /mcp prompts/list with API key',
      test: async () => {
        return await makeRequest('/mcp', 'POST', {
          'Authorization': `Bearer ${TEST_API_KEY}`
        }, {
          jsonrpc: "2.0",
          method: "prompts/list",
          params: {},
          id: 2
        });
      }
    },
    {
      name: 'POST /mcp with invalid API key',
      test: async () => {
        return await makeRequest('/mcp', 'POST', {
          'Authorization': `Bearer invalid-key-12345`
        }, {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" }
          },
          id: 1
        });
      }
    }
  ];

  for (const test of tests) {
    console.log(`\n🧪 ${test.name}`);
    console.log('-'.repeat(40));
    
    try {
      const result = await test.test();
      
      console.log(`Status: ${result.status}`);
      
      if (result.parseError) {
        console.log(`Parse Error: ${result.parseError}`);
        console.log(`Raw Response: ${result.rawBody.substring(0, 500)}${result.rawBody.length > 500 ? '...' : ''}`);
      } else {
        console.log(`Response: ${JSON.stringify(result.body, null, 2)}`);
      }
      
      // Analysis
      if (result.status === 200) {
        console.log('✅ SUCCESS');
      } else if (result.status === 401) {
        console.log('🔒 UNAUTHORIZED (expected if auth is enabled)');
      } else if (result.status === 404) {
        console.log('❌ NOT FOUND');
      } else {
        console.log(`⚠️  UNEXPECTED STATUS: ${result.status}`);
      }
      
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 Railway deployment tests completed');
  console.log('\n📋 Analysis:');
  console.log('- If auth is DISABLED: All requests should return 200');
  console.log('- If auth is ENABLED: Requests without auth should return 401');
  console.log('- If auth is ENABLED: Requests with valid API key should return 200');
  console.log('- Initialize requests should return MCP protocol response');
}

// Run tests
testRailwayDeployment().catch(console.error);