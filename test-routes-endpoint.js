#!/usr/bin/env node

/**
 * Test script for the new /routes endpoint
 * This tests the specific endpoint that MCP clients are looking for
 */

const SERVER_URL = "https://claude-prompts-mcp-production-0a79.up.railway.app";

async function testRoutesEndpoint() {
  console.log("🧪 Testing /routes endpoint for MCP client discovery\n");

  try {
    // Test GET /routes
    console.log("1️⃣ Testing GET /routes...");
    const response = await fetch(`${SERVER_URL}/routes`);
    
    if (response.ok) {
      const data = await response.json();
      console.log("   ✅ GET /routes:", response.status);
      console.log("   📋 Routes discovered:", Object.keys(data.routes || {}).join(", "));
      console.log("   🚀 Transports:", (data.transports || []).join(", "));
      console.log("   📦 Server version:", data.serverInfo?.version || "unknown");
    } else {
      console.log("   ❌ GET /routes:", response.status, response.statusText);
    }

    // Test OPTIONS /routes (CORS preflight)
    console.log("\n2️⃣ Testing OPTIONS /routes (CORS preflight)...");
    const optionsResponse = await fetch(`${SERVER_URL}/routes`, { method: 'OPTIONS' });
    
    if (optionsResponse.ok) {
      console.log("   ✅ OPTIONS /routes:", optionsResponse.status);
      console.log("   🌐 CORS Origin:", optionsResponse.headers.get('Access-Control-Allow-Origin'));
      console.log("   📝 CORS Methods:", optionsResponse.headers.get('Access-Control-Allow-Methods'));
    } else {
      console.log("   ❌ OPTIONS /routes:", optionsResponse.status, optionsResponse.statusText);
    }

    // Test POST /routes (MCP requests)
    console.log("\n3️⃣ Testing POST /routes (MCP initialize)...");
    const mcpRequest = {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      },
      id: 1
    };

    const postResponse = await fetch(`${SERVER_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequest)
    });

    if (postResponse.ok) {
      const mcpData = await postResponse.json();
      console.log("   ✅ POST /routes (MCP):", postResponse.status);
      console.log("   🔧 MCP Protocol:", mcpData.result?.protocolVersion || "unknown");
      console.log("   📊 Tools available:", mcpData.result?.capabilities?.tools ? "Yes" : "No");
    } else {
      console.log("   ❌ POST /routes (MCP):", postResponse.status, postResponse.statusText);
    }

  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

// Run the test
testRoutesEndpoint();