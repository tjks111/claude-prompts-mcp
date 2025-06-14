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

async function testPromptCreation() {
  console.log('🧪 Testing Prompt Creation and Management\n');
  
  // Test 1: List existing prompts
  console.log('1. 📋 Listing existing prompts...');
  try {
    const listResult = await makeToolCall('listprompts', {});
    
    if (listResult.result && listResult.result.content) {
      const content = listResult.result.content[0].text;
      const lines = content.split('\n');
      const promptCount = lines.filter(line => line.includes('###')).length;
      console.log(`✅ Found ${promptCount} existing prompts`);
    } else {
      console.log('❌ Failed to list prompts');
      console.log(JSON.stringify(listResult, null, 2));
    }
  } catch (error) {
    console.log(`❌ Error listing prompts: ${error.message}`);
  }
  
  // Test 2: Create a new prompt
  console.log('\n2. ➕ Creating a new test prompt...');
  try {
    const createResult = await makeToolCall('update_prompt', {
      id: 'test_prompt_' + Date.now(),
      name: 'Test Prompt',
      category: 'education',
      description: 'A test prompt for demonstration purposes',
      systemMessage: 'You are a helpful assistant that explains things clearly.',
      userMessageTemplate: 'Please explain {{topic}} in simple terms for a {{audience}} audience.',
      arguments: [
        {
          name: 'topic',
          description: 'The topic to explain',
          required: true
        },
        {
          name: 'audience',
          description: 'The target audience (e.g., beginner, intermediate, expert)',
          required: false
        }
      ]
    });
    
    if (createResult.result && createResult.result.content) {
      const content = createResult.result.content[0].text;
      console.log(`✅ ${content}`);
    } else {
      console.log('❌ Failed to create prompt');
      console.log(JSON.stringify(createResult, null, 2));
    }
  } catch (error) {
    console.log(`❌ Error creating prompt: ${error.message}`);
  }
  
  // Test 3: Test the new prompt
  console.log('\n3. 🧪 Testing the new prompt...');
  try {
    const testResult = await makeToolCall('process_slash_command', {
      command: '>>test_prompt_' + Math.floor(Date.now() / 1000) + ' topic="Machine Learning" audience="beginner"'
    });
    
    if (testResult.result && testResult.result.content) {
      const content = testResult.result.content[0].text;
      console.log(`✅ Prompt executed successfully`);
      console.log(`📄 Response preview: ${content.substring(0, 200)}...`);
    } else {
      console.log('❌ Failed to execute prompt');
      console.log(JSON.stringify(testResult, null, 2));
    }
  } catch (error) {
    console.log(`❌ Error testing prompt: ${error.message}`);
  }
  
  // Test 4: Show categories
  console.log('\n4. 📂 Available categories:');
  const categories = [
    'general', 'code', 'analysis', 'education', 'development', 
    'research', 'research-tools', 'documentation', 'examples', 
    'creative-tools', 'creative'
  ];
  
  categories.forEach(cat => {
    console.log(`   - ${cat}`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('📝 PROMPT MANAGEMENT CAPABILITIES SUMMARY:');
  console.log('✅ Create new prompts with update_prompt tool');
  console.log('✅ Organize prompts into categories');
  console.log('✅ Define prompt arguments and templates');
  console.log('✅ Support for system and user message templates');
  console.log('✅ Advanced Nunjucks templating (conditionals, loops, etc.)');
  console.log('✅ Chain prompts for multi-step workflows');
  console.log('✅ Delete prompts with delete_prompt tool');
  console.log('✅ Modify prompt sections with modify_prompt_section tool');
  console.log('✅ Reload prompts with reload_prompts tool');
  console.log('✅ List all prompts with listprompts tool');
  console.log('='.repeat(60));
}

testPromptCreation();