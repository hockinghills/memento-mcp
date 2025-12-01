# Migration Guide: Enhanced Semantic Search (Phase 1)

This guide covers the Phase 1 implementation of enhanced semantic search capabilities for Memento MCP, including Voyage AI embeddings, Cohere reranking, and RRF hybrid search.

## What's New

### 1. Voyage AI Embedding Support
- **New Provider**: Voyage AI (`voyage-3-large` model)
- **Configurable Dimensions**: 256-2048 dimensions (configured to 2048d)
- **Better Semantic Quality**: State-of-the-art embeddings optimized for retrieval

### 2. Cohere Reranking Service
- **Post-processing**: Re-ranks search results for improved relevance
- **Optional Integration**: Can be enabled/disabled via configuration
- **Model**: `rerank-english-v3.0` (trial key provided, production key recommended)

### 3. RRF Hybrid Search
- **Reciprocal Rank Fusion**: Combines vector similarity + keyword (BM25) search
- **Configurable**: RRF constant (k=60 default)
- **Better Coverage**: Captures both semantic and exact keyword matches

## Files Created/Modified

### New Files
1. `/home/louthenw/mcp/memento-mcp/src/embeddings/VoyageAIEmbeddingService.ts`
   - Voyage AI embedding service implementation
   - Supports configurable output dimensions for voyage-3 models

2. `/home/louthenw/mcp/memento-mcp/src/reranking/CohereRerankingService.ts`
   - Cohere reranking service implementation
   - Can rerank both generic documents and vector search results

3. `/home/louthenw/mcp/memento-mcp/src/cli/migrate-to-voyage.ts`
   - Migration script to re-embed all entities with Voyage AI
   - Handles index recreation and batch processing

4. `/home/louthenw/mcp/memento-mcp/MIGRATION_GUIDE.md` (this file)

### Modified Files
1. `/home/louthenw/mcp/memento-mcp/src/embeddings/config.ts`
   - Added `VOYAGE_MODEL_DIMENSIONS` mapping
   - Updated `getModelDimensions()` to support Voyage models

2. `/home/louthenw/mcp/memento-mcp/src/embeddings/EmbeddingServiceFactory.ts`
   - Added Voyage AI provider registration
   - Updated `createFromEnvironment()` to check for Voyage API key
   - Added provider selection logic

3. `/home/louthenw/mcp/memento-mcp/src/storage/neo4j/Neo4jVectorStore.ts`
   - Added `hybridSearchWithRRF()` method
   - Updated `search()` to support hybrid search options
   - Implements RRF algorithm combining vector + keyword search

4. `/home/louthenw/mcp/memento-mcp/.env`
   - Added Voyage AI configuration
   - Added Cohere reranking configuration
   - Added hybrid search settings
   - Updated dimensions to 2048

5. `/home/louthenw/mcp/memento-mcp/example.env`
   - Comprehensive documentation of all new configuration options
   - Examples and explanations for each provider

6. `/home/louthenw/mcp/memento-mcp/package.json`
   - Added `cohere-ai` dependency (already had `voyageai`)

## Configuration

Your `.env` file has been updated with:

```env
# Embedding Provider
EMBEDDING_PROVIDER=voyageai

# Voyage AI
VOYAGE_API_KEY=pa-69bzYhe0xyi6r0oniZJfB2SN5hQ675mZdZ0c8VK6FCb
VOYAGE_EMBEDDING_MODEL=voyage-3-large

# Cohere Reranking
COHERE_API_KEY=fClDlw5FoOljyWxG6nDSqFFjoHwps3YHE4RG6YYU
COHERE_RERANK_MODEL=rerank-english-v3.0

# Neo4j Vector Dimensions
NEO4J_VECTOR_DIMENSIONS=2048

# Hybrid Search
ENABLE_HYBRID_SEARCH=true
RRF_K=60
```

## Migration Steps

### Step 1: Backup Current Data (Recommended)

Before migrating, consider backing up your current Neo4j database or at least documenting the current state.

### Step 2: Run Migration Script

The migration script will:
1. Drop the existing vector index
2. Create a new index with 2048 dimensions
3. Re-embed all 1,149 entities with Voyage AI
4. Update entities in batches (50 per batch)

#### Dry Run (Test Without Changes)
```bash
cd /home/louthenw/mcp/memento-mcp
tsx src/cli/migrate-to-voyage.ts --dry-run
```

#### Full Migration
```bash
cd /home/louthenw/mcp/memento-mcp
tsx src/cli/migrate-to-voyage.ts
```

#### Custom Batch Size
```bash
tsx src/cli/migrate-to-voyage.ts --batch-size=25
```

#### Skip Index Recreation (if you've already recreated it)
```bash
tsx src/cli/migrate-to-voyage.ts --no-recreate-index
```

### Step 3: Verify Migration

After migration completes, verify:

1. **Entity Count**: Ensure all entities were migrated
   ```cypher
   MATCH (e:Entity)
   WHERE e.embedding IS NOT NULL
   RETURN count(e) as count
   ```

