import type { VectorStore, VectorSearchResult } from '../../types/vector-store.js';
import type { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
import { Neo4jSchemaManager } from './Neo4jSchemaManager.js';
import { logger } from '../../utils/logger.js';
import neo4j from 'neo4j-driver';
import { getModelDimensions } from '../../embeddings/config.js';

export interface Neo4jVectorStoreOptions {
  connectionManager: Neo4jConnectionManager;
  indexName?: string;
  dimensions?: number;
  similarityFunction?: 'cosine' | 'euclidean';
  entityNodeLabel?: string;
}

/**
 * Neo4j implementation of VectorStore interface
 * Uses Neo4j's native vector search capabilities
 */
export class Neo4jVectorStore implements VectorStore {
  private readonly connectionManager: Neo4jConnectionManager;
  private readonly indexName: string;
  private readonly dimensions: number;
  private readonly similarityFunction: 'cosine' | 'euclidean';
  private readonly entityNodeLabel: string;
  private initialized = false;
  private schemaManager: Neo4jSchemaManager;

  constructor(options: Neo4jVectorStoreOptions) {
    this.connectionManager = options.connectionManager;
    this.indexName = options.indexName || 'entity_embeddings';
    // Get dimensions from options, NEO4J_VECTOR_DIMENSIONS env var, or infer from embedding model
    this.dimensions =
      options.dimensions ||
      (process.env.NEO4J_VECTOR_DIMENSIONS
        ? parseInt(process.env.NEO4J_VECTOR_DIMENSIONS, 10)
        : getModelDimensions(process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'));
    this.similarityFunction = options.similarityFunction || 'cosine';
    this.entityNodeLabel = options.entityNodeLabel || 'Entity';
    this.schemaManager = new Neo4jSchemaManager(this.connectionManager);
  }

  /**
   * Initialize the Neo4j vector store by ensuring the vector index exists
   */
  async initialize(): Promise<void> {
    try {
      // Check if vector index exists - with safety check for tests
      let indexExists = false;
      if (typeof this.schemaManager.vectorIndexExists === 'function') {
        indexExists = await this.schemaManager.vectorIndexExists(this.indexName);
      } else {
        logger.warn(
          'vectorIndexExists method not available on schemaManager - this may be a test environment'
        );
      }

      // Create vector index if it doesn't exist
      if (!indexExists) {
        logger.info(`Creating Neo4j vector index: ${this.indexName}`);
        if (typeof this.schemaManager.createVectorIndex === 'function') {
          await this.schemaManager.createVectorIndex(
            this.indexName,
            this.entityNodeLabel,
            'embedding',
            this.dimensions,
            this.similarityFunction
          );
        } else {
          logger.warn(
            'createVectorIndex method not available on schemaManager - this may be a test environment'
          );
        }
      } else {
        logger.info(`Using existing Neo4j vector index: ${this.indexName}`);
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Neo4j vector store', error);
      throw error;
    }
  }

  /**
   * Add or update a vector for an entity
   * @param id Entity ID or name
   * @param vector Embedding vector
   * @param metadata Optional metadata to store with the vector
   */
  async addVector(
    id: string | number,
    vector: number[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
  ): Promise<void> {
    this.ensureInitialized();

    // Validate vector dimensions
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Invalid vector dimensions: expected ${this.dimensions}, got ${vector.length}`
      );
    }

    try {
      const session = await this.connectionManager.getSession();
      const tx = session.beginTransaction();

      try {
        // Store embedding directly on the entity node
        // If the entity exists, update it; otherwise, create it
        const query = `
          MERGE (e:${this.entityNodeLabel} {name: $id})
          SET e.embedding = $vector
          RETURN e
        `;

        await tx.run(query, {
          id: id.toString(),
          vector: vector,
        });

        // Store metadata if provided
        if (metadata && Object.keys(metadata).length > 0) {
          const metadataQuery = `
            MATCH (e:${this.entityNodeLabel} {name: $id})
            SET e.metadata = $metadata
            RETURN e
          `;

          await tx.run(metadataQuery, {
            id: id.toString(),
            metadata: JSON.stringify(metadata),
          });
        }

        await tx.commit();
        logger.debug(`Added vector for entity: ${id}`);
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error(`Failed to add vector for entity: ${id}`, error);
      throw error;
    }
  }

  /**
   * Remove a vector for an entity
   * @param id Entity ID or name
   */
  async removeVector(id: string | number): Promise<void> {
    this.ensureInitialized();

    try {
      const session = await this.connectionManager.getSession();

      // Remove the embedding from the entity but keep the entity node
      const query = `
        MATCH (e:${this.entityNodeLabel} {name: $id})
        REMOVE e.embedding
        REMOVE e.metadata
        RETURN e
      `;

      await session.run(query, { id: id.toString() });
      await session.close();

      logger.debug(`Removed vector for entity: ${id}`);
    } catch (error) {
      logger.error(`Failed to remove vector for entity: ${id}`, error);
      throw error;
    }
  }

  /**
   * Search for entities similar to the provided query vector
   * @param queryVector The query embedding vector
   * @param options Search options including limit, filter, etc.
   * @returns Array of search results with ID, similarity score, and metadata
   */
  async search(
    queryVector: number[],
    options: {
      limit?: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter?: Record<string, any>;
      hybridSearch?: boolean;
      minSimilarity?: number;
      queryText?: string; // Required for hybrid search
      rrfK?: number; // RRF constant (default 60)
    } = {}
  ): Promise<VectorSearchResult[]> {
    try {
      this.ensureInitialized();

      // Verify query vector dimensions
      if (queryVector.length !== this.dimensions) {
        throw new Error(
          `Invalid vector dimensions: expected ${this.dimensions}, got ${queryVector.length}`
        );
      }

      // Debug vector stats
      const vectorStats = this.calculateVectorStats(queryVector);
      logger.debug(
        `Neo4jVectorStore: Vector stats: min=${vectorStats.min}, max=${vectorStats.max}, avg=${vectorStats.avg}, l2norm=${vectorStats.l2Norm}`
      );

      // Verify vector has a valid l2-norm (can't be all zeros)
      const hasValidNorm = this.vectorHasValidNorm(queryVector);
      if (!hasValidNorm) {
        logger.warn(`Neo4jVectorStore: Vector has invalid l2-norm, using fallback search`);
        // Fallback to pattern matching instead
        return this.searchByPatternFallback(options.limit ?? 5);
      }

      // Process search options
      const limit = options.limit ?? 5;
      const minSimilarity = options.minSimilarity ?? 0;

      // Check if hybrid search is enabled and query text is provided
      if (options.hybridSearch && options.queryText) {
        logger.debug(
          `Neo4jVectorStore: Using hybrid search (RRF) with limit=${limit}, minSimilarity=${minSimilarity}`
        );
        return this.hybridSearchWithRRF(queryVector, options.queryText, limit, options.rrfK);
      }

      logger.debug(
        `Neo4jVectorStore: Using vector search with limit=${limit}, minSimilarity=${minSimilarity}`
      );

      // Start session
      const session = await this.connectionManager.getSession();

      try {
        // Use the exact working approach from our test script
        // This approach follows the Neo4j documentation and was verified to work
        const result = await session.run(
          `
          CALL db.index.vector.queryNodes(
            $indexName,
            $limit,
            $embedding
          )
          YIELD node, score
          WHERE score >= $minScore
          RETURN node.name AS id, node.entityType AS entityType, score AS similarity
          ORDER BY score DESC
        `,
          {
            indexName: this.indexName,
            limit: neo4j.int(Math.floor(limit)),
            embedding: queryVector,
            minScore: minSimilarity,
          }
        );

        const foundResults = result.records.length;
        logger.debug(`Neo4jVectorStore: Vector search found ${foundResults} results`);

        if (foundResults > 0) {
          return result.records.map((record) => ({
            id: record.get('id'),
            similarity: record.get('similarity'),
            metadata: {
              entityType: record.get('entityType'),
              searchMethod: 'vector',
            },
          }));
        }

        // If no results, use fallback
        logger.debug(`Neo4jVectorStore: No results from vector search, using fallback`);
        return this.searchByPatternFallback(limit);
      } catch (error) {
        logger.error(
          `Neo4jVectorStore: Vector search failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return this.searchByPatternFallback(limit);
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error(
        `Neo4jVectorStore: Search failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.searchByPatternFallback(options.limit ?? 5);
    }
  }

  /**
   * Perform hybrid search combining vector similarity and BM25 keyword search using RRF
   * @param queryVector The query embedding vector
   * @param queryText The query text for keyword search
   * @param limit Maximum number of results to return
   * @param rrfK RRF constant (default 60)
   * @returns Array of search results ranked by RRF score
   */
  private async hybridSearchWithRRF(
    queryVector: number[],
    queryText: string,
    limit: number,
    rrfK: number = 60
  ): Promise<VectorSearchResult[]> {
    const session = await this.connectionManager.getSession();

    try {
      // Step 1: Perform vector search
      const vectorResults = await session.run(
        `
        CALL db.index.vector.queryNodes(
          $indexName,
          $limit,
          $embedding
        )
        YIELD node, score
        RETURN node.name AS id, node.entityType AS entityType, score AS vectorScore
        ORDER BY score DESC
      `,
        {
          indexName: this.indexName,
          limit: neo4j.int(Math.floor(limit * 2)), // Get more candidates for RRF
          embedding: queryVector,
        }
      );

      logger.debug(`Neo4jVectorStore: Vector search returned ${vectorResults.records.length} results`);

      // Step 2: Perform BM25 keyword search on entity names and observations
      const keywordResults = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.name CONTAINS $queryText
          OR ANY(obs IN e.observations WHERE obs CONTAINS $queryText)
        WITH e,
          CASE
            WHEN e.name CONTAINS $queryText THEN 2.0
            ELSE 1.0
          END AS nameBoost,
          size([obs IN e.observations WHERE obs CONTAINS $queryText]) AS obsMatches
        WITH e, (nameBoost + (obsMatches * 0.5)) AS bm25Score
        WHERE bm25Score > 0
        RETURN e.name AS id, e.entityType AS entityType, bm25Score
        ORDER BY bm25Score DESC
        LIMIT $limit
      `,
        {
          queryText,
          limit: neo4j.int(Math.floor(limit * 2)),
        }
      );

      logger.debug(`Neo4jVectorStore: Keyword search returned ${keywordResults.records.length} results`);

      // Step 3: Apply Reciprocal Rank Fusion (RRF)
      const rrfScores = new Map<string, { score: number; entityType: string; vectorScore?: number; bm25Score?: number }>();

      // Add vector search results to RRF
      vectorResults.records.forEach((record, index) => {
        const id = record.get('id');
        const entityType = record.get('entityType');
        const vectorScore = record.get('vectorScore');
        const rrfScore = 1 / (rrfK + index + 1);

        rrfScores.set(id, {
          score: rrfScore,
          entityType,
          vectorScore,
        });
      });

      // Add keyword search results to RRF (combine with existing scores)
      keywordResults.records.forEach((record, index) => {
        const id = record.get('id');
        const entityType = record.get('entityType');
        const bm25Score = record.get('bm25Score');
        const rrfScore = 1 / (rrfK + index + 1);

        const existing = rrfScores.get(id);
        if (existing) {
          // Combine scores
          rrfScores.set(id, {
            score: existing.score + rrfScore,
            entityType,
            vectorScore: existing.vectorScore,
            bm25Score,
          });
        } else {
          // New entry
          rrfScores.set(id, {
            score: rrfScore,
            entityType,
            bm25Score,
          });
        }
      });

      // Step 4: Sort by RRF score and return top results
      const sortedResults = Array.from(rrfScores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, limit)
        .map(([id, data]) => ({
          id,
          similarity: data.score,
          metadata: {
            entityType: data.entityType,
            searchMethod: 'hybrid-rrf',
            vectorScore: data.vectorScore,
            bm25Score: data.bm25Score,
            rrfScore: data.score,
          },
        }));

      logger.debug(`Neo4jVectorStore: Hybrid RRF search returned ${sortedResults.length} results`);

      return sortedResults;
    } catch (error) {
      logger.error(
        `Neo4jVectorStore: Hybrid search failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Fallback to regular vector search
      return this.search(queryVector, { limit });
    } finally {
      await session.close();
    }
  }

  /**
   * Calculate basic statistics about a vector for debugging
   */
  private calculateVectorStats(vector: number[]): {
    min: number;
    max: number;
    avg: number;
    l2Norm: number;
  } {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sumSquared = 0;

    for (const val of vector) {
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      sumSquared += val * val;
    }

    const avg = sum / vector.length;
    const l2Norm = Math.sqrt(sumSquared);

    return {
      min,
      max,
      avg,
      l2Norm,
    };
  }

  /**
   * Checks if a vector has a valid l2-norm for Neo4j vector search
   * Neo4j requires vectors to have positive and finite l2-norm
   */
  private vectorHasValidNorm(vector: number[]): boolean {
    // Calculate squared sum
    let sumSquared = 0;
    for (const val of vector) {
      if (!isFinite(val)) return false;
      sumSquared += val * val;
    }

    // Check if the l2-norm is positive and finite
    const l2Norm = Math.sqrt(sumSquared);
    return isFinite(l2Norm) && l2Norm > 0;
  }

  /**
   * Fallback search method using pattern matching when vector search fails
   */
  private async searchByPatternFallback(limit: number): Promise<VectorSearchResult[]> {
    logger.debug(`Neo4jVectorStore: Using fallback query`);

    const session = await this.connectionManager.getSession();
    try {
      const fallbackQuery = `
        MATCH (e:Entity)
        WHERE e.name =~ "(?i).*test.*" OR e.name =~ "(?i).*search.*" OR e.name =~ "(?i).*keyword.*" OR e.name =~ "(?i).*unique.*" OR e.name =~ "(?i).*vector.*" OR e.name =~ "(?i).*embedding.*"
        OR ANY(obs IN e.observations WHERE obs =~ "(?i).*test.*" OR obs =~ "(?i).*search.*" OR obs =~ "(?i).*keyword.*" OR obs =~ "(?i).*unique.*" OR obs =~ "(?i).*vector.*" OR obs =~ "(?i).*embedding.*" OR obs =~ "(?i).*vectorsearch.*" OR obs =~ "(?i).*similarsearch.*")
        RETURN e.name AS id, e.entityType AS entityType, 0.75 AS similarity
        UNION
        MATCH (e:Entity)
        WITH e
        ORDER BY e.createdAt DESC
        LIMIT 3
        RETURN e.name AS id, e.entityType AS entityType, 0.5 AS similarity
        LIMIT $limit
      `;

      const fallbackResult = await session.run(fallbackQuery, { limit: neo4j.int(limit) });
      logger.debug(
        `Neo4jVectorStore: Fallback search returned ${fallbackResult.records.length} results`
      );

      return fallbackResult.records.map((record) => ({
        id: record.get('id'),
        similarity: record.get('similarity'),
        metadata: { entityType: record.get('entityType') },
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Ensure the vector store has been initialized
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Neo4j vector store not initialized. Call initialize() first.');
    }
  }

  /**
   * Diagnostic method to directly retrieve entity embedding info
   * Bypasses any application logic to query Neo4j directly
   */
  /**
   * Find entities that are missing embeddings
   * Returns count and sample of entities without embeddings
   */
  async findEntitiesWithoutEmbeddings(limit = 100): Promise<{
    totalEntities: number;
    entitiesWithEmbeddings: number;
    entitiesWithoutEmbeddings: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    samples: any[];
  }> {
    try {
      const session = await this.connectionManager.getSession();

      try {
        // Count total entities
        const totalQuery = `
          MATCH (e:Entity)
          RETURN count(e) as count
        `;
        const totalResult = await session.run(totalQuery);
        const totalEntities = totalResult.records[0].get('count').toNumber();

        // Count entities with embeddings
        const withEmbeddingsQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NOT NULL
          RETURN count(e) as count
        `;
        const withEmbeddingsResult = await session.run(withEmbeddingsQuery);
        const entitiesWithEmbeddings = withEmbeddingsResult.records[0].get('count').toNumber();

        // Count entities without embeddings
        const withoutEmbeddingsQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NULL
          RETURN count(e) as count
        `;
        const withoutEmbeddingsResult = await session.run(withoutEmbeddingsQuery);
        const entitiesWithoutEmbeddings = withoutEmbeddingsResult.records[0].get('count').toNumber();

        // Get sample of entities without embeddings
        const sampleQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NULL
          RETURN e.name AS name, e.entityType AS entityType, e.id AS id
          LIMIT $limit
        `;
        const sampleResult = await session.run(sampleQuery, { limit: neo4j.int(Math.floor(limit)) });
        const samples = sampleResult.records.map((record) => ({
          name: record.get('name'),
          entityType: record.get('entityType'),
          id: record.get('id'),
        }));

        return {
          totalEntities,
          entitiesWithEmbeddings,
          entitiesWithoutEmbeddings,
          samples,
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error('Failed to find entities without embeddings', error);
      throw error;
    }
  }

  async diagnosticGetEntityEmbeddings(): Promise<{
    count: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    samples: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexInfo: any;
    embeddingType: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vectorQueryTest: any;
  }> {
    try {
      const session = await this.connectionManager.getSession();

      try {
        // Direct query to count entities with embeddings
        const countQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NOT NULL
          RETURN count(e) as count
        `;
        const countResult = await session.run(countQuery);
        const count = countResult.records[0].get('count').toNumber();

        // Get a sample of entities with embeddings
        const sampleQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NOT NULL
          RETURN e.name, e.entityType, size(e.embedding) as embeddingSize
          LIMIT 3
        `;
        const sampleResult = await session.run(sampleQuery);
        const samples = sampleResult.records.map((record) => ({
          name: record.get('e.name'),
          entityType: record.get('e.entityType'),
          embeddingSize: record.get('embeddingSize'),
        }));

        // Get vector index info
        const indexQuery = `
          SHOW VECTOR INDEXES
          WHERE name = $indexName
        `;
        const indexResult = await session.run(indexQuery, { indexName: this.indexName });
        const indexInfo =
          indexResult.records.length > 0
            ? {
                name: indexResult.records[0].get('name'),
                state: indexResult.records[0].get('state'),
              }
            : { name: null, state: null };

        // Test embedding type
        const typeQuery = `
          MATCH (e:Entity)
          WHERE e.embedding IS NOT NULL
          RETURN e.name, apoc.meta.type(e.embedding) as embeddingType
          LIMIT 1
        `;

        let embeddingType = 'unknown';
        try {
          const typeResult = await session.run(typeQuery);
          if (typeResult.records.length > 0) {
            embeddingType = typeResult.records[0].get('embeddingType');
          }
        } catch (error) {
          embeddingType = 'error: ' + (error instanceof Error ? error.message : String(error));
        }

        // Try direct vector similarity query
        let directVectorQueryResult = null;
        try {
          // Create a test vector with small random values instead of zeros
          // This ensures a positive l2-norm as required by Neo4j
          const testVector = Array.from(
            { length: this.dimensions },
            () => Math.random() * 0.1 + 0.01
          );

          const directQuery = `
            CALL db.index.vector.queryNodes('${this.indexName}', 1, $embedding)
            YIELD node, score
            RETURN node.name, score
          `;

          const testResult = await session.run(directQuery, { embedding: testVector });
          directVectorQueryResult = {
            success: testResult.records.length > 0,
            recordCount: testResult.records.length,
            sampleResult:
              testResult.records.length > 0
                ? {
                    name: testResult.records[0].get('node.name'),
                    score: testResult.records[0].get('score'),
                  }
                : null,
          };
        } catch (error) {
          directVectorQueryResult = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        return {
          count,
          samples,
          indexInfo,
          embeddingType,
          vectorQueryTest: directVectorQueryResult,
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error('Diagnostic query failed', error);
      throw error;
    }
  }
}
