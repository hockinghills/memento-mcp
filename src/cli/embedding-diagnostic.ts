#!/usr/bin/env node

/**
 * Embedding Diagnostic CLI Tool
 *
 * Provides diagnostic information about embedding configuration and state
 */

import { EmbeddingConfigValidator } from '../config/EmbeddingConfigValidator.js';
import { Neo4jConnectionManager } from '../storage/neo4j/Neo4jConnectionManager.js';
import { Neo4jMigrationManager } from '../storage/neo4j/Neo4jMigrationManager.js';
import { DEFAULT_NEO4J_CONFIG } from '../storage/neo4j/Neo4jConfig.js';

/**
 * Print configuration diagnostic information
 */
async function configDiagnostic(): Promise<void> {
  console.log('\n=== Embedding Configuration Diagnostic ===\n');

  const result = EmbeddingConfigValidator.validate();

  // Print config summary
  console.log('Configuration:');
  console.log(`  Provider: ${result.config.provider}`);
  console.log(`  Model: ${result.config.model}`);
  console.log(`  Embedding Dimensions: ${result.config.dimensions}D`);
  console.log(`    Source: ${result.config.dimensionsSource}`);
  console.log(`  Vector Index Dimensions: ${result.config.vectorIndexDimensions}D`);
  console.log(`    Source: ${result.config.vectorIndexSource}`);
  console.log(`  Dimensions Match: ${result.config.dimensionsMatch ? '✓' : '✗'}`);
  console.log(`  API Key Configured: ${result.config.apiKeyConfigured ? 'Yes' : 'No'}`);
  console.log(`  Mock Embeddings: ${result.config.mockEmbeddings ? 'Yes' : 'No'}`);

  // Print environment variables
  console.log('\nEnvironment Variables:');
  const envVars = [
    'OPENAI_API_KEY',
    'OPENAI_EMBEDDING_MODEL',
    'OPENAI_EMBEDDING_DIMENSIONS',
    'NEO4J_VECTOR_DIMENSIONS',
    'MOCK_EMBEDDINGS',
  ];

  for (const varName of envVars) {
    const value = process.env[varName];
    if (varName === 'OPENAI_API_KEY') {
      console.log(`  ${varName}: ${value ? '***SET***' : '(not set)'}`);
    } else {
      console.log(`  ${varName}: ${value || '(not set)'}`);
    }
  }

  // Print warnings
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
  }

  // Print errors
  if (result.errors.length > 0) {
    console.log('\n❌ Errors:');
    result.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  // Print recommendations
  const recommendations = EmbeddingConfigValidator.getRecommendations();
  if (recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    recommendations.forEach(rec => console.log(rec));
  }

  // Print status
  console.log('\n' + '='.repeat(50));
  if (result.isValid && result.warnings.length === 0) {
    console.log('Status: ✓ Configuration is valid and optimal');
  } else if (result.isValid) {
    console.log('Status: ⚠️  Configuration is valid but has warnings');
  } else {
    console.log('Status: ❌ Configuration has errors that must be fixed');
  }
  console.log('='.repeat(50));
}

/**
 * Print database diagnostic information
 */
