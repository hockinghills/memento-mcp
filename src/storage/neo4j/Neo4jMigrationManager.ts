import type { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
import { logger } from '../../utils/logger.js';
import neo4j from 'neo4j-driver';

/**
 * Information about an embedding dimension mismatch
 */
export interface DimensionMismatch {
  entityName: string;
  entityType: string;
  currentDimensions: number;
  expectedDimensions: number;
  hasEmbedding: boolean;
}

/**
 * Summary of embedding state in the database
 */
export interface EmbeddingStateSummary {
  totalEntities: number;
  entitiesWithEmbeddings: number;
  entitiesWithoutEmbeddings: number;
  dimensionCounts: Record<number, number>;
  mismatches: DimensionMismatch[];
  consistencyStatus: 'consistent' | 'inconsistent' | 'no-embeddings';
}

/**
 * Migration progress information
 */
export interface MigrationProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  percentage: number;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /**
   * Target embedding dimensions
   */
  targetDimensions: number;

  /**
   * Batch size for processing entities
   */
  batchSize?: number;

  /**
   * Dry run mode - don't actually modify data
   */
  dryRun?: boolean;

  /**
   * Progress callback for long-running operations
   */
  onProgress?: (progress: MigrationProgress) => void;

  /**
   * Whether to regenerate all embeddings or only missing/mismatched ones
   */
  regenerateAll?: boolean;
}

/**
 * Manages database migrations and validation for embedding dimensions
 */
export class Neo4jMigrationManager {
  private connectionManager: Neo4jConnectionManager;

  constructor(connectionManager: Neo4jConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Analyze the current state of embeddings in the database
   *
   * @param expectedDimensions - Expected embedding dimensions
   * @returns Summary of embedding state
   */
  async analyzeEmbeddingState(expectedDimensions: number): Promise<EmbeddingStateSummary> {
    logger.info('Analyzing embedding state in database...');

    const session = await this.connectionManager.getSession();

    try {
      // Count total entities
      const totalResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.validTo = 9223372036854775807
        RETURN count(e) as total
      `);
      const totalEntities = totalResult.records[0].get('total').toNumber();

      // Count entities with embeddings
      const withEmbeddingsResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.validTo = 9223372036854775807
        AND e.embedding IS NOT NULL
        RETURN count(e) as count
      `);
      const entitiesWithEmbeddings = withEmbeddingsResult.records[0].get('count').toNumber();
      const entitiesWithoutEmbeddings = totalEntities - entitiesWithEmbeddings;

      // Get dimension distribution
      const dimensionResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.validTo = 9223372036854775807
        AND e.embedding IS NOT NULL
        WITH size(e.embedding) as dims
        RETURN dims, count(*) as count
        ORDER BY dims
      `);

      const dimensionCounts: Record<number, number> = {};
      for (const record of dimensionResult.records) {
        const dims = record.get('dims');
        const count = record.get('count').toNumber();
        dimensionCounts[dims] = count;
      }

      // Find mismatches
      const mismatchResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.validTo = 9223372036854775807
        AND e.embedding IS NOT NULL
        AND size(e.embedding) <> $expectedDims
        RETURN e.name as name, e.entityType as type, size(e.embedding) as dims
        LIMIT 1000
      `, { expectedDims: neo4j.int(expectedDimensions) });

      const mismatches: DimensionMismatch[] = mismatchResult.records.map(record => ({
        entityName: record.get('name'),
        entityType: record.get('type'),
        currentDimensions: record.get('dims'),
        expectedDimensions,
        hasEmbedding: true,
      }));

      // Also find entities without embeddings
      const noEmbeddingResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.validTo = 9223372036854775807
        AND e.embedding IS NULL
        RETURN e.name as name, e.entityType as type
        LIMIT 100
      `);

      for (const record of noEmbeddingResult.records) {
        mismatches.push({
          entityName: record.get('name'),
          entityType: record.get('type'),
          currentDimensions: 0,
          expectedDimensions,
          hasEmbedding: false,
        });
      }

      // Determine consistency status
      let consistencyStatus: 'consistent' | 'inconsistent' | 'no-embeddings';
      if (entitiesWithEmbeddings === 0) {
        consistencyStatus = 'no-embeddings';
      } else if (mismatches.length > 0) {
        consistencyStatus = 'inconsistent';
      } else {
        consistencyStatus = 'consistent';
      }

      const summary = {
        totalEntities,
        entitiesWithEmbeddings,
        entitiesWithoutEmbeddings,
        dimensionCounts,
        mismatches,
        consistencyStatus,
      };

      logger.info('Embedding state analysis complete', {
        totalEntities,
        entitiesWithEmbeddings,
        entitiesWithoutEmbeddings,
        dimensionCounts,
        mismatchCount: mismatches.length,
        consistencyStatus,
      });

      return summary;
    } finally {
      await session.close();
    }
  }

  /**
   * Clear embeddings that don't match the expected dimensions
   * This prepares the database for regenerating embeddings with correct dimensions
   *
   * @param expectedDimensions - Expected embedding dimensions
   * @param dryRun - If true, don't actually modify data
   * @returns Number of embeddings cleared
   */
  async clearMismatchedEmbeddings(
    expectedDimensions: number,
    dryRun = false
  ): Promise<number> {
    logger.info(`Clearing mismatched embeddings (expected: ${expectedDimensions} dimensions)...`);

    const session = await this.connectionManager.getSession();

    try {
      // First, count how many will be affected
      const countResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        AND size(e.embedding) <> $expectedDims
        RETURN count(e) as count
      `, { expectedDims: neo4j.int(expectedDimensions) });

