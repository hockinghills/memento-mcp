import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getModelDimensions } from '../../embeddings/config.js';

// Load .env before defining DEFAULT_NEO4J_CONFIG
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') });

/**
 * Configuration options for Neo4j
 */
export interface Neo4jConfig {
  /**
   * The Neo4j server URI (e.g., 'bolt://localhost:7687')
   */
  uri: string;

  /**
   * Username for authentication
   */
  username: string;

  /**
   * Password for authentication
   */
  password: string;

  /**
   * Neo4j database name
   */
  database: string;

  /**
   * Name of the vector index
   */
  vectorIndexName: string;

  /**
   * Dimensions for vector embeddings
   */
  vectorDimensions: number;

  /**
   * Similarity function to use for vector search
   */
  similarityFunction: 'cosine' | 'euclidean';
}

/**
 * Get default vector dimensions from environment or model configuration
 */
function getDefaultVectorDimensions(): number {
  // Check if explicitly set via NEO4J_VECTOR_DIMENSIONS
  if (process.env.NEO4J_VECTOR_DIMENSIONS) {
    return parseInt(process.env.NEO4J_VECTOR_DIMENSIONS, 10);
  }
  // Otherwise, derive from the configured embedding model
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  return getModelDimensions(embeddingModel);
}

/**
 * Default Neo4j configuration - reads from environment variables
 */
export const DEFAULT_NEO4J_CONFIG: Neo4jConfig = {
  uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  username: process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.NEO4J_PASSWORD || 'memento_password',
  database: process.env.NEO4J_DATABASE || 'neo4j',
  vectorIndexName: process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings',
  vectorDimensions: getDefaultVectorDimensions(),
  similarityFunction: (process.env.NEO4J_SIMILARITY_FUNCTION as 'cosine' | 'euclidean') || 'cosine',
};
