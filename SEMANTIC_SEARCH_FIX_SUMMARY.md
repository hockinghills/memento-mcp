# Semantic Search Dimension Mismatch - Fix Summary

**Date:** 2025-11-01
**Issue:** Semantic search in Memento MCP returning empty results due to vector dimension mismatch
**Error:** `Index query vector has 3072 dimensions, but indexed vectors have 2048`

---

## Root Cause Analysis

### The Problem
The system had **mixed embedding dimensions** in the Neo4j database:
- **1,146 entities**: Correct 2048-dimension embeddings (Voyage AI)
- **6 entities**: Incorrect 3072-dimension embeddings (old OpenAI text-embedding-3-large)
- **1 historical entity version**: 3072-dimension embedding

The Neo4j vector index was correctly configured for **2048 dimensions**, matching the current Voyage AI embedding model configuration in `.env`:

```env
NEO4J_VECTOR_DIMENSIONS=2048
EMBEDDING_PROVIDER=voyageai
VOYAGE_EMBEDDING_MODEL=voyage-3-large
```

However, when semantic search generated query embeddings or encountered old entity embeddings, the dimension mismatch caused errors.

### Why Mixed Dimensions Occurred
1. System was previously configured to use OpenAI's `text-embedding-3-large` (3072 dimensions)
2. Some entities were embedded with this model
3. Configuration was changed to Voyage AI with 2048 dimensions
4. Neo4j vector index was recreated for 2048 dimensions
5. Most entities were re-embedded, but **6 entities + 1 historical version** retained old 3072-dimension embeddings

---

## Solution Implemented

### Step 1: Identified Problem Entities
```cypher
MATCH (e:Entity)
WHERE e.embedding IS NOT NULL
RETURN DISTINCT size(e.embedding) as dimensions, count(*) as count
```

Found:
- 1,146 entities with 2048 dimensions ✓
- 7 entities with 3072 dimensions ✗

### Step 2: Re-embedded Current Entities
Used `fix-embedding-dimensions.js` to re-embed the 6 current entities:
1. CT Clamp Circuit Design
2. DMA Overflow Critical Issue
3. ESP32-S3 Annealer CT Monitoring
4. Memento Phase 1 Semantic Search Enhancement
5. Memento_Repair_Session_2025_11_01
6. Test Results October 29 2025

### Step 3: Fixed Historical Entity Version
Used `fix-historical-embedding.js` to update the historical version:
- **Entity:** ESP32-S3 Annealer CT Monitoring (version 1)
- **ID:** af485660-bd67-48e4-85ec-02c62014c86c
- **Old dimensions:** 3072
- **New dimensions:** 2048

### Step 4: Verification
```cypher
MATCH (e:Entity)
WHERE e.embedding IS NOT NULL
RETURN DISTINCT size(e.embedding) as dimensions, count(*) as count
```

Result:
- **1,153 entities with 2048 dimensions** ✓
- **0 entities with 3072 dimensions** ✓

---

## Required Action: RESTART MCP SERVER

**CRITICAL:** The Memento MCP server must be **restarted** for the fix to take effect.

### Why Restart is Needed
The `Neo4jStorageProvider` initializes its own `EmbeddingService` instance when the server starts (line 150 in `Neo4jStorageProvider.ts`). The currently running server instance has an **old embedding service** that:
- Still uses `text-embedding-3-large` model
- Generates 3072-dimension embeddings
- Causes the dimension mismatch error

### How to Restart
The exact restart method depends on how the MCP server is being run:

1. **If running via Claude Desktop:**
   - Quit and restart Claude Desktop application
   - The MCP server will restart automatically

2. **If running manually:**
   ```bash
   # Stop the current server process
   # Then start it again:
   cd /home/louthenw/mcp/memento-mcp
   npm start
   ```

3. **If running via systemd or other process manager:**
   - Use the appropriate restart command for your setup

### After Restart
The server will:
1. Read the updated `.env` configuration
2. Initialize `EmbeddingService` with **Voyage AI** (voyage-3-large, 2048 dimensions)
3. Generate all future query embeddings with 2048 dimensions
4. Semantic search will work correctly ✓

