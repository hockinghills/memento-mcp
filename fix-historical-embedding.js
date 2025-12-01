#!/usr/bin/env node

/**
 * Fix historical entity embedding with wrong dimensions
 */

import { config } from 'dotenv';
import { initializeStorageProvider } from './dist/config/storage.js';
import { EmbeddingServiceFactory } from './dist/embeddings/EmbeddingServiceFactory.js';
import neo4j from 'neo4j-driver';

// Load environment variables
config();

async function fixHistoricalEmbedding() {
  console.log('=== Fix Historical Entity Embedding ===\n');

  const entityId = 'af485660-bd67-48e4-85ec-02c62014c86c';
  const entityName = 'ESP32-S3 Annealer CT Monitoring';

  try {
    // Initialize storage
    console.log('Initializing storage provider...');
    const storageProvider = initializeStorageProvider();
    console.log('  ✓ Storage provider initialized\n');

    // Create embedding service
    console.log('Creating embedding service...');
    const embeddingService = EmbeddingServiceFactory.createFromEnvironment();
    const modelInfo = embeddingService.getModelInfo();
    console.log('  Model:', modelInfo.name);
    console.log('  Expected dimensions:', modelInfo.dimensions);
    console.log('  ✓ Embedding service created\n');

    // Get the historical entity by ID
    console.log(`Getting historical entity (ID: ${entityId})...`);
    const driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
    );
    const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });

    try {
      const result = await session.run(
        'MATCH (e:Entity {id: $id}) RETURN e',
        { id: entityId }
      );

      if (result.records.length === 0) {
        console.log('  ✗ Entity not found');
        return;
      }

      const entity = result.records[0].get('e').properties;
      console.log('  ✓ Found entity:');
      console.log(`    Name: ${entity.name}`);
      console.log(`    Version: ${entity.version}`);
      console.log(`    Current embedding dimensions: ${entity.embedding ? entity.embedding.length : 'none'}`);
      console.log();

      // Generate embedding text from entity
      const embeddingText = [
        entity.name,
        entity.entityType,
        ...(entity.observations || [])
      ].join(' ');

      console.log('  Generating new embedding...');
      const newEmbedding = await embeddingService.generateEmbedding(embeddingText);
      console.log(`  ✓ Generated ${newEmbedding.length}-dimension embedding\n`);

      // Update the embedding directly via Cypher
      console.log('  Updating entity embedding in database...');
      await session.run(
        `MATCH (e:Entity {id: $id})
         SET e.embedding = $embedding
         RETURN e`,
        {
          id: entityId,
          embedding: newEmbedding
        }
      );
      console.log('  ✓ Embedding updated successfully\n');

      // Verify the update
      const verifyResult = await session.run(
        'MATCH (e:Entity {id: $id}) RETURN size(e.embedding) as dimensions',
        { id: entityId }
      );
      const newDimensions = verifyResult.records[0].get('dimensions');
      console.log('  Verification:');
      console.log(`    New embedding dimensions: ${newDimensions}`);

      if (newDimensions === modelInfo.dimensions) {
        console.log('    ✓ DIMENSION MATCH - Fix successful!\n');
      } else {
        console.log('    ✗ DIMENSION MISMATCH - Something went wrong\n');
      }

    } finally {
      await session.close();
      await driver.close();
    }

    console.log('=== FIX COMPLETED ===');

  } catch (error) {
    console.error('\n=== FIX FAILED ===');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

fixHistoricalEmbedding().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
