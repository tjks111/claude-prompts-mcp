#!/usr/bin/env node

const https = require('https');

const RAILWAY_URL = 'https://claude-prompts-mcp-production-0a79.up.railway.app';
const TEST_API_KEY = 'mcp-key-7f9a2b8c4e6d1a3f5b9c8e2d4a7f1b6c9e3a5d8f2b7c4e9a1d6f3b8c5e2a7f4d';

function makeToolCall(toolName, args) {
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
      timeout: 15000
    };

    const body = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      },
      id: Math.floor(Math.random() * 1000)
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

async function testNewPrompt() {
  console.log('🔄 Testing newly created prompt...\n');
  
  // First reload prompts
  console.log('1. 🔄 Reloading prompts...');
  try {
    const reloadResult = await makeToolCall('reload_prompts', {});
    if (reloadResult.result && reloadResult.result.content) {
      console.log(`✅ ${reloadResult.result.content[0].text}`);
    }
  } catch (error) {
    console.log(`❌ Error reloading: ${error.message}`);
  }
  
  // List prompts to see the new one
  console.log('\n2. 📋 Checking if new prompt is available...');
  try {
    const listResult = await makeToolCall('listprompts', {});
    if (listResult.result && listResult.result.content) {
      const content = listResult.result.content[0].text;
      const hasTestPrompt = content.includes('test_prompt_');
      console.log(`✅ New test prompt ${hasTestPrompt ? 'found' : 'not found'} in list`);
      
      // Extract the test prompt name
      const lines = content.split('\n');
      const testPromptLine = lines.find(line => line.includes('test_prompt_'));
      if (testPromptLine) {
        const match = testPromptLine.match(/\/(\w+)/);
        if (match) {
          const promptName = match[1];
          console.log(`📝 Found prompt: ${promptName}`);
          
          // Test the prompt
          console.log('\n3. 🧪 Testing the new prompt...');
          const testResult = await makeToolCall('process_slash_command', {
            command: `>>${promptName} topic="Machine Learning" audience="beginner"`
          });
          
          if (testResult.result && testResult.result.content) {
            const content = testResult.result.content[0].text;
            console.log(`✅ Prompt executed successfully!`);
            console.log(`📄 Response: ${content.substring(0, 300)}...`);
          } else {
            console.log('❌ Failed to execute prompt');
            console.log(JSON.stringify(testResult, null, 2));
          }
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

testNewPrompt();