      const count = countResult.records[0].get('count').toNumber();

      if (count === 0) {
        logger.info('No mismatched embeddings found');
        return 0;
      }

      if (dryRun) {
        logger.info(`[DRY RUN] Would clear ${count} mismatched embeddings`);
        return count;
      }

      // Clear the mismatched embeddings
      await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        AND size(e.embedding) <> $expectedDims
        REMOVE e.embedding
      `, { expectedDims: neo4j.int(expectedDimensions) });

      logger.info(`Cleared ${count} mismatched embeddings`);
      return count;
    } finally {
      await session.close();
    }
  }

  /**
   * Clear ALL embeddings in the database
   * Use this when doing a complete reindex
   *
   * @param dryRun - If true, don't actually modify data
   * @returns Number of embeddings cleared
   */
  async clearAllEmbeddings(dryRun = false): Promise<number> {
    logger.info('Clearing all embeddings...');

    const session = await this.connectionManager.getSession();

    try {
      // Count embeddings
      const countResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        RETURN count(e) as count
      `);

      const count = countResult.records[0].get('count').toNumber();

      if (count === 0) {
        logger.info('No embeddings found');
        return 0;
      }

      if (dryRun) {
        logger.info(`[DRY RUN] Would clear ${count} embeddings`);
        return count;
      }

      // Clear all embeddings
      await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        REMOVE e.embedding
      `);

      logger.info(`Cleared ${count} embeddings`);
      return count;
    } finally {
      await session.close();
    }
  }

  /**
   * Get list of entities that need embedding generation/regeneration
   *
   * @param targetDimensions - Target embedding dimensions
   * @param regenerateAll - If true, include all entities; if false, only those missing or mismatched
   * @returns List of entity names that need embeddings
   */
  async getEntitiesNeedingEmbeddings(
    targetDimensions: number,
    regenerateAll = false
  ): Promise<string[]> {
    const session = await this.connectionManager.getSession();

    try {
      let query: string;

      if (regenerateAll) {
        // Get all current entities
        query = `
          MATCH (e:Entity)
          WHERE e.validTo = 9223372036854775807
          RETURN e.name as name
        `;
      } else {
        // Get only entities missing embeddings or with wrong dimensions
        query = `
          MATCH (e:Entity)
          WHERE e.validTo = 9223372036854775807
          AND (
            e.embedding IS NULL
            OR size(e.embedding) <> $targetDims
          )
          RETURN e.name as name
        `;
      }

      const result = await session.run(
        query,
        regenerateAll ? {} : { targetDims: neo4j.int(targetDimensions) }
      );

      return result.records.map(record => record.get('name'));
    } finally {
      await session.close();
    }
  }

  /**
   * Validate that the vector index matches the expected dimensions
   *
   * @param indexName - Name of the vector index
   * @param expectedDimensions - Expected embedding dimensions
   * @returns Validation result with details
   */
  async validateVectorIndex(
    indexName: string,
    expectedDimensions: number
  ): Promise<{
    exists: boolean;
    isOnline: boolean;
    actualDimensions?: number;
    isValid: boolean;
    message: string;
  }> {
    logger.info(`Validating vector index: ${indexName}`);

    const session = await this.connectionManager.getSession();

    try {
      // Try to get index information
      const result = await session.run(`
        SHOW VECTOR INDEXES
        WHERE name = $indexName
      `, { indexName });

      if (result.records.length === 0) {
        return {
          exists: false,
          isOnline: false,
          isValid: false,
          message: `Vector index "${indexName}" does not exist`,
        };
      }

      const record = result.records[0];
      const state = record.get('state');
      const isOnline = state === 'ONLINE';

      // Extract dimensions from index config
      // Neo4j returns this as a map in the record
      let actualDimensions: number | undefined;
      try {
        const options = record.get('options');
        if (options && options.indexConfig) {
          actualDimensions = options.indexConfig['vector.dimensions'];
        }
      } catch (error) {
        logger.warn('Could not extract dimensions from index config', error);
      }

      const dimensionsMatch = actualDimensions === expectedDimensions;
      const isValid = isOnline && dimensionsMatch;

      let message = `Vector index "${indexName}" exists`;
      if (!isOnline) {
        message += `, but is not ONLINE (state: ${state})`;
      } else if (!dimensionsMatch) {
        message += `, but dimensions don't match (expected: ${expectedDimensions}, actual: ${actualDimensions})`;
      } else {
        message += ` and is valid`;
      }

      return {
        exists: true,
        isOnline,
        actualDimensions,
        isValid,
        message,
      };
    } catch (error) {
      logger.error('Error validating vector index', error);
      return {
        exists: false,
        isOnline: false,
        isValid: false,
        message: `Error validating index: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Create a backup of current embeddings before migration
   * Stores embeddings in a temporary property
   *
   * @returns Number of embeddings backed up
   */
  async backupEmbeddings(): Promise<number> {
    logger.info('Creating backup of embeddings...');

    const session = await this.connectionManager.getSession();

    try {
      const result = await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        SET e.embedding_backup = e.embedding,
            e.embedding_backup_timestamp = timestamp()
        RETURN count(e) as count
      `);

      const count = result.records[0].get('count').toNumber();
      logger.info(`Backed up ${count} embeddings`);
      return count;
    } finally {
      await session.close();
    }
  }

  /**
   * Restore embeddings from backup
   *
   * @returns Number of embeddings restored
   */
  async restoreEmbeddings(): Promise<number> {
    logger.info('Restoring embeddings from backup...');

    const session = await this.connectionManager.getSession();

    try {
      const result = await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding_backup IS NOT NULL
        SET e.embedding = e.embedding_backup
        REMOVE e.embedding_backup, e.embedding_backup_timestamp
        RETURN count(e) as count
      `);

      const count = result.records[0].get('count').toNumber();
      logger.info(`Restored ${count} embeddings`);
      return count;
    } finally {
      await session.close();
    }
  }

  /**
   * Clean up backup embeddings
   *
   * @returns Number of backups removed
   */
  async cleanupBackups(): Promise<number> {
    logger.info('Cleaning up embedding backups...');

    const session = await this.connectionManager.getSession();

    try {
      const result = await session.run(`
        MATCH (e:Entity)
        WHERE e.embedding_backup IS NOT NULL
        REMOVE e.embedding_backup, e.embedding_backup_timestamp
        RETURN count(e) as count
      `);

      const count = result.records[0].get('count').toNumber();
      logger.info(`Cleaned up ${count} backups`);
      return count;
    } finally {
      await session.close();
    }
  }
}
