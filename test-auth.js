#!/usr/bin/env node

/**
 * Test script for authentication functionality
 */

const http = require('http');
const https = require('https');

const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';
const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:8080';

function makeRequest(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'test-auth-script/1.0.0',
        ...headers
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
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

async function testAuthentication() {
  console.log('🧪 Testing MCP Server Authentication');
  console.log(`📡 Server URL: ${SERVER_URL}`);
  console.log(`🔑 Test API Key: ${TEST_API_KEY.substring(0, 20)}...`);
  console.log('');

  // Test 1: GET /mcp without authentication
  console.log('Test 1: GET /mcp without authentication');
  try {
    const response = await makeRequest('/mcp');
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.body, null, 2)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  console.log('');

  // Test 2: GET /mcp with API key
  console.log('Test 2: GET /mcp with API key');
  try {
    const response = await makeRequest('/mcp', 'GET', {
      'Authorization': `Bearer ${TEST_API_KEY}`
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.body, null, 2)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  console.log('');

  // Test 3: POST /mcp with API key (initialize request)
  console.log('Test 3: POST /mcp with API key (initialize request)');
  try {
    const response = await makeRequest('/mcp', 'POST', {
      'Authorization': `Bearer ${TEST_API_KEY}`
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
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.body, null, 2)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  console.log('');

  // Test 4: POST /mcp without authentication
  console.log('Test 4: POST /mcp without authentication');
  try {
    const response = await makeRequest('/mcp', 'POST', {}, {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      },
      id: 1
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.body, null, 2)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  console.log('');

  console.log('🏁 Authentication tests completed');
}

// Run tests
testAuthentication().catch(console.error);