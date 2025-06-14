#!/usr/bin/env node

/**
 * Test that exactly mimics OpenAI's request format
 */

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeOpenAIRequest() {
  return new Promise((resolve, reject) => {
    const url = new URL('/mcp', RAILWAY_URL);
    
    // Exact headers from OpenAI logs
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'host': 'claude-prompts-mcp-production-0a79.up.railway.app',
        'user-agent': 'openai-mcp/1.0.0',
        'accept': 'text/event-stream',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'authorization': `Bearer ${TEST_API_KEY}`,
        'cache-control': 'no-store',
        'content-type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    };

    // Exact body from OpenAI logs
    const body = {
      "method": "initialize",
      "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {
          "name": "openai-mcp",
          "version": "1.0.0"
        }
      },
      "jsonrpc": "2.0",
      "id": 0
    };

    console.log('🚀 Making OpenAI-style request...');
    console.log('📡 URL:', `${RAILWAY_URL}/mcp`);
    console.log('🔑 Auth: Bearer', TEST_API_KEY.substring(0, 20) + '...');
    console.log('📋 Accept: text/event-stream');
    console.log('📦 Body:', JSON.stringify(body, null, 2));
    console.log('⏱️  Timeout: 10 seconds');
    console.log('=' .repeat(60));

    const req = https.request(options, (res) => {
      console.log(`📊 Status: ${res.statusCode}`);
      console.log(`📋 Headers:`, res.headers);
      
      let data = '';
      let chunks = 0;
      
      res.on('data', (chunk) => {
        chunks++;
        data += chunk;
        console.log(`📦 Chunk ${chunks} received (${chunk.length} bytes)`);
        console.log(`📄 Chunk content:`, chunk.toString());
      });
      
      res.on('end', () => {
        console.log(`✅ Response complete (${chunks} chunks, ${data.length} total bytes)`);
        console.log(`📄 Full response:`, data);
        resolve({ 
          status: res.statusCode, 
          headers: res.headers, 
          body: data,
          chunks: chunks
        });
      });
    });

    req.on('error', (err) => {
      console.log(`❌ Request error:`, err.message);
      reject(err);
    });

    req.on('timeout', () => {
      console.log(`⏰ Request timed out after 10 seconds`);
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
    
    console.log(`📤 Request sent at ${new Date().toISOString()}`);
  });
}

async function testOpenAIExact() {
  console.log('🧪 Testing exact OpenAI request format');
  console.log('🎯 This should reproduce the hanging issue');
  console.log('');
  
  try {
    const result = await makeOpenAIRequest();
    console.log('');
    console.log('🎉 SUCCESS! Request completed');
    console.log(`📊 Status: ${result.status}`);
    console.log(`📦 Chunks received: ${result.chunks}`);
    console.log(`📄 Response length: ${result.body.length} bytes`);
    
    if (result.status === 200 && result.body.length > 0) {
      console.log('✅ OpenAI hanging issue appears to be FIXED!');
    } else {
      console.log('⚠️  Unexpected response - check server logs');
    }
    
  } catch (error) {
    console.log('');
    console.log('❌ FAILED! This reproduces the hanging issue');
    console.log(`💥 Error: ${error.message}`);
    
    if (error.message === 'Request timeout') {
      console.log('🔍 This confirms OpenAI is hanging - check server logs for where it stops');
    }
  }
}

// Run the test
testOpenAIExact().catch(console.error);