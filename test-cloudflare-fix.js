#!/usr/bin/env node

/**
 * Test script to verify Cloudflare AI playground connection fixes
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';

console.log('🧪 Testing Cloudflare AI Playground Connection Fixes\n');

// Test 1: HTTP Transport (POST /mcp)
async function testHttpTransport() {
  console.log('1️⃣ Testing HTTP Transport...');
  
  const data = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 1
  });

  const options = {
    hostname: 'claude-prompts-mcp-production-0a79.up.railway.app',
    port: 443,
    path: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'Accept': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        try {
          const parsed = JSON.parse(responseData);
          if (parsed.result && parsed.result.tools && Array.isArray(parsed.result.tools)) {
            console.log(`   ✅ HTTP Transport: ${duration}ms (${parsed.result.tools.length} tools)`);
            resolve({ success: true, duration, toolCount: parsed.result.tools.length });
          } else {
            console.log(`   ❌ HTTP Transport: Invalid response format - ${JSON.stringify(parsed).substring(0, 100)}...`);
            resolve({ success: false, error: 'Invalid response format' });
          }
        } catch (error) {
          console.log(`   ❌ HTTP Transport: JSON parse error - ${error.message}`);
          resolve({ success: false, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ HTTP Transport: Request error - ${error.message}`);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(30000, () => {
      console.log(`   ❌ HTTP Transport: Timeout after 30s`);
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });

    req.write(data);
    req.end();
  });
}

// Test 2: SSE Transport (GET /sse)
async function testSSETransport() {
  console.log('2️⃣ Testing SSE Transport...');
  
  const options = {
    hostname: 'claude-prompts-mcp-production-0a79.up.railway.app',
    port: 443,
    path: '/sse',
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let connectionReceived = false;
    
    const req = https.request(options, (res) => {
      const contentType = res.headers['content-type'];
      
      if (contentType !== 'text/event-stream') {
        console.log(`   ❌ SSE Transport: Wrong content-type '${contentType}', expected 'text/event-stream'`);
        resolve({ success: false, error: `Wrong content-type: ${contentType}` });
        return;
      }
      
      res.on('data', (chunk) => {
        const data = chunk.toString();
        if (data.includes('"type":"connection"') && !connectionReceived) {
          connectionReceived = true;
          const endTime = Date.now();
          const duration = endTime - startTime;
          console.log(`   ✅ SSE Transport: ${duration}ms (Connection established)`);
          req.destroy(); // Close connection after successful test
          resolve({ success: true, duration, contentType });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ SSE Transport: Request error - ${error.message}`);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(10000, () => {
      console.log(`   ❌ SSE Transport: Timeout after 10s`);
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });

    req.end();
  });
}

// Test 3: CORS Headers
async function testCORSHeaders() {
  console.log('3️⃣ Testing CORS Headers...');
  
  const options = {
    hostname: 'claude-prompts-mcp-production-0a79.up.railway.app',
    port: 443,
    path: '/sse',
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://playground.cloudflare.ai',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const corsOrigin = res.headers['access-control-allow-origin'];
      const corsMethods = res.headers['access-control-allow-methods'];
      const corsHeaders = res.headers['access-control-allow-headers'];
      
      if (corsOrigin === '*' && corsMethods && corsHeaders) {
        console.log(`   ✅ CORS Headers: Origin=${corsOrigin}, Methods=${corsMethods}`);
        resolve({ success: true, corsOrigin, corsMethods, corsHeaders });
      } else {
        console.log(`   ❌ CORS Headers: Missing or invalid CORS headers`);
        resolve({ success: false, error: 'Invalid CORS headers' });
      }
    });

    req.on('error', (error) => {
      console.log(`   ❌ CORS Headers: Request error - ${error.message}`);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(5000, () => {
      console.log(`   ❌ CORS Headers: Timeout after 5s`);
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });

    req.end();
  });
}

// Test 4: Server Info
async function testServerInfo() {
  console.log('4️⃣ Testing Server Info...');
  
  const options = {
    hostname: 'claude-prompts-mcp-production-0a79.up.railway.app',
    port: 443,
    path: '/mcp',
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (parsed.browserCompatible && parsed.endpoints && parsed.browserUsage) {
            console.log(`   ✅ Server Info: Browser compatible, version ${parsed.version}`);
            resolve({ success: true, info: parsed });
          } else {
            console.log(`   ❌ Server Info: Missing browser compatibility info`);
            resolve({ success: false, error: 'Missing browser compatibility' });
          }
        } catch (error) {
          console.log(`   ❌ Server Info: JSON parse error - ${error.message}`);
          resolve({ success: false, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ Server Info: Request error - ${error.message}`);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(5000, () => {
      console.log(`   ❌ Server Info: Timeout after 5s`);
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });

    req.end();
  });
}

// Run all tests
async function runTests() {
  const results = {
    http: await testHttpTransport(),
    sse: await testSSETransport(),
    cors: await testCORSHeaders(),
    info: await testServerInfo()
  };

  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  
  const allPassed = Object.values(results).every(r => r.success);
  
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED! Cloudflare AI playground should now work.');
    console.log('\n🔗 Connection URLs:');
    console.log('   HTTP: https://claude-prompts-mcp-production-0a79.up.railway.app/mcp');
    console.log('   SSE:  https://claude-prompts-mcp-production-0a79.up.railway.app/sse');
  } else {
    console.log('❌ Some tests failed. Check the issues above.');
  }
  
  console.log('\n📈 Performance:');
  if (results.http.success) {
    console.log(`   HTTP Response Time: ${results.http.duration}ms`);
  }
  if (results.sse.success) {
    console.log(`   SSE Connection Time: ${results.sse.duration}ms`);
  }
  
  return allPassed;
}

// Execute tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});