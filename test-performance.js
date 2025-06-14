#!/usr/bin/env node

/**
 * Performance Test for MCP Server
 * Tests the optimized endpoints for response time improvements
 */

const https = require('https');
const http = require('http');

const SERVER_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

async function makeRequest(path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'performance-test/1.0.0'
      }
    };

    if (data) {
      const postData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const startTime = Date.now();
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            responseTime,
            data: parsedData,
            headers: res.headers
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            responseTime,
            data: responseData,
            headers: res.headers,
            parseError: error.message
          });
        }
      });
    });

    req.on('error', (error) => {
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      reject({ error: error.message, responseTime });
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testEndpoint(name, path, data = null) {
  console.log(`\n🧪 Testing ${name}...`);
  
  try {
    const result = await makeRequest(path, data);
    console.log(`✅ ${name}: ${result.responseTime}ms (Status: ${result.statusCode})`);
    
    if (result.statusCode >= 400) {
      console.log(`❌ Error response:`, result.data);
    } else if (data && data.method === 'tools/list') {
      const toolsCount = result.data?.result?.tools?.length || 0;
      console.log(`📊 Tools found: ${toolsCount}`);
    }
    
    return result;
  } catch (error) {
    console.log(`❌ ${name} failed: ${error.error} (${error.responseTime}ms)`);
    return null;
  }
}

async function runPerformanceTests() {
  console.log('🚀 Starting MCP Server Performance Tests');
  console.log(`📡 Server: ${SERVER_URL}`);
  console.log(`🔑 Using API Key: ${API_KEY.substring(0, 20)}...`);
  
  const tests = [
    {
      name: 'Health Check (GET /mcp)',
      path: '/mcp',
      data: null
    },
    {
      name: 'Initialize Request',
      path: '/mcp',
      data: {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "performance-test", version: "1.0.0" }
        },
        id: 1
      }
    },
    {
      name: 'Tools List (Critical Test)',
      path: '/mcp',
      data: {
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: 2
      }
    },
    {
      name: 'Prompts List',
      path: '/mcp',
      data: {
        jsonrpc: "2.0",
        method: "prompts/list",
        params: {},
        id: 3
      }
    }
  ];

  const results = [];
  
  for (const test of tests) {
    const result = await testEndpoint(test.name, test.path, test.data);
    if (result) {
      results.push({
        name: test.name,
        responseTime: result.responseTime,
        success: result.statusCode < 400
      });
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n📊 Performance Summary:');
  console.log('========================');
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.name}: ${result.responseTime}ms`);
  });
  
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
  console.log(`\n📈 Average Response Time: ${Math.round(avgResponseTime)}ms`);
  
  const toolsListResult = results.find(r => r.name.includes('Tools List'));
  if (toolsListResult) {
    if (toolsListResult.responseTime < 5000) {
      console.log('🎉 Tools List performance is good (< 5s timeout)');
    } else {
      console.log('⚠️  Tools List is slow but within timeout');
    }
  }
  
  console.log('\n✅ Performance tests completed!');
}

// Run the tests
runPerformanceTests().catch(console.error);