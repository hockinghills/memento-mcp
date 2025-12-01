import type { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
import { logger } from '../../utils/logger.js';
import type { IEmbeddingService } from '../../embeddings/EmbeddingService.js';
import neo4j from 'neo4j-driver';

/**
 * Reindexing options
 */
export interface ReindexOptions {
  /**
   * Batch size for processing entities
   */
  batchSize?: number;

  /**
   * Filter entities by type
   */
  entityTypes?: string[];

  /**
   * Filter entities by name pattern (regex)
   */
  namePattern?: string;

  /**
   * Only reindex entities without embeddings
   */
  onlyMissing?: boolean;

  /**
   * Force regenerate even if embeddings exist
   */
  force?: boolean;

  /**
   * Dry run mode - don't actually generate/store
   */
  dryRun?: boolean;

  /**
   * Maximum number of entities to process (for testing)
   */
  limit?: number;

  /**
   * Progress callback
   */
  onProgress?: (progress: ReindexProgress) => void;

  /**
   * Delay between batches (ms) for rate limiting
   */
  batchDelay?: number;

  /**
   * Custom entity selector query
   * If provided, overrides other filters
   */
  customQuery?: string;

  /**
   * Custom query parameters
   */
  customQueryParams?: Record<string, unknown>;
}

/**
 * Reindex progress information
 */
export interface ReindexProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  estimatedTimeRemaining?: number;
}

/**
 * Reindex result
 */
export interface ReindexResult {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ entityName: string; error: string }>;
  duration: number;
}

/**
 * Entity batch for reindexing
 */
interface EntityBatch {
  name: string;
  type: string;
  observations: string[];
}

/**
 * Manages flexible reindexing operations for database refactoring
 */
export class Neo4jReindexManager {
  private connectionManager: Neo4jConnectionManager;

  constructor(connectionManager: Neo4jConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Reindex embeddings for entities matching the criteria
   *
   * @param embeddingService - Service to generate embeddings
   * @param options - Reindexing options
   * @returns Reindex result
   */
  async reindexEmbeddings(
    embeddingService: IEmbeddingService,
    options: ReindexOptions = {}
  ): Promise<ReindexResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 10;
    const batchDelay = options.batchDelay || 1000;

    logger.info('Starting reindexing operation', options);

    // Get entities to reindex
    const entities = await this.getEntitiesToReindex(options);
    const total = entities.length;

    if (total === 0) {
      logger.info('No entities found matching criteria');
      return {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        duration: Date.now() - startTime,
      };
    }

    logger.info(`Found ${total} entities to reindex`);

    if (options.dryRun) {
      logger.info('[DRY RUN] Would reindex the following entities:', {
        sample: entities.slice(0, 10).map(e => e.name),
        total: entities.length,
      });
      return {
        total,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        duration: Date.now() - startTime,
      };
    }

    // Process in batches
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ entityName: string; error: string }> = [];

    const totalBatches = Math.ceil(total / batchSize);

    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;

      logger.info(`Processing batch ${currentBatch}/${totalBatches}`, {
        batchSize: batch.length,
        processed,
        total,
      });