---

## Test After Restart

### Using Memento MCP Tool
```javascript
// This should now return results without dimension errors
mcp__memento__semantic_search({
  query: "ESP32 monitoring",
  limit: 5,
  min_similarity: 0.5
})
```

### Diagnostic Scripts
```bash
# Test embedding generation
node test-embedding-dimensions.js

# Test semantic search
node test-semantic-search.js
```

---

## Configuration Validation

### Current Correct Configuration (.env)
```env
# Storage Configuration
NEO4J_VECTOR_DIMENSIONS=2048

# Embedding Provider
EMBEDDING_PROVIDER=voyageai
VOYAGE_EMBEDDING_MODEL=voyage-3-large

# OpenAI (fallback only - not used for embeddings)
OPENAI_EMBEDDING_MODEL=text-embedding-3-large  # ← Not used when EMBEDDING_PROVIDER=voyageai
```

### Why This Configuration Works
1. `NEO4J_VECTOR_DIMENSIONS=2048` → Vector index dimension
2. `EMBEDDING_PROVIDER=voyageai` → Use Voyage AI as primary provider
3. `VOYAGE_EMBEDDING_MODEL=voyage-3-large` → Specific model
4. Voyage-3-large with `outputDimension=2048` → Matches index dimensions

The `OPENAI_EMBEDDING_MODEL` setting is present but **not used** because `EMBEDDING_PROVIDER=voyageai` takes precedence (see `EmbeddingServiceFactory.createFromEnvironment()` lines 116-149).

---

## Lessons Learned

### For Future Embedding Model Changes
1. **Check existing embeddings before changing models:**
   ```cypher
   MATCH (e:Entity)
   WHERE e.embedding IS NOT NULL
   RETURN DISTINCT size(e.embedding) as dimensions, count(*) as count
   ```

2. **Plan migration strategy:**
   - Re-embed all entities with new model
   - Include historical entity versions
   - Verify no mixed dimensions remain

3. **Update vector index dimensions:**
   - Drop old index: `DROP INDEX entity_embeddings IF EXISTS`
   - Create new index with correct dimensions
   - Set `NEO4J_VECTOR_DIMENSIONS` to match

4. **Restart all services:**
   - MCP server
   - Any other services using the embedding service

### Prevention
- Document embedding model changes
- Create migration scripts for model changes
- Add dimension validation to entity creation
- Monitor for dimension mismatches in logs

---

## Files Created During Fix

1. `/home/louthenw/mcp/memento-mcp/test-embedding-dimensions.js`
   - Diagnostic script to test embedding generation

2. `/home/louthenw/mcp/memento-mcp/test-semantic-search.js`
   - Test script for semantic search functionality

3. `/home/louthenw/mcp/memento-mcp/fix-embedding-dimensions.js`
   - Script that re-embedded the 6 current entities

4. `/home/louthenw/mcp/memento-mcp/fix-historical-embedding.js`
   - Script that fixed the historical entity version

5. `/home/louthenw/mcp/memento-mcp/SEMANTIC_SEARCH_FIX_SUMMARY.md`
   - This document

These scripts can be kept for future diagnostics or deleted after the fix is confirmed working.

---

## Status

- ✅ Problem diagnosed
- ✅ Root cause identified
- ✅ All entity embeddings fixed (1,153 entities @ 2048 dimensions)
- ✅ Historical versions fixed
- ✅ Database verified clean
- ⏳ **PENDING: MCP server restart**
- ⏳ **PENDING: Post-restart testing**

---

## Next Steps

1. **Restart the Memento MCP server** (see "Required Action" section above)
2. **Test semantic search** using the MCP tool or diagnostic scripts
3. **Verify** that search returns results without dimension errors
4. **Document** this fix in project knowledge base
5. **Optional:** Delete diagnostic scripts if no longer needed

---

**Fix completed by:** MCP Engineer Agent
**Date:** 2025-11-01
**Session:** Memento_Repair_Session_2025_11_01
