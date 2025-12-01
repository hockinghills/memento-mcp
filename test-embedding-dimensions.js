#!/usr/bin/env node

/**
 * Diagnostic script to test embedding dimensions
 * This will verify what dimensions the embedding service is actually generating
 */

import { config } from 'dotenv';
import { EmbeddingServiceFactory } from './dist/embeddings/EmbeddingServiceFactory.js';

// Load environment variables
config();

async function testEmbeddingDimensions() {
  console.log('=== Embedding Dimension Diagnostic ===\n');

  // Show environment configuration
  console.log('Environment Configuration:');
  console.log('  EMBEDDING_PROVIDER:', process.env.EMBEDDING_PROVIDER || 'not set');
  console.log('  VOYAGE_EMBEDDING_MODEL:', process.env.VOYAGE_EMBEDDING_MODEL || 'not set');
  console.log('  VOYAGE_API_KEY:', process.env.VOYAGE_API_KEY ? 'SET' : 'NOT SET');
  console.log('  OPENAI_EMBEDDING_MODEL:', process.env.OPENAI_EMBEDDING_MODEL || 'not set');
  console.log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
  console.log('  NEO4J_VECTOR_DIMENSIONS:', process.env.NEO4J_VECTOR_DIMENSIONS || 'not set');
  console.log();

  // Create embedding service from environment
  console.log('Creating embedding service from environment...');
  const embeddingService = EmbeddingServiceFactory.createFromEnvironment();

  // Get model info
  const modelInfo = embeddingService.getModelInfo();
  console.log('\nEmbedding Service Model Info:');
  console.log('  Name:', modelInfo.name);
  console.log('  Dimensions:', modelInfo.dimensions);
  console.log('  Version:', modelInfo.version || 'not specified');

  // Get provider info if available
  if (typeof embeddingService.getProviderInfo === 'function') {
    const providerInfo = embeddingService.getProviderInfo();
    console.log('\nProvider Info:');
    console.log('  Provider:', providerInfo.provider);
    console.log('  Model:', providerInfo.model);
    console.log('  Dimensions:', providerInfo.dimensions);
  }

  // Generate a test embedding
  console.log('\nGenerating test embedding...');
  const testText = 'This is a test embedding for dimension verification';

  try {
    const embedding = await embeddingService.generateEmbedding(testText);
    console.log('  SUCCESS: Generated embedding');
    console.log('  Actual dimensions:', embedding.length);
    console.log('  First 5 values:', embedding.slice(0, 5));
    console.log('  Last 5 values:', embedding.slice(-5));

    // Check if dimensions match expected
    const expectedDimensions = parseInt(process.env.NEO4J_VECTOR_DIMENSIONS || '0', 10);
    if (expectedDimensions > 0) {
      if (embedding.length === expectedDimensions) {
        console.log(`  ✓ MATCH: Embedding dimensions (${embedding.length}) match NEO4J_VECTOR_DIMENSIONS (${expectedDimensions})`);
      } else {
        console.log(`  ✗ MISMATCH: Embedding dimensions (${embedding.length}) DO NOT match NEO4J_VECTOR_DIMENSIONS (${expectedDimensions})`);
        console.log('  THIS IS THE PROBLEM - The embedding service is generating the wrong dimensions!');
      }
    }

  } catch (error) {
    console.error('  ERROR generating embedding:', error.message);
    console.error('  Full error:', error);
  }
}

testEmbeddingDimensions().catch(console.error);
