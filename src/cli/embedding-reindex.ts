#!/usr/bin/env node

/**
 * Embedding Reindex CLI Tool
 *
 * Flexible reindexing tools for database refactoring
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

import { Neo4jConnectionManager } from '../storage/neo4j/Neo4jConnectionManager.js';
import { Neo4jReindexManager, type ReindexOptions, type ReindexProgress } from '../storage/neo4j/Neo4jReindexManager.js';
import { EmbeddingServiceFactory } from '../embeddings/EmbeddingServiceFactory.js';
import { DEFAULT_NEO4J_CONFIG, type Neo4jConfig } from '../storage/neo4j/Neo4jConfig.js';

/**
 * Parse command line arguments
 */
function parseArgs(argv: string[]): {
  command: string;
  config: Neo4jConfig;
  options: ReindexOptions;
} {
  const config = { ...DEFAULT_NEO4J_CONFIG };
  const options: ReindexOptions = {
    batchSize: 10,
    batchDelay: 1000,
    dryRun: false,
    force: false,
    onlyMissing: false,
  };

  let command = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Neo4j config
    if (arg === '--uri' && i + 1 < argv.length) {
      config.uri = argv[++i];
    } else if (arg === '--username' && i + 1 < argv.length) {
      config.username = argv[++i];
    } else if (arg === '--password' && i + 1 < argv.length) {
      config.password = argv[++i];
    } else if (arg === '--database' && i + 1 < argv.length) {
      config.database = argv[++i];
    }
    // Reindex options
    else if (arg === '--batch-size' && i + 1 < argv.length) {
      options.batchSize = parseInt(argv[++i], 10);
    } else if (arg === '--batch-delay' && i + 1 < argv.length) {
      options.batchDelay = parseInt(argv[++i], 10);
    } else if (arg === '--entity-type' && i + 1 < argv.length) {
      options.entityTypes = options.entityTypes || [];
      options.entityTypes.push(argv[++i]);
    } else if (arg === '--name-pattern' && i + 1 < argv.length) {
      options.namePattern = argv[++i];
    } else if (arg === '--limit' && i + 1 < argv.length) {
      options.limit = parseInt(argv[++i], 10);
    } else if (arg === '--only-missing') {
      options.onlyMissing = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--query' && i + 1 < argv.length) {
      options.customQuery = argv[++i];
    } else if (!arg.startsWith('--')) {
      if (!command) {
        command = arg;
      }
    }
  }

  return { command, config, options };
}

/**
 * Count entities matching criteria
 */
