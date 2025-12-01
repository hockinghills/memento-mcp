/**
 * Embedding Configuration Validator
 *
 * Validates and reports on embedding configuration at startup
 */

import { getModelDimensions, OPENAI_MODEL_DIMENSIONS } from '../embeddings/config.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  config: EmbeddingConfigSummary;
}

/**
 * Summary of effective embedding configuration
 */
export interface EmbeddingConfigSummary {
  provider: string;
  model: string;
  dimensions: number;
  dimensionsSource: string;
  vectorIndexDimensions: number;
  vectorIndexSource: string;
  dimensionsMatch: boolean;
  apiKeyConfigured: boolean;
  mockEmbeddings: boolean;
}

/**
 * Validates embedding configuration and checks for potential issues
 */
export class EmbeddingConfigValidator {
  /**
   * Validate the current embedding configuration
   *
   * @returns Validation result with warnings and errors
   */
  static validate(): ConfigValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Determine if using mock embeddings
    const mockEmbeddings = process.env.MOCK_EMBEDDINGS === 'true';

    // Check API key
    const apiKeyConfigured = !!process.env.OPENAI_API_KEY;

    // Determine embedding model
    const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    // Check if model is recognized
    const isRecognizedModel = embeddingModel in OPENAI_MODEL_DIMENSIONS;
    if (!isRecognizedModel && !mockEmbeddings) {
      warnings.push(
        `Unrecognized embedding model "${embeddingModel}". ` +
        `Known models: ${Object.keys(OPENAI_MODEL_DIMENSIONS).join(', ')}`
      );
    }

    // Determine embedding dimensions
    let embeddingDimensions: number;
    let dimensionsSource: string;

    if (process.env.OPENAI_EMBEDDING_DIMENSIONS) {
      embeddingDimensions = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS, 10);
      dimensionsSource = 'OPENAI_EMBEDDING_DIMENSIONS env var';

