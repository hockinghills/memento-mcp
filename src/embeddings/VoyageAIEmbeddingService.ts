import { VoyageAIClient } from 'voyageai';
import { EmbeddingService, type EmbeddingModelInfo } from './EmbeddingService.js';
import { logger } from '../utils/logger.js';
import { getModelDimensions } from './config.js';

/**
 * Configuration for Voyage AI embedding service
 */
export interface VoyageAIEmbeddingConfig {
  /**
   * Voyage AI API key
   */
  apiKey: string;

  /**
   * Optional model name to use
   */
  model?: string;

  /**
   * Optional dimensions override (for voyage-3 models)
   */
  dimensions?: number;

  /**
   * Optional version string
   */
  version?: string;

  /**
   * Optional input type hint for the embeddings
   * Options: 'query', 'document'
   */
  inputType?: 'query' | 'document';
}

/**
 * Service implementation that generates embeddings using Voyage AI's API
 */
export class VoyageAIEmbeddingService extends EmbeddingService {
  private client: VoyageAIClient;
  private model: string;
  private dimensions: number;
  private version: string;
  private inputType: 'query' | 'document';

  /**
   * Create a new Voyage AI embedding service
   *
   * @param config - Configuration for the service
   */
  constructor(config: VoyageAIEmbeddingConfig) {
    super();

    if (!config) {
      throw new Error('Configuration is required for Voyage AI embedding service');
    }

    // Only require API key in non-test environments and when it's not provided in env
    if (!config.apiKey && !process.env.VOYAGE_API_KEY) {
      throw new Error('API key is required for Voyage AI embedding service');
    }

    const apiKey = config.apiKey || process.env.VOYAGE_API_KEY || '';
    this.client = new VoyageAIClient({ apiKey });

    // Get model from config, env var, or default to voyage-3-large
    this.model = config.model || process.env.VOYAGE_EMBEDDING_MODEL || 'voyage-3-large';

    // Automatically determine dimensions from model name unless explicitly overridden
    this.dimensions = config.dimensions || getModelDimensions(this.model);

    this.version = config.version || '3.0.0';
    this.inputType = config.inputType || 'document';

    logger.debug('VoyageAIEmbeddingService initialized', {
      model: this.model,
      dimensions: this.dimensions,
      inputType: this.inputType,
    });
  }

  /**
   * Generate an embedding for a single text
   *
   * @param text - Text to generate embedding for
   * @returns Promise resolving to embedding vector
   */
  override async generateEmbedding(text: string): Promise<number[]> {
    logger.debug('Generating Voyage AI embedding', {
      text: text.substring(0, 50) + '...',
      model: this.model,
      dimensions: this.dimensions,
    });

    try {
      // Prepare embed parameters
      const embedParams: {
        input: string[];
        model: string;
        inputType?: 'query' | 'document';
        outputDimension?: number;
      } = {
        input: [text],
        model: this.model,
      };

      // Add input type if specified
      if (this.inputType) {
        embedParams.inputType = this.inputType;
      }

      // Add output dimension for voyage-3 models (supports dimension reduction)
      if (this.model.startsWith('voyage-3') && this.dimensions) {
        embedParams.outputDimension = this.dimensions;
      }

      const response = await this.client.embed(embedParams);

      logger.debug('Received response from Voyage AI API');

      if (!response || !response.data || !response.data[0] || !response.data[0].embedding) {
        logger.error('Invalid response from Voyage AI API', { response });
        throw new Error('Invalid response from Voyage AI API - missing embedding data');
      }

      const embedding = response.data[0].embedding;

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        logger.error('Invalid embedding returned', { embedding });
        throw new Error('Invalid embedding returned from Voyage AI API');
      }

      logger.debug('Generated embedding', {
        length: embedding.length,
        sample: embedding.slice(0, 5),
        isArray: Array.isArray(embedding),
      });

      // Voyage AI embeddings are already normalized
      logger.debug('Voyage AI embeddings are pre-normalized');

      return embedding;
    } catch (error: unknown) {
      const errorMessage = this._getErrorMessage(error);
      logger.error('Failed to generate embedding', { error: errorMessage });

      // Handle specific error types
      if (errorMessage.includes('401') || errorMessage.includes('authentication')) {
        throw new Error('Voyage AI API authentication failed - invalid API key');
      } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        throw new Error('Voyage AI API rate limit exceeded - try again later');
      } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
        throw new Error('Voyage AI API server error - try again later');
      }

      throw new Error(`Error generating embedding: ${errorMessage}`);
    }
  }

  /**
   * Generate embeddings for multiple texts
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Promise resolving to array of embedding vectors
   */
  override async generateEmbeddings(texts: string[]): Promise<number[][]> {
    logger.debug('Generating batch embeddings', {
      count: texts.length,
      model: this.model,
    });

    try {
      // Prepare embed parameters
      const embedParams: {
        input: string[];
        model: string;
        inputType?: 'query' | 'document';
        outputDimension?: number;
      } = {
        input: texts,
        model: this.model,
      };

      // Add input type if specified
      if (this.inputType) {
        embedParams.inputType = this.inputType;
      }

      // Add output dimension for voyage-3 models (supports dimension reduction)
      if (this.model.startsWith('voyage-3') && this.dimensions) {
        embedParams.outputDimension = this.dimensions;
      }

      const response = await this.client.embed(embedParams);

      if (!response || !response.data || response.data.length === 0) {
        throw new Error('Invalid response from Voyage AI API - no embeddings returned');
      }

      const embeddings = response.data.map((item) => {
        if (!item.embedding || !Array.isArray(item.embedding)) {
          throw new Error('Invalid embedding in batch response');
        }
        return item.embedding;
      });

      logger.debug('Generated batch embeddings', {
        count: embeddings.length,
        dimensions: embeddings[0]?.length,
      });

      return embeddings;
    } catch (error: unknown) {
      const errorMessage = this._getErrorMessage(error);
      throw new Error(`Failed to generate embeddings: ${errorMessage}`);
    }
  }

  /**
   * Get information about the embedding model
   *
   * @returns Model information
   */
  override getModelInfo(): EmbeddingModelInfo {
    return {
      name: this.model,
      dimensions: this.dimensions,
      version: this.version,
    };
  }

  /**
   * Get provider information
   *
   * @returns Provider information
   */
  override getProviderInfo() {
    return {
      provider: 'voyageai',
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  /**
   * Extract error message from error object
   *
   * @private
   * @param error - Error object
   * @returns Error message string
   */
  private _getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
