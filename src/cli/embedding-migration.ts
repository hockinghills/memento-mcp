#!/usr/bin/env node

/**
 * Embedding Migration CLI Tool
 *
 * Provides safe migration utilities for changing embedding models and dimensions
 */

import { Neo4jConnectionManager } from '../storage/neo4j/Neo4jConnectionManager.js';
import { Neo4jSchemaManager } from '../storage/neo4j/Neo4jSchemaManager.js';
import { Neo4jMigrationManager } from '../storage/neo4j/Neo4jMigrationManager.js';
import { DEFAULT_NEO4J_CONFIG, type Neo4jConfig } from '../storage/neo4j/Neo4jConfig.js';
import { getModelDimensions, OPENAI_MODEL_DIMENSIONS } from '../embeddings/config.js';

/**
 * Parse command line arguments
 */
function parseArgs(argv: string[]): {
  command: string;
  config: Neo4jConfig;
  options: {
    dryRun: boolean;
    targetModel?: string;
    targetDimensions?: number;
    regenerateAll: boolean;
    skipBackup: boolean;
  };
} {
  const config = { ...DEFAULT_NEO4J_CONFIG };
  const options = {
    dryRun: false,
    regenerateAll: false,
    skipBackup: false,
  } as {
    dryRun: boolean;
    targetModel?: string;
    targetDimensions?: number;
    regenerateAll: boolean;
    skipBackup: boolean;
  };

  let command = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Parse config options
    if (arg === '--uri' && i + 1 < argv.length) {
      config.uri = argv[++i];
    } else if (arg === '--username' && i + 1 < argv.length) {
      config.username = argv[++i];
    } else if (arg === '--password' && i + 1 < argv.length) {
      config.password = argv[++i];
    } else if (arg === '--database' && i + 1 < argv.length) {
      config.database = argv[++i];
    } else if (arg === '--vector-index' && i + 1 < argv.length) {
      config.vectorIndexName = argv[++i];
    } else if (arg === '--dimensions' && i + 1 < argv.length) {
      config.vectorDimensions = parseInt(argv[++i], 10);
      options.targetDimensions = config.vectorDimensions;
    } else if (arg === '--target-model' && i + 1 < argv.length) {
      options.targetModel = argv[++i];
      // Auto-set dimensions from model
      options.targetDimensions = getModelDimensions(options.targetModel);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--regenerate-all') {
      options.regenerateAll = true;
    } else if (arg === '--skip-backup') {
      options.skipBackup = true;
    } else if (!arg.startsWith('--')) {
      // First non-option argument is the command
      if (!command) {
        command = arg;
      }
    }
  }

  // If target dimensions specified via --dimensions or --target-model, update config
  if (options.targetDimensions) {
    config.vectorDimensions = options.targetDimensions;
  }

  return { command, config, options };
}

/**
 * Analyze current embedding state
 */