async function databaseDiagnostic(): Promise<void> {
  console.log('\n=== Database Embedding State Diagnostic ===\n');

  const config = { ...DEFAULT_NEO4J_CONFIG };
  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    // Get expected dimensions
    const configResult = EmbeddingConfigValidator.validate();
    const expectedDims = configResult.config.vectorIndexDimensions;

    console.log(`Expected dimensions: ${expectedDims}D\n`);

    // Analyze embedding state
    const state = await migrationManager.analyzeEmbeddingState(expectedDims);

    console.log('Database State:');
    console.log(`  Total entities: ${state.totalEntities}`);
    console.log(`  Entities with embeddings: ${state.entitiesWithEmbeddings}`);
    console.log(`  Entities without embeddings: ${state.entitiesWithoutEmbeddings}`);

    console.log('\nDimension Distribution:');
    if (Object.keys(state.dimensionCounts).length === 0) {
      console.log('  (no embeddings found)');
    } else {
      for (const [dims, count] of Object.entries(state.dimensionCounts)) {
        const indicator = parseInt(dims) === expectedDims ? '✓' : '✗';
        const percentage = ((count / state.entitiesWithEmbeddings) * 100).toFixed(1);
        console.log(`  ${indicator} ${dims}D: ${count} entities (${percentage}%)`);
      }
    }

    console.log(`\nConsistency Status: ${state.consistencyStatus}`);

    if (state.mismatches.length > 0) {
      console.log(`\n⚠️  Found ${state.mismatches.length} issues:`);

      const wrongDimensions = state.mismatches.filter(m => m.hasEmbedding);
      const missingEmbeddings = state.mismatches.filter(m => !m.hasEmbedding);

      if (wrongDimensions.length > 0) {
        console.log(`\n  Wrong Dimensions: ${wrongDimensions.length} entities`);
        console.log('  (showing first 5):');
        wrongDimensions.slice(0, 5).forEach(m => {
          console.log(`    "${m.entityName}" [${m.entityType}]: ${m.currentDimensions}D → should be ${m.expectedDimensions}D`);
        });
      }

      if (missingEmbeddings.length > 0) {
        console.log(`\n  Missing Embeddings: ${missingEmbeddings.length} entities`);
        if (missingEmbeddings.length <= 10) {
          missingEmbeddings.forEach(m => {
            console.log(`    "${m.entityName}" [${m.entityType}]`);
          });
        } else {
          console.log('  (showing first 10):');
          missingEmbeddings.slice(0, 10).forEach(m => {
            console.log(`    "${m.entityName}" [${m.entityType}]`);
          });
        }
      }
    }

    // Validate vector index
    console.log('\n=== Vector Index Validation ===\n');
    const indexValidation = await migrationManager.validateVectorIndex(
      config.vectorIndexName,
      expectedDims
    );

    console.log(indexValidation.message);
    if (indexValidation.exists && indexValidation.actualDimensions) {
      console.log(`  Index dimensions: ${indexValidation.actualDimensions}D`);
      console.log(`  Expected dimensions: ${expectedDims}D`);
      console.log(`  Match: ${indexValidation.isValid ? '✓' : '✗'}`);
    }

    // Print recommended actions
    console.log('\n💡 Recommended Actions:');

    if (state.consistencyStatus === 'no-embeddings') {
      console.log('  - No embeddings found. Create entities to generate embeddings.');
    } else if (state.consistencyStatus === 'inconsistent') {
      console.log('  - Run migration tool to fix inconsistencies:');
      console.log('    npm run embedding:migrate analyze');
      console.log('    npm run embedding:migrate clear-mismatched --dry-run');
      console.log('    npm run embedding:migrate clear-mismatched');
    } else {
      console.log('  - ✓ Database is consistent. No action needed.');
    }

    if (!indexValidation.isValid) {
      console.log('  - Recreate vector index with correct dimensions:');
      console.log('    npm run embedding:migrate recreate-index');
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Print full diagnostic (config + database)
 */
async function fullDiagnostic(): Promise<void> {
  await configDiagnostic();
  console.log('\n');
  await databaseDiagnostic();
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Embedding Diagnostic Tool

Usage:
  embedding-diagnostic [command]

Commands:
  config      Show embedding configuration diagnostic
  database    Show database embedding state diagnostic
  full        Show both configuration and database diagnostics (default)
  help        Show this help message

Examples:
  # Show full diagnostic
  npm run embedding:analyze

  # Show only configuration
  npm run embedding:analyze config

  # Show only database state
  npm run embedding:analyze database
  `);
}

/**
 * Main CLI function
 */
export async function main(): Promise<void> {
  const command = process.argv[2] || 'full';

  try {
    switch (command) {
      case 'config':
        await configDiagnostic();
        break;

      case 'database':
      case 'db':
        await databaseDiagnostic();
        break;

      case 'full':
      case '':
        await fullDiagnostic();
        break;

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