      // Validate it's a number
      if (isNaN(embeddingDimensions)) {
        errors.push(
          `Invalid OPENAI_EMBEDDING_DIMENSIONS: "${process.env.OPENAI_EMBEDDING_DIMENSIONS}" is not a number`
        );
        embeddingDimensions = getModelDimensions(embeddingModel);
        dimensionsSource = `fallback: inferred from model ${embeddingModel}`;
      }
    } else {
      embeddingDimensions = getModelDimensions(embeddingModel);
      dimensionsSource = `inferred from model ${embeddingModel}`;
    }

    // Determine vector index dimensions
    let vectorIndexDimensions: number;
    let vectorIndexSource: string;

    if (process.env.NEO4J_VECTOR_DIMENSIONS) {
      vectorIndexDimensions = parseInt(process.env.NEO4J_VECTOR_DIMENSIONS, 10);
      vectorIndexSource = 'NEO4J_VECTOR_DIMENSIONS env var';

      // Validate it's a number
      if (isNaN(vectorIndexDimensions)) {
        errors.push(
          `Invalid NEO4J_VECTOR_DIMENSIONS: "${process.env.NEO4J_VECTOR_DIMENSIONS}" is not a number`
        );
        vectorIndexDimensions = embeddingDimensions;
        vectorIndexSource = `fallback: matching embedding dimensions (${embeddingDimensions})`;
      }
    } else {
      vectorIndexDimensions = embeddingDimensions;
      vectorIndexSource = `inferred from embedding config (${embeddingDimensions})`;
    }

    // Check if dimensions match
    const dimensionsMatch = embeddingDimensions === vectorIndexDimensions;
    if (!dimensionsMatch) {
      errors.push(
        `Embedding dimensions mismatch! ` +
        `Embedding service will generate ${embeddingDimensions}D vectors, ` +
        `but vector index expects ${vectorIndexDimensions}D vectors. ` +
        `This will cause vector storage and search to fail.`
      );
    }

    // Check if API key is missing (unless using mocks)
    if (!apiKeyConfigured && !mockEmbeddings) {
      warnings.push(
        'No OPENAI_API_KEY configured. Embedding generation will use fallback/mock service.'
      );
    }

    // Warn about mock embeddings in production
    if (mockEmbeddings) {
      warnings.push(
        'MOCK_EMBEDDINGS=true is set. Using mock embedding service (not suitable for production).'
      );
    }

    // Check for conflicting dimension configurations
    if (process.env.OPENAI_EMBEDDING_DIMENSIONS && process.env.NEO4J_VECTOR_DIMENSIONS) {
      const embDims = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS, 10);
      const vectorDims = parseInt(process.env.NEO4J_VECTOR_DIMENSIONS, 10);

      if (embDims !== vectorDims) {
        warnings.push(
          `Both OPENAI_EMBEDDING_DIMENSIONS (${embDims}) and NEO4J_VECTOR_DIMENSIONS (${vectorDims}) are set ` +
          `with different values. This is likely unintentional.`
        );
      }
    }

    const config: EmbeddingConfigSummary = {
      provider: mockEmbeddings ? 'mock' : 'openai',
      model: embeddingModel,
      dimensions: embeddingDimensions,
      dimensionsSource,
      vectorIndexDimensions,
      vectorIndexSource,
      dimensionsMatch,
      apiKeyConfigured,
      mockEmbeddings,
    };

    const isValid = errors.length === 0;

    return {
      isValid,
      warnings,
      errors,
      config,
    };
  }

  /**
   * Log the validation results in a human-readable format
   *
   * @param result - Validation result to log
   */
  static logValidationResult(result: ConfigValidationResult): void {
    logger.info('=== Embedding Configuration ===');
    logger.info(`Provider: ${result.config.provider}`);
    logger.info(`Model: ${result.config.model}`);
    logger.info(`Embedding Dimensions: ${result.config.dimensions}D (${result.config.dimensionsSource})`);
    logger.info(`Vector Index Dimensions: ${result.config.vectorIndexDimensions}D (${result.config.vectorIndexSource})`);
    logger.info(`Dimensions Match: ${result.config.dimensionsMatch ? '✓ Yes' : '✗ No'}`);
    logger.info(`API Key Configured: ${result.config.apiKeyConfigured ? 'Yes' : 'No'}`);
    logger.info(`Mock Embeddings: ${result.config.mockEmbeddings ? 'Yes' : 'No'}`);

    if (result.warnings.length > 0) {
      logger.warn('=== Configuration Warnings ===');
      result.warnings.forEach((warning, index) => {
        logger.warn(`${index + 1}. ${warning}`);
      });
    }

    if (result.errors.length > 0) {
      logger.error('=== Configuration Errors ===');
      result.errors.forEach((error, index) => {
        logger.error(`${index + 1}. ${error}`);
      });
    }

    if (result.isValid && result.warnings.length === 0) {
      logger.info('=== Configuration Status: ✓ Valid ===');
    } else if (result.isValid) {
      logger.warn('=== Configuration Status: ⚠️  Valid with warnings ===');
    } else {
      logger.error('=== Configuration Status: ✗ Invalid ===');
    }
  }

  /**
   * Perform validation and log results
   * Throws an error if configuration is invalid
   *
   * @param throwOnError - Whether to throw an error if validation fails
   * @returns Validation result
   */
  static validateAndLog(throwOnError = false): ConfigValidationResult {
    const result = this.validate();
    this.logValidationResult(result);

    if (!result.isValid && throwOnError) {
      throw new Error(
        'Invalid embedding configuration. ' +
        'Please fix the errors above before starting the server.'
      );
    }

    return result;
  }

  /**
   * Get a human-readable configuration summary for display
   *
   * @returns Configuration summary string
   */
  static getConfigSummary(): string {
    const result = this.validate();
    const config = result.config;

    const lines = [
      '=== Embedding Configuration Summary ===',
      `Provider: ${config.provider}`,
      `Model: ${config.model}`,
      `Dimensions: ${config.dimensions}D (${config.dimensionsSource})`,
      `Vector Index: ${config.vectorIndexDimensions}D (${config.vectorIndexSource})`,
      `Status: ${result.isValid ? '✓ Valid' : '✗ Invalid'}`,
    ];

    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      result.warnings.forEach(w => lines.push(`  - ${w}`));
    }

    if (result.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      result.errors.forEach(e => lines.push(`  - ${e}`));
    }

    return lines.join('\n');
  }

  /**
   * Get environment variable recommendations based on current configuration
   *
   * @returns Recommended environment variable settings
   */
  static getRecommendations(): string[] {
    const result = this.validate();
    const recommendations: string[] = [];

    if (!result.isValid) {
      recommendations.push('Fix configuration errors before starting:');

      if (!result.config.dimensionsMatch) {
        recommendations.push(
          `  Set NEO4J_VECTOR_DIMENSIONS=${result.config.dimensions} to match embedding dimensions`
        );
      }
    }

    if (result.warnings.length > 0) {
      if (!result.config.apiKeyConfigured && !result.config.mockEmbeddings) {
        recommendations.push(
          '  Set OPENAI_API_KEY to enable real embedding generation'
        );
      }

      if (result.config.mockEmbeddings) {
        recommendations.push(
          '  Remove MOCK_EMBEDDINGS=true for production use'
        );
      }
    }

    // Best practices
    recommendations.push('');
    recommendations.push('Best practices:');
    recommendations.push(
      `  - Use OPENAI_EMBEDDING_MODEL to specify the model (current: ${result.config.model})`
    );
    recommendations.push(
      '  - Let dimensions auto-configure from the model (recommended)'
    );
    recommendations.push(
      '  - Only set NEO4J_VECTOR_DIMENSIONS if overriding is necessary'
    );

    return recommendations;
  }
}
