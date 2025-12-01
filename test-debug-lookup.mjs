import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config();

async function testDebugEntityLookup() {
  console.log('=== Testing debug_entity_lookup tool ===\n');

  // Create MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(__dirname, 'dist', 'index.js')],
    env: {
      ...process.env,
      DEBUG: 'true', // Enable debug tools
    },
  });

  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  try {
    await client.connect(transport);
    console.log('✓ Connected to Memento MCP server\n');

    // First, get entities without embeddings to find a problematic ID
    console.log('Step 1: Finding entities without embeddings...');
    const findResult = await client.callTool({
      name: 'find_entities_without_embeddings',
      arguments: { limit: 5 },
    });

    console.log('Result:', JSON.stringify(findResult, null, 2));

    const findData = JSON.parse(findResult.content[0].text);

    if (findData.samples && findData.samples.length > 0) {
      const testEntityId = findData.samples[0].id;
      console.log(`\nStep 2: Running diagnostic lookup on entity ID: ${testEntityId}\n`);

      // Now run the debug lookup
      const debugResult = await client.callTool({
        name: 'debug_entity_lookup',
        arguments: { entity_id: testEntityId },
      });

      console.log('=== DEBUG LOOKUP RESULTS ===');
      console.log(JSON.stringify(JSON.parse(debugResult.content[0].text), null, 2));
    } else {
      console.log('No entities without embeddings found to test with.');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    await client.close();
    console.log('\n✓ Disconnected from server');
  }
}

testDebugEntityLookup().catch(console.error);
