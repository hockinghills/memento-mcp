#!/usr/bin/env node
/**
 * Migration script to re-embed all entities with Voyage AI embeddings
 *
 * This script:
 * 1. Connects to Neo4j
 * 2. Drops and recreates the vector index with new dimensions
 * 3. Retrieves all entities
 * 4. Generates new embeddings using Voyage AI
 * 5. Updates entities with new embeddings
 *
 * Usage:
 *   tsx src/cli/migrate-to-voyage.ts [--dry-run] [--batch-size=50]
 */

import { config } from 'dotenv';
import neo4j from 'neo4j-driver';
import { VoyageAIEmbeddingService } from '../embeddings/VoyageAIEmbeddingService.js';
import { logger } from '../utils/logger.js';

// Load environment variables
config();

interface Entity {
  id: string;
  name: string;
  entityType: string;
  observations: string[];
}

interface MigrationOptions {
  dryRun: boolean;
  batchSize: number;
  recreateIndex: boolean;
}

class VoyageMigration {
  private driver: neo4j.Driver;
  private embeddingService: VoyageAIEmbeddingService;
  private newDimensions: number;
  private indexName: string;

  constructor() {
    // Validate environment
    if (!process.env.NEO4J_URI || !process.env.NEO4J_USERNAME || !process.env.NEO4J_PASSWORD) {
      throw new Error('Neo4j connection details required in .env');
    }

    if (!process.env.VOYAGE_API_KEY) {
      throw new Error('VOYAGE_API_KEY required in .env');
    }

    // Initialize Neo4j driver
    this.driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
    );

    // Get configuration
    this.newDimensions = parseInt(process.env.NEO4J_VECTOR_DIMENSIONS || '2048', 10);
    this.indexName = process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings';

    // Initialize Voyage AI embedding service
    const model = process.env.VOYAGE_EMBEDDING_MODEL || 'voyage-3-large';
    this.embeddingService = new VoyageAIEmbeddingService({
      apiKey: process.env.VOYAGE_API_KEY,
      model,
      dimensions: this.newDimensions,
    });