      for (const entity of batch) {
        try {
          // Generate embedding text from entity
          const text = this.generateEmbeddingText(entity);

          // Generate embedding
          const embedding = await embeddingService.generateEmbedding(text);

          // Store embedding
          await this.storeEmbedding(entity.name, embedding, embeddingService);

          succeeded++;
          logger.debug(`Successfully reindexed: ${entity.name}`);
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ entityName: entity.name, error: errorMessage });
          logger.error(`Failed to reindex: ${entity.name}`, error);
        }

        processed++;

        // Report progress
        if (options.onProgress) {
          const progress: ReindexProgress = {
            total,
            processed,
            succeeded,
            failed,
            skipped,
            percentage: (processed / total) * 100,
            currentBatch,
            totalBatches,
          };

          // Estimate time remaining
          const elapsed = Date.now() - startTime;
          const avgTimePerEntity = elapsed / processed;
          const remaining = total - processed;
          progress.estimatedTimeRemaining = avgTimePerEntity * remaining;

          options.onProgress(progress);
        }
      }

      // Delay between batches for rate limiting
      if (i + batchSize < entities.length && batchDelay > 0) {
        logger.debug(`Waiting ${batchDelay}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Reindexing complete', {
      total,
      processed,
      succeeded,
      failed,
      skipped,
      duration: `${(duration / 1000).toFixed(2)}s`,
    });

    return {
      total,
      processed,
      succeeded,
      failed,
      skipped,
      errors,
      duration,
    };
  }

  /**
   * Get entities that need reindexing based on criteria
   */
  private async getEntitiesToReindex(options: ReindexOptions): Promise<EntityBatch[]> {
    const session = await this.connectionManager.getSession();

    try {
      let query: string;
      let params: Record<string, unknown>;

      // Use custom query if provided
      if (options.customQuery) {
        query = options.customQuery;
        params = options.customQueryParams || {};
      } else {
        // Build query based on options
        const conditions: string[] = ['e.validTo = 9223372036854775807'];

        // Filter by entity types
        if (options.entityTypes && options.entityTypes.length > 0) {
          conditions.push('e.entityType IN $entityTypes');
        }

        // Filter by name pattern
        if (options.namePattern) {
          conditions.push('e.name =~ $namePattern');
        }

        // Filter by missing embeddings
        if (options.onlyMissing) {
          conditions.push('e.embedding IS NULL');
        } else if (!options.force) {
          // Skip entities that already have embeddings (unless force)
          conditions.push('e.embedding IS NULL');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

        query = `
          MATCH (e:Entity)
          ${whereClause}
          RETURN e.name as name, e.entityType as type, e.observations as observations
          ORDER BY e.createdAt DESC
          ${limitClause}
        `;

        params = {
          entityTypes: options.entityTypes || [],
          namePattern: options.namePattern || '.*',
        };
      }

      const result = await session.run(query, params);

      return result.records.map(record => ({
        name: record.get('name'),
        type: record.get('type'),
        observations: record.get('observations') || [],
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Generate embedding text from entity
   */
  private generateEmbeddingText(entity: EntityBatch): string {
    // Combine entity name, type, and observations into text
    const parts = [
      `Entity: ${entity.name}`,
      `Type: ${entity.type}`,
    ];

    if (entity.observations && entity.observations.length > 0) {
      // Convert Neo4j array to JavaScript array if needed
      const observations = Array.isArray(entity.observations)
        ? entity.observations
        : Array.from(entity.observations);
      parts.push(`Observations: ${observations.join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Store embedding for entity
   */
  private async storeEmbedding(
    entityName: string,
    embedding: number[],
    embeddingService: IEmbeddingService
  ): Promise<void> {
    const session = await this.connectionManager.getSession();

    try {
      const modelInfo = embeddingService.getModelInfo();

      await session.run(
        `
          MATCH (e:Entity {name: $name})
          SET e.embedding = $embedding,
              e.embeddingModel = $model,
              e.embeddingDimensions = $dimensions,
              e.embeddingUpdated = timestamp()
          RETURN e
        `,
        {
          name: entityName,
          embedding,
          model: modelInfo.name,
          dimensions: neo4j.int(modelInfo.dimensions),
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Count entities matching reindex criteria
   * Useful for estimating work before starting reindex
   */
  async countEntitiesForReindex(options: ReindexOptions): Promise<number> {
    const session = await this.connectionManager.getSession();

    try {
      let query: string;
      let params: Record<string, unknown>;

      if (options.customQuery) {
        // For custom queries, wrap in COUNT
        query = `
          WITH (${options.customQuery}) as subquery
          RETURN count(*) as count
        `;
        params = options.customQueryParams || {};
      } else {
        const conditions: string[] = ['e.validTo = 9223372036854775807'];

        if (options.entityTypes && options.entityTypes.length > 0) {
          conditions.push('e.entityType IN $entityTypes');
        }

        if (options.namePattern) {
          conditions.push('e.name =~ $namePattern');
        }

        if (options.onlyMissing) {
          conditions.push('e.embedding IS NULL');
        } else if (!options.force) {
          conditions.push('e.embedding IS NULL');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        query = `
          MATCH (e:Entity)
          ${whereClause}
          RETURN count(e) as count
        `;

        params = {
          entityTypes: options.entityTypes || [],
          namePattern: options.namePattern || '.*',
        };
      }

      const result = await session.run(query, params);
      return result.records[0].get('count').toNumber();
    } finally {
      await session.close();
    }
  }

  /**
   * Get sample entities for preview
   */
  async getSampleEntities(options: ReindexOptions, limit = 10): Promise<EntityBatch[]> {
    const sampleOptions = { ...options, limit };
    return this.getEntitiesToReindex(sampleOptions);
  }

  /**
   * Batch delete embeddings (for cleanup/reset scenarios)
   */
  async deleteEmbeddingsBatch(options: ReindexOptions): Promise<number> {
    const session = await this.connectionManager.getSession();

    try {
      let query: string;
      let params: Record<string, unknown>;

      if (options.customQuery) {
        // Extract entity names from custom query
        const entitiesResult = await session.run(options.customQuery, options.customQueryParams || {});
        const entityNames = entitiesResult.records.map(r => r.get('name'));

        query = `
          MATCH (e:Entity)
          WHERE e.name IN $names
          REMOVE e.embedding, e.embeddingModel, e.embeddingDimensions, e.embeddingUpdated
          RETURN count(e) as count
        `;

        params = { names: entityNames };
      } else {
        const conditions: string[] = ['e.validTo = 9223372036854775807'];

        if (options.entityTypes && options.entityTypes.length > 0) {
          conditions.push('e.entityType IN $entityTypes');
        }

        if (options.namePattern) {
          conditions.push('e.name =~ $namePattern');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        query = `
          MATCH (e:Entity)
          ${whereClause}
          REMOVE e.embedding, e.embeddingModel, e.embeddingDimensions, e.embeddingUpdated
          RETURN count(e) as count
        `;

        params = {
          entityTypes: options.entityTypes || [],
          namePattern: options.namePattern || '.*',
        };
      }

      const result = await session.run(query, params);
      return result.records[0].get('count').toNumber();
    } finally {
      await session.close();
    }
  }

  /**
   * Validate reindex options before execution
   */
  validateOptions(options: ReindexOptions): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (options.batchSize && (options.batchSize < 1 || options.batchSize > 1000)) {
      errors.push('Batch size must be between 1 and 1000');
    }

    if (options.limit && options.limit < 0) {
      errors.push('Limit must be non-negative');
    }

    if (options.batchDelay && options.batchDelay < 0) {
      errors.push('Batch delay must be non-negative');
    }

    if (options.customQuery && !options.customQuery.includes('RETURN')) {
      errors.push('Custom query must include RETURN clause');
    }

    if (options.entityTypes && options.entityTypes.length === 0) {
      errors.push('Entity types array cannot be empty (omit the option instead)');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