2. **Embedding Dimensions**: Check a sample entity
   ```cypher
   MATCH (e:Entity)
   WHERE e.embedding IS NOT NULL
   RETURN e.name, size(e.embedding) as dimensions
   LIMIT 5
   ```

3. **Vector Index Status**
   ```cypher
   SHOW VECTOR INDEXES
   ```

### Step 4: Test Search

Test the new search capabilities:

1. **Vector Search**: Standard semantic search (same as before)
2. **Hybrid Search**: Uses RRF to combine vector + keyword results
   - Requires passing `queryText` parameter
   - Set `hybridSearch: true` in search options

## Usage Examples

### Using Voyage AI Embeddings

Voyage AI is now the default provider. The system will automatically:
- Use `voyage-3-large` model
- Generate 2048-dimensional embeddings
- Store embeddings in Neo4j

### Using Hybrid Search

When performing semantic searches, you can now enable hybrid mode:

```typescript
const results = await vectorStore.search(queryVector, {
  limit: 10,
  hybridSearch: true,
  queryText: "your search query text",
  rrfK: 60, // optional, default is 60
});
```

Hybrid search will:
1. Perform vector similarity search
2. Perform keyword (BM25) search on entity names and observations
3. Combine results using Reciprocal Rank Fusion
4. Return unified ranked results

### Using Cohere Reranking

Cohere reranking can be applied as a post-processing step:

```typescript
import { CohereRerankingService } from './reranking/CohereRerankingService.js';

const rerankService = new CohereRerankingService({
  apiKey: process.env.COHERE_API_KEY,
});

// After getting vector search results
const rerankedResults = await rerankService.rerankVectorSearchResults(
  query,
  vectorSearchResults,
  entityTextMap,
  10 // top N results
);
```

## Performance Considerations

### Voyage AI API
- **Rate Limits**: Check your Voyage AI plan for rate limits
- **Batch Processing**: Migration script processes 50 entities per batch with 1s delay
- **Cost**: ~$0.12 per 1M tokens (check current pricing)

### Cohere Reranking
- **Trial Key Limits**: Your current key has rate limits
- **Production Key**: Recommended for production use
- **Cost**: Check Cohere pricing for rerank API

### Hybrid Search
- **Performance**: Slightly slower than pure vector search (2 queries + RRF)
- **Quality**: Better coverage and relevance for complex queries
- **When to Use**: Best for queries that may have exact keyword matches

## Rollback Plan

If you need to rollback:

1. **Switch Back to OpenAI**
   ```env
   EMBEDDING_PROVIDER=openai
   NEO4J_VECTOR_DIMENSIONS=3072
   ```

2. **Recreate Index for OpenAI Dimensions**
   ```cypher
   DROP INDEX entity_embeddings IF EXISTS;

   CREATE VECTOR INDEX entity_embeddings
   FOR (e:Entity)
   ON e.embedding
   OPTIONS {
     indexConfig: {
       `vector.dimensions`: 3072,
       `vector.similarity_function`: 'cosine'
     }
   };
   ```

3. **Re-embed with OpenAI**
   - Use existing embedding generation tools
   - Or create a similar migration script for OpenAI

## Next Steps (Phase 2+)

Future enhancements could include:

1. **Semantic Caching**: Cache common queries to reduce API calls
2. **Advanced Reranking**: Integrate reranking into search pipeline automatically
3. **Query Expansion**: Use LLM to expand queries before search
4. **Multi-vector Search**: Store multiple embedding types per entity
5. **Performance Benchmarking**: Compare different configurations

## Troubleshooting

### Migration Script Issues

**Error: "Voyage AI API authentication failed"**
- Verify `VOYAGE_API_KEY` in `.env`
- Check API key is active on Voyage AI dashboard

**Error: "Neo4j connection failed"**
- Verify Neo4j credentials in `.env`
- Ensure Neo4j instance is running and accessible

**Error: "Index already exists"**
- Use `--no-recreate-index` if index was already created
- Or manually drop the index first

### Search Issues

**No results from vector search**
- Verify embeddings were generated (check `e.embedding` property)
- Check vector index is in "ONLINE" state
- Verify dimensions match between embeddings and index

**Hybrid search not working**
- Ensure `queryText` parameter is provided
- Check `ENABLE_HYBRID_SEARCH` is set to `true`

**Cohere reranking errors**
- Verify `COHERE_API_KEY` is valid
- Check rate limits on trial key
- Consider upgrading to production key

## Support

For issues or questions:
1. Check logs with `DEBUG=true` in `.env`
2. Review this migration guide
3. Check Neo4j database state with Cypher queries
4. Review API provider status pages (Voyage AI, Cohere)

## Summary

Phase 1 implementation is complete and includes:
- ✅ Voyage AI embedding service
- ✅ Cohere reranking service
- ✅ RRF hybrid search
- ✅ Configuration updates
- ✅ Migration script
- ✅ Documentation

**Status**: Ready for migration and testing

**Next Step**: Run migration script to re-embed your 1,149 entities with Voyage AI (2048d)