    logger.info('Migration initialized', {
      model,
      dimensions: this.newDimensions,
      indexName: this.indexName,
    });
  }

  /**
   * Fetch all entities from Neo4j
   */
  async fetchAllEntities(): Promise<Entity[]> {
    const session = this.driver.session();
    try {
      logger.info('Fetching all entities from Neo4j...');

      const result = await session.run(`
        MATCH (e:Entity)
        RETURN e.id AS id, e.name AS name, e.entityType AS entityType, e.observations AS observations
        ORDER BY e.name
      `);

      const entities: Entity[] = result.records.map((record) => ({
        id: record.get('id'),
        name: record.get('name'),
        entityType: record.get('entityType'),
        observations: record.get('observations') || [],
      }));

      logger.info(`Fetched ${entities.length} entities`);
      return entities;
    } finally {
      await session.close();
    }
  }

  /**
   * Create text representation of entity for embedding
   */
  entityToText(entity: Entity): string {
    const parts = [
      `Entity: ${entity.name}`,
      `Type: ${entity.entityType}`,
    ];

    if (entity.observations) {
      // Parse observations if it's a JSON string
      let observationsArray: string[] = [];
      if (typeof entity.observations === 'string') {
        try {
          observationsArray = JSON.parse(entity.observations);
        } catch (error) {
          // If parsing fails, treat as single observation
          observationsArray = [entity.observations];
        }
      } else if (Array.isArray(entity.observations)) {
        observationsArray = entity.observations;
      }

      if (observationsArray.length > 0) {
        parts.push(`Observations: ${observationsArray.join('; ')}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Drop existing vector index
   */
  async dropVectorIndex(): Promise<void> {
    const session = this.driver.session();
    try {
      logger.info(`Dropping vector index: ${this.indexName}`);

      await session.run(`
        DROP INDEX ${this.indexName} IF EXISTS
      `);

      logger.info('Vector index dropped');
    } catch (error) {
      logger.warn('Failed to drop index (may not exist)', error);
    } finally {
      await session.close();
    }
  }

  /**
   * Create new vector index with new dimensions
   */
  async createVectorIndex(): Promise<void> {
    const session = this.driver.session();
    try {
      logger.info(`Creating vector index: ${this.indexName} with ${this.newDimensions} dimensions`);

      const similarityFunction = process.env.NEO4J_SIMILARITY_FUNCTION || 'cosine';

      await session.run(`
        CREATE VECTOR INDEX ${this.indexName} IF NOT EXISTS
        FOR (e:Entity)
        ON e.embedding
        OPTIONS {
          indexConfig: {
            \`vector.dimensions\`: ${this.newDimensions},
            \`vector.similarity_function\`: '${similarityFunction}'
          }
        }
      `);

      logger.info('Vector index created successfully');
    } finally {
      await session.close();
    }
  }

  /**
   * Process entities in batches
   */
  async migrateEntities(entities: Entity[], options: MigrationOptions): Promise<void> {
    const { dryRun, batchSize } = options;

    logger.info(`Processing ${entities.length} entities in batches of ${batchSize}`);

    let processed = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(entities.length / batchSize)}`);

      try {
        // Generate text representations
        const texts = batch.map((entity) => this.entityToText(entity));

        // Generate embeddings
        logger.debug(`Generating embeddings for ${batch.length} entities...`);
        const embeddings = await this.embeddingService.generateEmbeddings(texts);

        if (dryRun) {
          logger.info(`[DRY RUN] Would update ${batch.length} entities with new embeddings`);
          processed += batch.length;
          continue;
        }

        // Update entities in Neo4j
        const session = this.driver.session();
        try {
          for (let j = 0; j < batch.length; j++) {
            const entity = batch[j];
            const embedding = embeddings[j];

            await session.run(
              `
              MATCH (e:Entity {name: $name})
              SET e.embedding = $embedding
              RETURN e
            `,
              {
                name: entity.name,
                embedding,
              }
            );

            processed++;
          }

          logger.info(`Batch complete: ${processed}/${entities.length} entities processed`);
        } finally {
          await session.close();
        }

        // Rate limiting: wait 1 second between batches
        if (i + batchSize < entities.length) {
          logger.debug('Waiting 1 second before next batch...');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error(`Failed to process batch starting at index ${i}`, error);
        failed += batch.length;
      }
    }

    logger.info('Migration complete', {
      total: entities.length,
      processed,
      failed,
    });
  }

  /**
   * Run the migration
   */
  async run(options: MigrationOptions): Promise<void> {
    try {
      logger.info('Starting Voyage AI migration', options);

      // Verify connection
      await this.driver.verifyConnectivity();
      logger.info('Neo4j connection verified');

      // Fetch entities
      const entities = await this.fetchAllEntities();

      if (entities.length === 0) {
        logger.warn('No entities found to migrate');
        return;
      }

      // Recreate index if requested
      if (options.recreateIndex && !options.dryRun) {
        await this.dropVectorIndex();
        await this.createVectorIndex();

        // Wait for index to be ready
        logger.info('Waiting 5 seconds for index to initialize...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      // Migrate entities
      await this.migrateEntities(entities, options);

      logger.info('Migration completed successfully');
    } catch (error) {
      logger.error('Migration failed', error);
      throw error;
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.driver.close();
  }
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);

  const options: MigrationOptions = {
    dryRun: false,
    batchSize: 50,
    recreateIndex: true,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--no-recreate-index') {
      options.recreateIndex = false;
    } else if (arg === '--help') {
      console.log(`
Usage: tsx src/cli/migrate-to-voyage.ts [OPTIONS]

Options:
  --dry-run              Run without making changes
  --batch-size=N         Process N entities per batch (default: 50)
  --no-recreate-index    Skip dropping and recreating the vector index
  --help                 Show this help message

Environment variables required:
  NEO4J_URI              Neo4j connection URI
  NEO4J_USERNAME         Neo4j username
  NEO4J_PASSWORD         Neo4j password
  VOYAGE_API_KEY         Voyage AI API key
  VOYAGE_EMBEDDING_MODEL Voyage AI model (default: voyage-3-large)
  NEO4J_VECTOR_DIMENSIONS Target dimensions (default: 2048)
  NEO4J_VECTOR_INDEX     Index name (default: entity_embeddings)
      `);
      process.exit(0);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  const migration = new VoyageMigration();

  try {
    await migration.run(options);
  } catch (error) {
    logger.error('Migration failed', error);
    process.exit(1);
  } finally {
    await migration.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