async function countCommand(
  config: Neo4jConfig,
  options: ReindexOptions
): Promise<void> {
  console.log('\n=== Count Entities for Reindex ===\n');

  const connectionManager = new Neo4jConnectionManager(config);
  const reindexManager = new Neo4jReindexManager(connectionManager);

  try {
    // Validate options
    const validation = reindexManager.validateOptions(options);
    if (!validation.isValid) {
      console.error('❌ Invalid options:');
      validation.errors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    }

    // Show criteria
    console.log('Criteria:');
    if (options.entityTypes && options.entityTypes.length > 0) {
      console.log(`  Entity types: ${options.entityTypes.join(', ')}`);
    }
    if (options.namePattern) {
      console.log(`  Name pattern: ${options.namePattern}`);
    }
    if (options.onlyMissing) {
      console.log(`  Only missing embeddings: yes`);
    }
    if (options.force) {
      console.log(`  Force regenerate: yes`);
    }
    if (options.customQuery) {
      console.log(`  Custom query: ${options.customQuery}`);
    }

    // Count entities
    console.log('\nCounting...');
    const count = await reindexManager.countEntitiesForReindex(options);

    console.log(`\n✓ Found ${count} entities matching criteria`);

    // Show sample
    if (count > 0) {
      console.log('\nSample entities (up to 10):');
      const samples = await reindexManager.getSampleEntities(options, 10);
      samples.forEach(entity => {
        console.log(`  - ${entity.name} [${entity.type}]`);
      });

      if (count > 10) {
        console.log(`  ... and ${count - 10} more`);
      }
    }

    // Estimate
    if (count > 0) {
      const batchSize = options.batchSize || 10;
      const batchDelay = options.batchDelay || 1000;
      const totalBatches = Math.ceil(count / batchSize);
      const estimatedTime = (count * 0.5) + (totalBatches * batchDelay / 1000); // ~0.5s per entity + delays

      console.log('\nEstimates:');
      console.log(`  Total batches: ${totalBatches}`);
      console.log(`  Estimated time: ${(estimatedTime / 60).toFixed(1)} minutes`);
      console.log(`  OpenAI cost (approx): $${(count * 0.00002).toFixed(4)} (at avg 500 tokens/entity)`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Reindex embeddings
 */
async function reindexCommand(
  config: Neo4jConfig,
  options: ReindexOptions
): Promise<void> {
  console.log('\n=== Reindex Embeddings ===\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No embeddings will be generated\n');
  }

  const connectionManager = new Neo4jConnectionManager(config);
  const reindexManager = new Neo4jReindexManager(connectionManager);

  try {
    // Validate options
    const validation = reindexManager.validateOptions(options);
    if (!validation.isValid) {
      console.error('❌ Invalid options:');
      validation.errors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    }

    // Create embedding service
    const embeddingService = EmbeddingServiceFactory.createFromEnvironment();
    const modelInfo = embeddingService.getModelInfo();

    console.log('Configuration:');
    console.log(`  Model: ${modelInfo.name}`);
    console.log(`  Dimensions: ${modelInfo.dimensions}D`);
    console.log(`  Batch size: ${options.batchSize || 10}`);
    console.log(`  Batch delay: ${options.batchDelay || 1000}ms`);

    if (options.entityTypes && options.entityTypes.length > 0) {
      console.log(`  Entity types: ${options.entityTypes.join(', ')}`);
    }
    if (options.namePattern) {
      console.log(`  Name pattern: ${options.namePattern}`);
    }
    if (options.onlyMissing) {
      console.log(`  Only missing embeddings: yes`);
    }
    if (options.force) {
      console.log(`  Force regenerate: yes`);
    }
    if (options.limit) {
      console.log(`  Limit: ${options.limit} entities`);
    }

    console.log('\nStarting reindex...\n');

    // Progress callback
    let lastProgressTime = Date.now();
    options.onProgress = (progress: ReindexProgress) => {
      const now = Date.now();
      // Log every 5 seconds or every batch
      if (now - lastProgressTime > 5000 || progress.currentBatch !== Math.floor((progress.processed - 1) / (options.batchSize || 10)) + 1) {
        const eta = progress.estimatedTimeRemaining
          ? ` ETA: ${(progress.estimatedTimeRemaining / 1000 / 60).toFixed(1)}m`
          : '';
        console.log(
          `Progress: ${progress.processed}/${progress.total} (${progress.percentage.toFixed(1)}%) ` +
          `Succeeded: ${progress.succeeded}, Failed: ${progress.failed}${eta}`
        );
        lastProgressTime = now;
      }
    };

    // Execute reindex
    const result = await reindexManager.reindexEmbeddings(embeddingService, options);

    // Print results
    console.log('\n' + '='.repeat(50));
    if (options.dryRun) {
      console.log('✓ Dry run complete');
      console.log(`  Would process: ${result.total} entities`);
    } else {
      console.log('✓ Reindex complete');
      console.log(`  Total: ${result.total}`);
      console.log(`  Succeeded: ${result.succeeded}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Duration: ${(result.duration / 1000 / 60).toFixed(1)} minutes`);

      if (result.errors.length > 0) {
        console.log(`\n❌ Errors (${result.errors.length}):`);
        result.errors.slice(0, 10).forEach(err => {
          console.log(`  - ${err.entityName}: ${err.error}`);
        });
        if (result.errors.length > 10) {
          console.log(`  ... and ${result.errors.length - 10} more errors`);
        }
      }
    }
    console.log('='.repeat(50));
  } finally {
    await connectionManager.close();
  }
}

/**
 * Delete embeddings matching criteria
 */
async function deleteCommand(
  config: Neo4jConfig,
  options: ReindexOptions
): Promise<void> {
  console.log('\n=== Delete Embeddings ===\n');

  if (!options.dryRun) {
    console.log('⚠️  WARNING: This will delete embeddings!\n');
  } else {
    console.log('🔍 DRY RUN MODE - No embeddings will be deleted\n');
  }

  const connectionManager = new Neo4jConnectionManager(config);
  const reindexManager = new Neo4jReindexManager(connectionManager);

  try {
    // Show criteria
    console.log('Criteria:');
    if (options.entityTypes && options.entityTypes.length > 0) {
      console.log(`  Entity types: ${options.entityTypes.join(', ')}`);
    }
    if (options.namePattern) {
      console.log(`  Name pattern: ${options.namePattern}`);
    }
    if (options.customQuery) {
      console.log(`  Custom query: ${options.customQuery}`);
    }

    // Count first
    const count = await reindexManager.countEntitiesForReindex(options);
    console.log(`\nWould affect ${count} entities`);

    if (count === 0) {
      console.log('\n✓ No entities match criteria');
      return;
    }

    // Show sample
    console.log('\nSample entities (up to 10):');
    const samples = await reindexManager.getSampleEntities(options, 10);
    samples.forEach(entity => {
      console.log(`  - ${entity.name} [${entity.type}]`);
    });

    if (!options.dryRun) {
      console.log('\nDeleting embeddings...');
      const deleted = await reindexManager.deleteEmbeddingsBatch(options);
      console.log(`\n✓ Deleted ${deleted} embeddings`);
    } else {
      console.log(`\n✓ Would delete ${count} embeddings`);
    }
  } finally {
    await connectionManager.close();
  }
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Embedding Reindex CLI Tool

Usage:
  embedding-reindex <command> [options]

Commands:
  count       Count entities matching criteria (preview before reindexing)
  reindex     Reindex embeddings for matching entities
  delete      Delete embeddings for matching entities
  help        Show this help message

Neo4j Options:
  --uri <uri>              Neo4j server URI (default: bolt://localhost:7687)
  --username <username>    Neo4j username (default: neo4j)
  --password <password>    Neo4j password
  --database <name>        Neo4j database (default: neo4j)

Reindex Options:
  --batch-size <n>         Number of entities to process in parallel (default: 10)
  --batch-delay <ms>       Delay between batches in milliseconds (default: 1000)
  --entity-type <type>     Filter by entity type (can be used multiple times)
  --name-pattern <regex>   Filter by name pattern (regex)
  --limit <n>              Maximum number of entities to process
  --only-missing           Only reindex entities without embeddings
  --force                  Force regenerate even if embeddings exist
  --dry-run                Preview without making changes
  --query <cypher>         Custom Cypher query (advanced)

Examples:
  # Count entities without embeddings
  npm run embedding:reindex count --only-missing

  # Count specific entity types
  npm run embedding:reindex count --entity-type Project --entity-type Task

  # Reindex all missing embeddings (dry run first!)
  npm run embedding:reindex reindex --only-missing --dry-run
  npm run embedding:reindex reindex --only-missing

  # Reindex specific entity type
  npm run embedding:reindex reindex --entity-type Sensor --force

  # Reindex with name pattern
  npm run embedding:reindex reindex --name-pattern "temperature.*" --force

  # Reindex limited number for testing
  npm run embedding:reindex reindex --limit 10 --only-missing

  # Custom query for advanced filtering
  npm run embedding:reindex count --query "MATCH (e:Entity) WHERE e.createdAt > 1234567890 RETURN e.name as name, e.entityType as type, e.observations as observations"

  # Delete embeddings for cleanup
  npm run embedding:reindex delete --entity-type OldType --dry-run
  npm run embedding:reindex delete --entity-type OldType

Use Cases for Wong's Refactoring:

  1. Reindex specific entity types after schema changes:
     npm run embedding:reindex reindex --entity-type <NewType> --force

  2. Selective reindexing by name pattern:
     npm run embedding:reindex reindex --name-pattern "prefix_.*" --force

  3. Batch processing for large refactors:
     npm run embedding:reindex reindex --batch-size 50 --batch-delay 2000 --force

  4. Testing reindex on small sample:
     npm run embedding:reindex reindex --limit 10 --only-missing --dry-run

  5. Custom query for complex filtering:
     npm run embedding:reindex reindex --query "MATCH (e:Entity)-[:RELATED_TO]->(p:Project {name: 'MyProject'}) RETURN e.name as name, e.entityType as type, e.observations as observations" --force
  `);
}

/**
 * Main CLI function
 */
export async function main(): Promise<void> {
  console.log('Embedding Reindex Tool');
  console.log('======================\n');

  const { command, config, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case 'count':
        await countCommand(config, options);
        break;

      case 'reindex':
        await reindexCommand(config, options);
        break;

      case 'delete':
        await deleteCommand(config, options);
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
