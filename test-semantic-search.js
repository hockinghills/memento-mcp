#!/usr/bin/env node

/**
 * Test semantic search to diagnose dimension mismatch
 */

import { config } from 'dotenv';
import { initializeStorageProvider } from './dist/config/storage.js';
import { EmbeddingServiceFactory } from './dist/embeddings/EmbeddingServiceFactory.js';
import { KnowledgeGraphManager } from './dist/KnowledgeGraphManager.js';
import { EmbeddingJobManager } from './dist/embeddings/EmbeddingJobManager.js';

// Load environment variables
config();

async function testSemanticSearch() {
  console.log('=== Semantic Search Diagnostic ===\n');

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
    console.log('  Dimensions:', modelInfo.dimensions);
    console.log('  ✓ Embedding service created\n');

    // Create embedding job manager (simplified for test)
    console.log('Creating embedding job manager...');
    const adaptedStorageProvider = {
      ...storageProvider,
      db: { exec: () => null, prepare: () => ({ run: () => null, all: () => [], get: () => null }) },
      getEntity: async (name) => {
        if (typeof storageProvider.getEntity === 'function') {
          return storageProvider.getEntity(name);
        }
        const result = await storageProvider.openNodes([name]);
        return result.entities[0] || null;
      },
      storeEntityVector: async (name, embedding) => {
        const formattedEmbedding = {
          vector: embedding.vector || embedding,
          model: embedding.model || 'unknown',
          lastUpdated: embedding.lastUpdated || Date.now(),
        };
        if (typeof storageProvider.updateEntityEmbedding === 'function') {
          return await storageProvider.updateEntityEmbedding(name, formattedEmbedding);
        }
      },
    };

    const embeddingJobManager = new EmbeddingJobManager(
      adaptedStorageProvider,
      embeddingService,
      { tokensPerInterval: 20, interval: 60000 }
    );
    console.log('  ✓ Embedding job manager created\n');

    // Create knowledge graph manager
    console.log('Creating knowledge graph manager...');
    const knowledgeGraphManager = new KnowledgeGraphManager({
      storageProvider,
      embeddingJobManager,
      vectorStoreOptions: storageProvider.vectorStoreOptions,
    });
    console.log('  ✓ Knowledge graph manager created\n');

    // Test semantic search
    console.log('Testing semantic search with query: "test search"...');
    const query = 'test search';

    // Generate embedding first to check dimensions
    console.log('\n1. Generating embedding for query...');
    const queryEmbedding = await embeddingService.generateEmbedding(query);
    console.log(`   Query embedding dimensions: ${queryEmbedding.length}`);
    console.log(`   First 3 values: [${queryEmbedding.slice(0, 3).join(', ')}]`);

    // Now try the actual semantic search
    console.log('\n2. Calling findSimilarEntities...');
    try {
      const results = await knowledgeGraphManager.findSimilarEntities(query, {
        limit: 5,
        threshold: 0.5,
        hybridSearch: false,
      });
      console.log('  ✓ Semantic search succeeded!');
      console.log(`  Found ${results.length} results:`);
      results.forEach((r, i) => {
        console.log(`    ${i + 1}. ${r.name} (score: ${r.score.toFixed(4)})`);
      });
    } catch (error) {
      console.error('  ✗ Semantic search failed!');
      console.error('  Error:', error.message);
      if (error.message.includes('dimension')) {
        console.error('\n  THIS IS THE DIMENSION MISMATCH ERROR!');
        console.error('  The error indicates that a vector with wrong dimensions was passed to Neo4j.');
      }
      throw error;
    }

  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

testSemanticSearch().then(() => {
  console.log('\n=== TEST COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}).catch((error) => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
