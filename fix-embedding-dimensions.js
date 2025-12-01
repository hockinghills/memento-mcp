#!/usr/bin/env node

/**
 * Fix embedding dimension mismatch by re-embedding entities with wrong dimensions
 */

import { config } from 'dotenv';
import { initializeStorageProvider } from './dist/config/storage.js';
import { EmbeddingServiceFactory } from './dist/embeddings/EmbeddingServiceFactory.js';

// Load environment variables
config();

async function fixEmbeddingDimensions() {
  console.log('=== Fix Embedding Dimensions ===\n');

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

    // Find entities with wrong dimensions
    console.log('Finding entities with wrong embedding dimensions...');

    // Get entities with 3072 dimensions
    const wrongDimensionEntities = [
      'CT Clamp Circuit Design',
      'DMA Overflow Critical Issue',
      'ESP32-S3 Annealer CT Monitoring',
      'Memento Phase 1 Semantic Search Enhancement',
      'Memento_Repair_Session_2025_11_01',
      'Test Results October 29 2025'
    ];

    console.log(`  Found ${wrongDimensionEntities.length} entities with 3072 dimensions:\n`);
    wrongDimensionEntities.forEach((name, i) => {
      console.log(`    ${i + 1}. ${name}`);
    });
    console.log();

    // Re-embed each entity
    console.log('Re-embedding entities with correct dimensions...\n');
    let successCount = 0;
    let errorCount = 0;

    for (const entityName of wrongDimensionEntities) {
      try {
        console.log(`  Processing: ${entityName}`);

        // Get the entity
        const result = await storageProvider.openNodes([entityName]);
        const entity = result.entities[0];

        if (!entity) {
          console.log(`    ✗ Entity not found`);
          errorCount++;
          continue;
        }

        // Generate embedding text from entity name and observations
        const embeddingText = [
          entity.name,
          entity.entityType,
          ...(entity.observations || [])
        ].join(' ');

        console.log(`    Generating new ${modelInfo.dimensions}-dimension embedding...`);

        // Generate new embedding
        const newEmbedding = await embeddingService.generateEmbedding(embeddingText);

        console.log(`    Generated embedding: ${newEmbedding.length} dimensions`);

        // Update the entity embedding
        if (typeof storageProvider.updateEntityEmbedding === 'function') {
          await storageProvider.updateEntityEmbedding(entityName, {
            vector: newEmbedding,
            model: modelInfo.name,
            lastUpdated: Date.now(),
          });
          console.log(`    ✓ Updated embedding successfully\n`);
          successCount++;
        } else {
          console.log(`    ✗ updateEntityEmbedding method not available\n`);
          errorCount++;
        }

      } catch (error) {
        console.error(`    ✗ Error: ${error.message}\n`);
        errorCount++;
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`  Total entities: ${wrongDimensionEntities.length}`);
    console.log(`  ✓ Successfully re-embedded: ${successCount}`);
    console.log(`  ✗ Errors: ${errorCount}`);

    if (successCount === wrongDimensionEntities.length) {
      console.log('\n✓ ALL ENTITIES FIXED! Semantic search should now work correctly.');
    } else if (successCount > 0) {
      console.log('\n⚠ PARTIALLY FIXED. Some entities still need attention.');
    } else {
      console.log('\n✗ NO ENTITIES FIXED. Please check the errors above.');
    }

  } catch (error) {
    console.error('\n=== FIX FAILED ===');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

fixEmbeddingDimensions().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
