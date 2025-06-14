#!/usr/bin/env node

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeSSERequest(method, params = {}) {
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
        'Accept': 'text/event-stream',  // OpenAI format
        'User-Agent': 'openai-mcp/1.0.0',
        'Cache-Control': 'no-store'
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
          // Parse SSE format
          if (data.startsWith('data: ')) {
            const jsonStr = data.replace(/^data: /, '').replace(/\n\n$/, '');
            const parsed = JSON.parse(jsonStr);
            resolve({ 
              status: res.statusCode, 
              body: parsed,
              format: 'SSE',
              contentType: res.headers['content-type'],
              rawData: data
            });
          } else {
            const parsed = JSON.parse(data);
            resolve({ 
              status: res.statusCode, 
              body: parsed,
              format: 'JSON',
              contentType: res.headers['content-type'],
              rawData: data
            });
          }
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            parseError: e.message,
            rawData: data,
            contentType: res.headers['content-type']
          });
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

async function testPromptsSSE() {
  console.log('🧪 Testing Prompts with SSE Format (OpenAI style)\n');
  
  console.log('📋 Requesting prompts/list with SSE format...');
  try {
    const result = await makeSSERequest('prompts/list');
    
    console.log(`Status: ${result.status}`);
    console.log(`Format: ${result.format}`);
    console.log(`Content-Type: ${result.contentType}`);
    
    if (result.parseError) {
      console.log(`❌ Parse Error: ${result.parseError}`);
      console.log(`Raw Data: ${result.rawData.substring(0, 500)}...`);
    } else if (result.body.error) {
      console.log(`❌ MCP Error: ${result.body.error.message || result.body.error}`);
    } else if (result.body.result) {
      const prompts = result.body.result.prompts || [];
      console.log(`✅ Found ${prompts.length} prompts in SSE response`);
      
      if (prompts.length > 0) {
        console.log('\n📝 First 5 prompts:');
        prompts.slice(0, 5).forEach((prompt, i) => {
          console.log(`${i + 1}. ${prompt.name}`);
          console.log(`   Description: ${prompt.description || 'No description'}`);
          if (prompt.arguments && prompt.arguments.length > 0) {
            console.log(`   Arguments: ${prompt.arguments.map(arg => arg.name).join(', ')}`);
          }
          console.log('');
        });
        
        if (prompts.length > 5) {
          console.log(`... and ${prompts.length - 5} more prompts`);
        }
      } else {
        console.log('❌ No prompts found in response');
      }
    } else {
      console.log('❌ Unexpected response format');
      console.log(JSON.stringify(result.body, null, 2));
    }
    
  } catch (error) {
    console.log(`❌ Request Error: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('🔍 DIAGNOSIS:');
  console.log('If prompts are found here but OpenAI shows 0, it could be:');
  console.log('1. OpenAI client caching issue - try refreshing');
  console.log('2. Prompt format compatibility issue');
  console.log('3. Missing required fields in prompt definitions');
  console.log('4. OpenAI client expecting different prompt structure');
  console.log('='.repeat(60));
}

testPromptsSSE();