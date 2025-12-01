#!/usr/bin/env node
import { Neo4jStorageProvider } from './src/storage/neo4j/Neo4jStorageProvider.js';
import dotenv from 'dotenv';

dotenv.config();

async function testEntityLookup() {
  const provider = new Neo4jStorageProvider();

  try {
    console.log('\n=== Testing Entity Lookup Fix ===\n');

    // Step 1: Find entities without embeddings
    console.log('Step 1: Finding entities without embeddings...');
    const result = await provider.findEntitiesWithoutEmbeddings(5);

    if ('samples' in result && Array.isArray(result.samples) && result.samples.length > 0) {
      console.log(`Found ${result.samples.length} entities without embeddings:`);
      result.samples.forEach((sample: any) => {
        console.log(`  - ${sample.name} (${sample.entityType}) - ID: ${sample.id}`);
      });

      // Step 2: Try to look up the first entity by ID
      const firstSample = result.samples[0];
      console.log(`\nStep 2: Looking up entity by ID: ${firstSample.id}`);

      const entity = await provider.getEntityById(firstSample.id);

      if (entity) {
        console.log('✅ SUCCESS! Entity found:');
        console.log(`   Name: ${entity.name}`);
        console.log(`   Type: ${entity.entityType}`);
        console.log(`   ID: ${entity.id}`);
      } else {
        console.log('❌ FAILED: Entity not found');
      }
    } else {
      console.log('No entities without embeddings found (or error occurred)');
      console.log('Result:', result);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await provider.close();
  }
}

testEntityLookup();
