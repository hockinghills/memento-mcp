/**
 * Configuration for the embedding subsystem
 */

/**
 * Mapping of OpenAI embedding model names to their vector dimensions
 */
export const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * Mapping of Voyage AI embedding model names to their vector dimensions
 * Note: voyage-3 models support configurable dimensions via output_dimension parameter
 */
export const VOYAGE_MODEL_DIMENSIONS: Record<string, number> = {
  'voyage-3': 1024,
  'voyage-3-large': 1024,
  'voyage-3-lite': 512,
  'voyage-finance-2': 1024,
  'voyage-multilingual-2': 1024,
  'voyage-law-2': 1024,
  'voyage-code-2': 1536,
  'voyage-2': 1024,
  'voyage-large-2': 1536,
  'voyage-large-2-instruct': 1024,
};

/**
 * Get the vector dimensions for a given embedding model
 * Supports both OpenAI and Voyage AI models
 * @param modelName - Name of the embedding model
 * @returns Number of dimensions for the model, or 1536 as default
 */
export function getModelDimensions(modelName: string): number {
  // Check Voyage AI models first
  if (modelName.startsWith('voyage-')) {
    return VOYAGE_MODEL_DIMENSIONS[modelName] || 1024;
  }
  // Check OpenAI models
  return OPENAI_MODEL_DIMENSIONS[modelName] || 1536;
}

/**
 * Default settings for embedding job processing
 */
export const DEFAULT_EMBEDDING_SETTINGS = {
  /**
   * Maximum batch size for processing embedding jobs
   * Larger batches may be more efficient but use more memory
   */
  BATCH_SIZE: 10,

  /**
   * Minimum time in milliseconds between API calls (rate limiting)
   */
  API_RATE_LIMIT_MS: 1000,

  /**
   * Time-to-live in milliseconds for cached embeddings (default: 30 days)
   */
  CACHE_TTL_MS: 30 * 24 * 60 * 60 * 1000,

  /**
   * Maximum number of entries to keep in the embedding cache
   */
  CACHE_MAX_SIZE: 1000,

  /**
   * Minimum age in milliseconds for jobs to be eligible for cleanup
   * Default: 30 days
   */
  JOB_CLEANUP_AGE_MS: 30 * 24 * 60 * 60 * 1000,

  /**
   * Status options for embedding jobs
   */
  JOB_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
  },
};

/**
 * Configuration for the LRU cache used for embeddings
 */
export interface EmbeddingCacheOptions {
  /**
   * Maximum number of items to keep in the cache
   */
  max: number;

  /**
   * Time-to-live in milliseconds for cache entries
   */
  ttl: number;
}

/**
 * Configuration for embedding job processing
 */
export interface EmbeddingJobProcessingOptions {
  /**
   * Maximum number of jobs to process in a single batch
   */
  batchSize: number;

  /**
   * Minimum time in milliseconds between API calls
   */
  apiRateLimitMs: number;

  /**
   * Maximum age in milliseconds for jobs to be eligible for cleanup
   */
  jobCleanupAgeMs: number;
}

/**
 * Get configuration for the LRU cache for embeddings
 *
 * @param options - Optional overrides for cache settings
 * @returns Configuration object for the LRU cache
 */
export function getEmbeddingCacheConfig(
  options: Partial<EmbeddingCacheOptions> = {}
): EmbeddingCacheOptions {
  return {
    max: options.max || DEFAULT_EMBEDDING_SETTINGS.CACHE_MAX_SIZE,
    ttl: options.ttl || DEFAULT_EMBEDDING_SETTINGS.CACHE_TTL_MS,
  };
}

/**
 * Get configuration for embedding job processing
 *
 * @param options - Optional overrides for job processing settings
 * @returns Configuration object for job processing
 */
export function getJobProcessingConfig(
  options: Partial<EmbeddingJobProcessingOptions> = {}
): EmbeddingJobProcessingOptions {
  return {
    batchSize: options.batchSize || DEFAULT_EMBEDDING_SETTINGS.BATCH_SIZE,
    apiRateLimitMs: options.apiRateLimitMs || DEFAULT_EMBEDDING_SETTINGS.API_RATE_LIMIT_MS,
    jobCleanupAgeMs: options.jobCleanupAgeMs || DEFAULT_EMBEDDING_SETTINGS.JOB_CLEANUP_AGE_MS,
  };
}
