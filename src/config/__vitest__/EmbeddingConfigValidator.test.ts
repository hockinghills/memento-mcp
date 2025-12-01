import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbeddingConfigValidator } from '../EmbeddingConfigValidator.js';

describe('EmbeddingConfigValidator', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_EMBEDDING_DIMENSIONS;
    delete process.env.NEO4J_VECTOR_DIMENSIONS;
    delete process.env.MOCK_EMBEDDINGS;
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe('validate()', () => {
    it('should validate with default configuration', () => {
      const result = EmbeddingConfigValidator.validate();

      expect(result.config.provider).toBe('openai');
      expect(result.config.model).toBe('text-embedding-3-small');
      expect(result.config.dimensions).toBe(1536);
      expect(result.config.vectorIndexDimensions).toBe(1536);
      expect(result.config.dimensionsMatch).toBe(true);
      expect(result.warnings).toContain(
        'No OPENAI_API_KEY configured. Embedding generation will use fallback/mock service.'
      );
    });

    it('should detect dimension mismatch between embedding and vector index', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
      process.env.NEO4J_VECTOR_DIMENSIONS = '1536';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(3072);
      expect(result.config.vectorIndexDimensions).toBe(1536);
      expect(result.config.dimensionsMatch).toBe(false);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Embedding dimensions mismatch')
      );
    });

    it('should use OPENAI_EMBEDDING_MODEL to determine dimensions', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.model).toBe('text-embedding-3-large');
      expect(result.config.dimensions).toBe(3072);
      expect(result.config.dimensionsSource).toContain('inferred from model');
    });

    it('should override dimensions with OPENAI_EMBEDDING_DIMENSIONS', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '768';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(768);
      expect(result.config.dimensionsSource).toBe('OPENAI_EMBEDDING_DIMENSIONS env var');
    });

    it('should inherit vector index dimensions from embedding dimensions', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(3072);
      expect(result.config.vectorIndexDimensions).toBe(3072);
      expect(result.config.vectorIndexSource).toContain('inferred from embedding config');
      expect(result.config.dimensionsMatch).toBe(true);
    });

    it('should override vector index dimensions with NEO4J_VECTOR_DIMENSIONS', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
      process.env.NEO4J_VECTOR_DIMENSIONS = '3072';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.vectorIndexDimensions).toBe(3072);
      expect(result.config.vectorIndexSource).toBe('NEO4J_VECTOR_DIMENSIONS env var');
    });

    it('should detect invalid OPENAI_EMBEDDING_DIMENSIONS', () => {
      process.env.OPENAI_EMBEDDING_DIMENSIONS = 'not-a-number';

      const result = EmbeddingConfigValidator.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Invalid OPENAI_EMBEDDING_DIMENSIONS')
      );
    });

    it('should detect invalid NEO4J_VECTOR_DIMENSIONS', () => {
      process.env.NEO4J_VECTOR_DIMENSIONS = 'not-a-number';

      const result = EmbeddingConfigValidator.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Invalid NEO4J_VECTOR_DIMENSIONS')
      );
    });

    it('should warn about unrecognized model', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'unknown-model';

      const result = EmbeddingConfigValidator.validate();

      expect(result.warnings).toContainEqual(
        expect.stringContaining('Unrecognized embedding model')
      );
    });

    it('should detect mock embeddings mode', () => {
      process.env.MOCK_EMBEDDINGS = 'true';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.provider).toBe('mock');
      expect(result.config.mockEmbeddings).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('MOCK_EMBEDDINGS=true')
      );
    });

    it('should not warn about missing API key when using mocks', () => {
      process.env.MOCK_EMBEDDINGS = 'true';

      const result = EmbeddingConfigValidator.validate();

      const apiKeyWarning = result.warnings.find(w =>
        w.includes('No OPENAI_API_KEY configured')
      );
      expect(apiKeyWarning).toBeUndefined();
    });

    it('should be valid with API key configured', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.apiKeyConfigured).toBe(true);
      const apiKeyWarning = result.warnings.find(w =>
        w.includes('No OPENAI_API_KEY configured')
      );
      expect(apiKeyWarning).toBeUndefined();
    });

    it('should warn when both dimension env vars are set with different values', () => {
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '1536';
      process.env.NEO4J_VECTOR_DIMENSIONS = '3072';

      const result = EmbeddingConfigValidator.validate();

      expect(result.warnings).toContainEqual(
        expect.stringContaining('Both OPENAI_EMBEDDING_DIMENSIONS')
      );
    });

    it('should not warn when both dimension env vars match', () => {
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '3072';
      process.env.NEO4J_VECTOR_DIMENSIONS = '3072';

      const result = EmbeddingConfigValidator.validate();

      const bothSetWarning = result.warnings.find(w =>
        w.includes('Both OPENAI_EMBEDDING_DIMENSIONS')
      );
      expect(bothSetWarning).toBeUndefined();
    });

    it('should handle text-embedding-ada-002 model', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-ada-002';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.model).toBe('text-embedding-ada-002');
      expect(result.config.dimensions).toBe(1536);
    });

    it('should handle text-embedding-3-small model', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.model).toBe('text-embedding-3-small');
      expect(result.config.dimensions).toBe(1536);
    });

    it('should handle text-embedding-3-large model', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.model).toBe('text-embedding-3-large');
      expect(result.config.dimensions).toBe(3072);
    });
  });

  describe('getConfigSummary()', () => {
    it('should return formatted summary', () => {
      const summary = EmbeddingConfigValidator.getConfigSummary();

      expect(summary).toContain('=== Embedding Configuration Summary ===');
      expect(summary).toContain('Provider:');
      expect(summary).toContain('Model:');
      expect(summary).toContain('Dimensions:');
    });

    it('should include errors in summary', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
      process.env.NEO4J_VECTOR_DIMENSIONS = '1536';

      const summary = EmbeddingConfigValidator.getConfigSummary();

      expect(summary).toContain('Errors:');
      expect(summary).toContain('mismatch');
    });
  });

  describe('getRecommendations()', () => {
    it('should recommend fixing dimension mismatch', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
      process.env.NEO4J_VECTOR_DIMENSIONS = '1536';

      const recommendations = EmbeddingConfigValidator.getRecommendations();

      const fixRecommendation = recommendations.find(r =>
        r.includes('Set NEO4J_VECTOR_DIMENSIONS=3072')
      );
      expect(fixRecommendation).toBeDefined();
    });

    it('should recommend setting API key', () => {
      const recommendations = EmbeddingConfigValidator.getRecommendations();

      const apiKeyRecommendation = recommendations.find(r =>
        r.includes('Set OPENAI_API_KEY')
      );
      expect(apiKeyRecommendation).toBeDefined();
    });

    it('should recommend removing mock embeddings', () => {
      process.env.MOCK_EMBEDDINGS = 'true';

      const recommendations = EmbeddingConfigValidator.getRecommendations();

      const mockRecommendation = recommendations.find(r =>
        r.includes('Remove MOCK_EMBEDDINGS=true')
      );
      expect(mockRecommendation).toBeDefined();
    });

    it('should include best practices', () => {
      const recommendations = EmbeddingConfigValidator.getRecommendations();

      expect(recommendations).toContainEqual(
        expect.stringContaining('Best practices')
      );
    });
  });

  describe('Environment variable cascade', () => {
    it('should use explicit dimensions over model inference', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large'; // 3072D
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '1536';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(1536);
      expect(result.config.dimensionsSource).toBe('OPENAI_EMBEDDING_DIMENSIONS env var');
    });

    it('should cascade embedding dimensions to vector index by default', () => {
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '2048';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(2048);
      expect(result.config.vectorIndexDimensions).toBe(2048);
      expect(result.config.dimensionsMatch).toBe(true);
    });

    it('should allow explicit vector index override', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536D
      process.env.NEO4J_VECTOR_DIMENSIONS = '1536';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(1536);
      expect(result.config.vectorIndexDimensions).toBe(1536);
      expect(result.config.dimensionsMatch).toBe(true);
    });

    it('should prioritize both explicit dimension settings', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large'; // Would be 3072D
      process.env.OPENAI_EMBEDDING_DIMENSIONS = '1536';
      process.env.NEO4J_VECTOR_DIMENSIONS = '1536';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(1536);
      expect(result.config.vectorIndexDimensions).toBe(1536);
      expect(result.config.dimensionsMatch).toBe(true);
    });

    it('should default to model dimensions when nothing explicit set', () => {
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

      const result = EmbeddingConfigValidator.validate();

      expect(result.config.dimensions).toBe(1536);
      expect(result.config.vectorIndexDimensions).toBe(1536);
      expect(result.config.dimensionsSource).toContain('inferred from model');
      expect(result.config.vectorIndexSource).toContain('inferred from embedding config');
    });
  });
});
