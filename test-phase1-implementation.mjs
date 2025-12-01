#!/usr/bin/env node
/**
 * Quick test script to verify Phase 1 implementation components
 */

import { config } from 'dotenv';
config();

console.log('='.repeat(60));
console.log('Phase 1 Implementation Verification');
console.log('='.repeat(60));

// Test 1: Check environment configuration
console.log('\n1. Environment Configuration:');
console.log('   - EMBEDDING_PROVIDER:', process.env.EMBEDDING_PROVIDER || 'not set');
console.log('   - VOYAGE_API_KEY:', process.env.VOYAGE_API_KEY ? 'set ✓' : 'NOT SET ✗');
console.log('   - VOYAGE_EMBEDDING_MODEL:', process.env.VOYAGE_EMBEDDING_MODEL || 'not set');
console.log('   - COHERE_API_KEY:', process.env.COHERE_API_KEY ? 'set ✓' : 'NOT SET ✗');
console.log('   - NEO4J_VECTOR_DIMENSIONS:', process.env.NEO4J_VECTOR_DIMENSIONS || 'not set');
console.log('   - ENABLE_HYBRID_SEARCH:', process.env.ENABLE_HYBRID_SEARCH || 'not set');

// Test 2: Import new modules
console.log('\n2. Module Imports:');
try {
  const { VoyageAIEmbeddingService } = await import('./dist/embeddings/VoyageAIEmbeddingService.js');
  console.log('   - VoyageAIEmbeddingService: imported ✓');
} catch (error) {
  console.log('   - VoyageAIEmbeddingService: FAILED ✗');
  console.log('     Error:', error.message);
}

try {
  const { CohereRerankingService } = await import('./dist/reranking/CohereRerankingService.js');
  console.log('   - CohereRerankingService: imported ✓');
} catch (error) {
  console.log('   - CohereRerankingService: FAILED ✗');
  console.log('     Error:', error.message);
}

try {
  const { EmbeddingServiceFactory } = await import('./dist/embeddings/EmbeddingServiceFactory.js');
  console.log('   - EmbeddingServiceFactory: imported ✓');
} catch (error) {
  console.log('   - EmbeddingServiceFactory: FAILED ✗');
  console.log('     Error:', error.message);
}

// Test 3: Create Voyage AI service
console.log('\n3. Voyage AI Service Creation:');
try {
  const { VoyageAIEmbeddingService } = await import('./dist/embeddings/VoyageAIEmbeddingService.js');

  if (process.env.VOYAGE_API_KEY) {
    const service = new VoyageAIEmbeddingService({
      apiKey: process.env.VOYAGE_API_KEY,
      model: 'voyage-3-large',
      dimensions: 2048,
    });

    const modelInfo = service.getModelInfo();
    console.log('   - Service created ✓');
    console.log('   - Model:', modelInfo.name);
    console.log('   - Dimensions:', modelInfo.dimensions);

    // Test embedding generation
    console.log('\n   Testing embedding generation...');
    const embedding = await service.generateEmbedding('test query');
    console.log('   - Embedding generated ✓');
    console.log('   - Length:', embedding.length);
    console.log('   - Sample:', embedding.slice(0, 5).map(n => n.toFixed(4)).join(', '));
  } else {
    console.log('   - Skipped (no API key)');
  }
} catch (error) {
  console.log('   - FAILED ✗');
  console.log('     Error:', error.message);
}

// Test 4: Create Cohere service
console.log('\n4. Cohere Reranking Service Creation:');
try {
  const { CohereRerankingService } = await import('./dist/reranking/CohereRerankingService.js');

  if (process.env.COHERE_API_KEY) {
    const service = new CohereRerankingService({
      apiKey: process.env.COHERE_API_KEY,
      model: 'rerank-english-v3.0',
    });

    console.log('   - Service created ✓');

    // Test reranking
    console.log('\n   Testing reranking...');
    const documents = [
      { id: '1', text: 'The capital of France is Paris' },
      { id: '2', text: 'Python is a programming language' },
      { id: '3', text: 'Paris is a beautiful city in France' },
    ];

    const results = await service.rerank('What is the capital of France?', documents, 2);
    console.log('   - Reranking complete ✓');
    console.log('   - Top result:', results[0]?.id, '(score:', results[0]?.relevanceScore.toFixed(4), ')');
  } else {
    console.log('   - Skipped (no API key)');
  }
} catch (error) {
  console.log('   - FAILED ✗');
  console.log('     Error:', error.message);
}

// Test 5: EmbeddingServiceFactory
console.log('\n5. EmbeddingServiceFactory:');
try {
  const { EmbeddingServiceFactory } = await import('./dist/embeddings/EmbeddingServiceFactory.js');

  const availableProviders = EmbeddingServiceFactory.getAvailableProviders();
  console.log('   - Available providers:', availableProviders.join(', '));

  const service = EmbeddingServiceFactory.createFromEnvironment();
  const providerInfo = service.getProviderInfo();
  console.log('   - Active provider:', providerInfo.provider);
  console.log('   - Model:', providerInfo.model);
  console.log('   - Dimensions:', providerInfo.dimensions);
} catch (error) {
  console.log('   - FAILED ✗');
  console.log('     Error:', error.message);
}

console.log('\n' + '='.repeat(60));
console.log('Verification Complete');
console.log('='.repeat(60));
console.log('\nNext Steps:');
console.log('1. Review results above');
console.log('2. Run migration: tsx src/cli/migrate-to-voyage.ts --dry-run');
console.log('3. After dry-run succeeds, run actual migration');
console.log('4. Test search functionality');
console.log('='.repeat(60));