async function analyzeCommand(
  config: Neo4jConfig,
  targetDimensions?: number
): Promise<void> {
  console.log('\n=== Embedding State Analysis ===\n');

  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    const expectedDims = targetDimensions || config.vectorDimensions;
    const state = await migrationManager.analyzeEmbeddingState(expectedDims);

    console.log(`Total entities: ${state.totalEntities}`);
    console.log(`Entities with embeddings: ${state.entitiesWithEmbeddings}`);
    console.log(`Entities without embeddings: ${state.entitiesWithoutEmbeddings}`);
    console.log(`\nDimension distribution:`);

    for (const [dims, count] of Object.entries(state.dimensionCounts)) {
      const indicator = parseInt(dims) === expectedDims ? '✓' : '✗';
      console.log(`  ${indicator} ${dims}D: ${count} entities`);
    }

    console.log(`\nConsistency status: ${state.consistencyStatus}`);

    if (state.mismatches.length > 0) {
      console.log(`\n⚠️  Found ${state.mismatches.length} mismatches:`);

      // Group by issue type
      const wrongDimensions = state.mismatches.filter(m => m.hasEmbedding);
      const missingEmbeddings = state.mismatches.filter(m => !m.hasEmbedding);

      if (wrongDimensions.length > 0) {
        console.log(`  - ${wrongDimensions.length} entities with wrong dimensions`);
        console.log(`    (showing first 5):`);
        wrongDimensions.slice(0, 5).forEach(m => {
          console.log(`      "${m.entityName}" [${m.entityType}]: ${m.currentDimensions}D (expected ${m.expectedDimensions}D)`);
        });
      }

      if (missingEmbeddings.length > 0) {
        console.log(`  - ${missingEmbeddings.length} entities without embeddings`);
        if (missingEmbeddings.length <= 10) {
          missingEmbeddings.forEach(m => {
            console.log(`      "${m.entityName}" [${m.entityType}]`);
          });
        } else {
          console.log(`    (showing first 10):`);
          missingEmbeddings.slice(0, 10).forEach(m => {
            console.log(`      "${m.entityName}" [${m.entityType}]`);
          });
        }
      }

      console.log(`\n💡 Recommendations:`);
      if (wrongDimensions.length > 0) {
        console.log(`  - Run 'clear-mismatched' to remove embeddings with wrong dimensions`);
      }
      if (state.entitiesWithoutEmbeddings > 0 || wrongDimensions.length > 0) {
        console.log(`  - After clearing, regenerate embeddings using your application`);
      }
    } else {
      console.log(`\n✓ All embeddings are consistent!`);
    }

    // Validate vector index
    console.log(`\n=== Vector Index Validation ===\n`);
    const indexValidation = await migrationManager.validateVectorIndex(
      config.vectorIndexName,
      expectedDims
    );

    console.log(indexValidation.message);
    if (indexValidation.exists && indexValidation.actualDimensions) {
      console.log(`  Index dimensions: ${indexValidation.actualDimensions}D`);
      console.log(`  Expected dimensions: ${expectedDims}D`);
      console.log(`  Status: ${indexValidation.isValid ? '✓ Valid' : '✗ Invalid'}`);
    }

    if (!indexValidation.isValid) {
      console.log(`\n💡 Recommendation:`);
      console.log(`  - Run 'recreate-index' to rebuild the vector index with correct dimensions`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Clear mismatched embeddings
 */
async function clearMismatchedCommand(
  config: Neo4jConfig,
  dryRun: boolean,
  targetDimensions?: number
): Promise<void> {
  console.log('\n=== Clear Mismatched Embeddings ===\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    const expectedDims = targetDimensions || config.vectorDimensions;
    console.log(`Target dimensions: ${expectedDims}D`);

    const count = await migrationManager.clearMismatchedEmbeddings(expectedDims, dryRun);

    if (dryRun) {
      console.log(`\n✓ Would clear ${count} mismatched embeddings`);
    } else {
      console.log(`\n✓ Cleared ${count} mismatched embeddings`);
      console.log(`\n💡 Next steps:`);
      console.log(`  1. Regenerate embeddings using your application`);
      console.log(`  2. Run 'analyze' to verify consistency`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Clear ALL embeddings
 */
async function clearAllCommand(
  config: Neo4jConfig,
  dryRun: boolean,
  skipBackup: boolean
): Promise<void> {
  console.log('\n=== Clear All Embeddings ===\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  } else {
    console.log('⚠️  WARNING: This will clear ALL embeddings in the database!\n');
  }

  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    // Create backup unless skipped or dry run
    if (!dryRun && !skipBackup) {
      console.log('Creating backup...');
      const backupCount = await migrationManager.backupEmbeddings();
      console.log(`✓ Backed up ${backupCount} embeddings\n`);
    }

    const count = await migrationManager.clearAllEmbeddings(dryRun);

    if (dryRun) {
      console.log(`\n✓ Would clear ${count} embeddings`);
    } else {
      console.log(`\n✓ Cleared ${count} embeddings`);

      if (!skipBackup) {
        console.log(`\n💡 Backup available - run 'restore' to undo this operation`);
      }

      console.log(`\n💡 Next steps:`);
      console.log(`  1. Optionally run 'recreate-index' to rebuild vector index`);
      console.log(`  2. Regenerate embeddings using your application`);
      console.log(`  3. Run 'analyze' to verify consistency`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Recreate vector index
 */
async function recreateIndexCommand(
  config: Neo4jConfig,
  dryRun: boolean
): Promise<void> {
  console.log('\n=== Recreate Vector Index ===\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const connectionManager = new Neo4jConnectionManager(config);
  const schemaManager = new Neo4jSchemaManager(connectionManager, config);

  try {
    console.log(`Index name: ${config.vectorIndexName}`);
    console.log(`Dimensions: ${config.vectorDimensions}D`);
    console.log(`Similarity function: ${config.similarityFunction}`);

    if (dryRun) {
      console.log(`\n✓ Would recreate vector index with these settings`);
      return;
    }

    // Drop and recreate the index
    console.log('\nDropping old index...');
    await schemaManager.dropIndexIfExists(config.vectorIndexName);

    console.log('Creating new index...');
    await schemaManager.createVectorIndex(
      config.vectorIndexName,
      'Entity',
      'embedding',
      config.vectorDimensions,
      config.similarityFunction,
      false // Don't use recreate flag since we manually dropped
    );

    console.log(`\n✓ Vector index recreated successfully`);

    // Verify
    const migrationManager = new Neo4jMigrationManager(connectionManager);
    const validation = await migrationManager.validateVectorIndex(
      config.vectorIndexName,
      config.vectorDimensions
    );

    console.log(`\nValidation: ${validation.message}`);
  } finally {
    await connectionManager.close();
  }
}

/**
 * Restore embeddings from backup
 */
async function restoreCommand(config: Neo4jConfig): Promise<void> {
  console.log('\n=== Restore Embeddings from Backup ===\n');

  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    const count = await migrationManager.restoreEmbeddings();
    console.log(`\n✓ Restored ${count} embeddings from backup`);

    if (count === 0) {
      console.log(`\n💡 No backups found - use 'analyze' to check current state`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * List entities needing embeddings
 */
async function listNeedingCommand(
  config: Neo4jConfig,
  targetDimensions?: number,
  regenerateAll = false
): Promise<void> {
  console.log('\n=== Entities Needing Embeddings ===\n');

  const connectionManager = new Neo4jConnectionManager(config);
  const migrationManager = new Neo4jMigrationManager(connectionManager);

  try {
    const expectedDims = targetDimensions || config.vectorDimensions;
    const entities = await migrationManager.getEntitiesNeedingEmbeddings(
      expectedDims,
      regenerateAll
    );

    console.log(`Found ${entities.length} entities needing ${regenerateAll ? 'regeneration' : 'generation'}:`);
    console.log(`Target dimensions: ${expectedDims}D\n`);

    if (entities.length <= 20) {
      entities.forEach(name => console.log(`  - ${name}`));
    } else {
      entities.slice(0, 20).forEach(name => console.log(`  - ${name}`));
      console.log(`  ... and ${entities.length - 20} more`);
    }

    console.log(`\n💡 Use your application to regenerate embeddings for these entities`);
  } finally {
    await connectionManager.close();
  }
}

/**
 * Print help message
 */
function printHelp(): void {
  const availableModels = Object.keys(OPENAI_MODEL_DIMENSIONS).join(', ');

  console.log(`
Embedding Migration CLI Tool

Usage:
  embedding-migration <command> [options]

Commands:
  analyze               Analyze current embedding state and identify issues
  clear-mismatched      Clear embeddings with wrong dimensions
  clear-all             Clear ALL embeddings (creates backup by default)
  recreate-index        Recreate the vector index with new dimensions
  restore               Restore embeddings from backup
  list-needing          List entities that need embedding generation
  help                  Show this help message

Options:
  --uri <uri>              Neo4j server URI (default: ${DEFAULT_NEO4J_CONFIG.uri})
  --username <username>    Neo4j username (default: ${DEFAULT_NEO4J_CONFIG.username})
  --password <password>    Neo4j password
  --database <name>        Neo4j database (default: ${DEFAULT_NEO4J_CONFIG.database})
  --vector-index <name>    Vector index name (default: ${DEFAULT_NEO4J_CONFIG.vectorIndexName})
  --dimensions <number>    Target vector dimensions
  --target-model <model>   Target OpenAI model (auto-sets dimensions)
                          Available: ${availableModels}
  --dry-run               Show what would happen without making changes
  --regenerate-all        Include all entities (not just missing/mismatched)
  --skip-backup           Skip creating backup before clearing (not recommended)

Examples:
  # Analyze current state
  embedding-migration analyze

  # Analyze with specific target dimensions
  embedding-migration analyze --dimensions 3072

  # Analyze for specific model
  embedding-migration analyze --target-model text-embedding-3-large

  # Clear mismatched embeddings (dry run first)
  embedding-migration clear-mismatched --dimensions 3072 --dry-run
  embedding-migration clear-mismatched --dimensions 3072

  # Full migration to new model
  embedding-migration analyze --target-model text-embedding-3-large
  embedding-migration clear-all --target-model text-embedding-3-large
  embedding-migration recreate-index --target-model text-embedding-3-large
  # Then regenerate embeddings using your application

  # Restore if something went wrong
  embedding-migration restore

Migration Workflow:
  1. Run 'analyze' to understand current state
  2. Run 'clear-mismatched' or 'clear-all' (with backup)
  3. Run 'recreate-index' to rebuild vector index with new dimensions
  4. Regenerate embeddings using your application
  5. Run 'analyze' again to verify consistency

Safety Features:
  - Always use --dry-run first to preview changes
  - Backups are created automatically (unless --skip-backup)
  - Use 'restore' to roll back if needed
  `);
}

/**
 * Main CLI function
 */
export async function main(): Promise<void> {
  console.log('Embedding Migration Tool');
  console.log('========================\n');

  const { command, config, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case 'analyze':
        await analyzeCommand(config, options.targetDimensions);
        break;

      case 'clear-mismatched':
        await clearMismatchedCommand(config, options.dryRun, options.targetDimensions);
        break;

      case 'clear-all':
        await clearAllCommand(config, options.dryRun, options.skipBackup);
        break;

      case 'recreate-index':
        await recreateIndexCommand(config, options.dryRun);
        break;

      case 'restore':
        await restoreCommand(config);
        break;

      case 'list-needing':
        await listNeedingCommand(config, options.targetDimensions, options.regenerateAll);
        break;

      case 'help':
      case '':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
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
