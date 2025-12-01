import { CohereClientV2 } from 'cohere-ai';
import { logger } from '../utils/logger.js';
import type { VectorSearchResult } from '../types/vector-store.js';

/**
 * Configuration for Cohere reranking service
 */
export interface CohereRerankingConfig {
  /**
   * Cohere API key
   */
  apiKey: string;

  /**
   * Optional model to use for reranking
   */
  model?: string;

  /**
   * Optional top N results to return after reranking
   */
  topN?: number;
}

/**
 * Document to be reranked
 */
export interface RerankDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result from reranking
 */
export interface RerankResult {
  id: string;
  score: number;
  relevanceScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * Service for reranking search results using Cohere's rerank API
 */
export class CohereRerankingService {
  private client: CohereClientV2;
  private model: string;
  private topN?: number;

  /**
   * Create a new Cohere reranking service
   *
   * @param config - Configuration for the service
   */
  constructor(config: CohereRerankingConfig) {
    if (!config) {
      throw new Error('Configuration is required for Cohere reranking service');
    }

    if (!config.apiKey && !process.env.COHERE_API_KEY) {
      throw new Error('API key is required for Cohere reranking service');
    }

    const apiKey = config.apiKey || process.env.COHERE_API_KEY || '';
    this.client = new CohereClientV2({ token: apiKey });

    // Default to rerank-english-v3.0 model
    this.model = config.model || process.env.COHERE_RERANK_MODEL || 'rerank-english-v3.0';
    this.topN = config.topN;

    logger.debug('CohereRerankingService initialized', {
      model: this.model,
      topN: this.topN,
    });
  }

  /**
   * Rerank a list of documents based on query relevance
   *
   * @param query - Search query text
   * @param documents - Documents to rerank
   * @param topN - Optional override for number of results to return
   * @returns Reranked results with relevance scores
   */
  async rerank(
    query: string,
    documents: RerankDocument[],
    topN?: number
  ): Promise<RerankResult[]> {
    if (!documents || documents.length === 0) {
      logger.debug('No documents to rerank');
      return [];
    }

    const resultCount = topN || this.topN || documents.length;

    logger.debug('Reranking documents', {
      query: query.substring(0, 50) + '...',
      documentCount: documents.length,
      model: this.model,
      topN: resultCount,
    });

    try {
      // Convert documents to text array for Cohere API
      const documentTexts = documents.map((doc) => doc.text);

      // Call Cohere rerank API
      const response = await this.client.rerank({
        query,
        documents: documentTexts,
        model: this.model,
        topN: resultCount,
      });

      if (!response || !response.results) {
        logger.error('Invalid response from Cohere rerank API', { response });
        throw new Error('Invalid response from Cohere rerank API');
      }

      logger.debug('Rerank complete', {
        originalCount: documents.length,
        returnedCount: response.results.length,
      });

      // Map Cohere results back to our documents with relevance scores
      const rerankedResults: RerankResult[] = response.results.map((result) => {
        const originalDoc = documents[result.index];
        return {
          id: originalDoc.id,
          score: originalDoc.metadata?.originalScore as number,
          relevanceScore: result.relevanceScore,
          metadata: {
            ...originalDoc.metadata,
            rerankScore: result.relevanceScore,
            rerankIndex: result.index,
          },
        };
      });

      return rerankedResults;
    } catch (error: unknown) {
      const errorMessage = this._getErrorMessage(error);
      logger.error('Failed to rerank documents', { error: errorMessage });

      // Handle specific error types
      if (errorMessage.includes('401') || errorMessage.includes('authentication')) {
        throw new Error('Cohere API authentication failed - invalid API key');
      } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        throw new Error('Cohere API rate limit exceeded - try again later');
      } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
        throw new Error('Cohere API server error - try again later');
      }

      throw new Error(`Error reranking documents: ${errorMessage}`);
    }
  }

  /**
   * Rerank vector search results
   *
   * @param query - Original search query
   * @param results - Vector search results to rerank
   * @param entityTexts - Map of entity IDs to their text content
   * @param topN - Optional override for number of results to return
   * @returns Reranked vector search results
   */
  async rerankVectorSearchResults(
    query: string,
    results: VectorSearchResult[],
    entityTexts: Map<string, string>,
    topN?: number
  ): Promise<VectorSearchResult[]> {
    if (!results || results.length === 0) {
      logger.debug('No vector search results to rerank');
      return [];
    }

    // Convert vector search results to rerank documents
    const documents: RerankDocument[] = results.map((result) => {
      const text = entityTexts.get(String(result.id)) || String(result.id);
      return {
        id: String(result.id),
        text,
        metadata: {
          ...result.metadata,
          originalScore: result.similarity,
        },
      };
    });

    // Rerank
    const rerankedResults = await this.rerank(query, documents, topN);

    // Convert back to VectorSearchResult format
    return rerankedResults.map((result) => ({
      id: result.id,
      similarity: result.relevanceScore,
      metadata: {
        ...result.metadata,
        originalSimilarity: result.score,
        searchMethod: 'vector+rerank',
      },
    }));
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
