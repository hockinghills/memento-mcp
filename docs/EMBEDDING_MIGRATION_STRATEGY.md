# Embedding Migration Strategy

## Current Database State Analysis

Your database currently has:
- **Primarily 3072-dimensional embeddings** (text-embedding-3-large)
- **Unknown if any 1536-dimensional embeddings exist**
- **Some entities may have NO embeddings at all**
- **Mixed/inconsistent state needs resolution**

## Step-by-Step Migration Strategy

### Phase 1: Assessment

#### 1.1 Analyze Current State
```bash
# Run diagnostic to understand current state
npm run embedding:analyze

# OR use the migration tool directly
npm run embedding:migrate analyze
```

This will show you:
- Total entities in the database
- How many have embeddings vs. no embeddings
- Distribution of embedding dimensions (e.g., how many are 1536D vs 3072D)
- List of entities with mismatched dimensions
- Vector index configuration

#### 1.2 Determine Target Configuration

**Option A: Stay with text-embedding-3-large (3072D)**
- Higher quality embeddings
- More expensive ($0.13 per 1M tokens vs $0.02)
- Better semantic understanding

```bash
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large
# Dimensions auto-configure to 3072
```

**Option B: Switch to text-embedding-3-small (1536D)**
- Lower cost
- Still good quality
- Faster processing

```bash
export OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# Dimensions auto-configure to 1536
```

**Recommendation**: If you're already primarily using 3072D embeddings, stay with text-embedding-3-large unless cost is a concern.

### Phase 2: Backup

#### 2.1 Create Database Backup (CRITICAL)

Before making any changes, create backups:

```bash
# Backup embeddings in database (stores in temporary properties)
npm run embedding:migrate clear-all --skip-backup=false

# OR manually backup with Neo4j
# - Use Neo4j Desktop backup feature
# - OR dump database: neo4j-admin dump --database=neo4j --to=/path/to/backup.dump
```

### Phase 3: Clean Up Inconsistencies

#### 3.1 Dry Run First (ALWAYS)

```bash
# See what would be affected without making changes
npm run embedding:migrate analyze --target-model text-embedding-3-large
npm run embedding:migrate clear-mismatched --target-model text-embedding-3-large --dry-run
```

#### 3.2 Clear Mismatched Embeddings

**Option A: Clear only mismatched embeddings** (keeps correct ones)
```bash
npm run embedding:migrate clear-mismatched --target-model text-embedding-3-large
```

**Option B: Clear ALL embeddings** (complete reindex)
```bash
npm run embedding:migrate clear-all --target-model text-embedding-3-large
```

**Recommendation**:
- Use Option A if most embeddings are already correct (saves regeneration cost)
- Use Option B if you want a clean slate or have major inconsistencies

### Phase 4: Recreate Vector Index

#### 4.1 Recreate Index with Correct Dimensions

```bash
# Dry run first
npm run embedding:migrate recreate-index --target-model text-embedding-3-large --dry-run

# Then execute
npm run embedding:migrate recreate-index --target-model text-embedding-3-large
```

This will:
1. Drop the old vector index
2. Create a new index with correct dimensions (3072D)
3. Verify the index was created successfully

### Phase 5: Regenerate Embeddings

#### 5.1 Configure Environment

Set your environment variables for the target model:

```bash
# In your .env file or environment
export OPENAI_API_KEY=your-api-key-here
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large
# Dimensions will auto-configure to 3072
```

#### 5.2 List Entities Needing Embeddings

```bash
# See which entities need regeneration
npm run embedding:migrate list-needing --target-model text-embedding-3-large
```

#### 5.3 Regenerate via Application

The embeddings will regenerate automatically when you use Memento:

**Automatic Regeneration** (happens in background):
- Start Memento MCP server
- Embeddings regenerate automatically for entities that need them
- Check logs to monitor progress

**Manual Regeneration** (if you want to force immediate regeneration):
- Use the application to query/access entities
- Or use the `force_generate_embedding` MCP tool
- Or modify and save entities (triggers embedding update)

**Batch Regeneration Script** (if you need to process many entities):
```typescript
// Save this as regenerate-embeddings.ts
import { mcp__memento__force_generate_embedding } from './your-memento-tools';

// Get list of entity names that need embeddings
const entities = ['entity1', 'entity2', 'entity3']; // From list-needing command

// Regenerate in batches
const BATCH_SIZE = 10;
for (let i = 0; i < entities.length; i += BATCH_SIZE) {
  const batch = entities.slice(i, i + BATCH_SIZE);
  await Promise.all(
    batch.map(name => mcp__memento__force_generate_embedding({ entity_name: name }))
  );
  console.log(`Processed ${Math.min(i + BATCH_SIZE, entities.length)}/${entities.length}`);
  // Add delay to respect rate limits
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

### Phase 6: Verification

#### 6.1 Verify Consistency

```bash
# Run diagnostic again
npm run embedding:analyze

# Should show:
# - All embeddings have correct dimensions (3072D)
# - Consistency status: "consistent"
# - Vector index matches embedding dimensions
```

#### 6.2 Test Search Functionality

Use your application to test that semantic search works correctly:
- Search for entities
- Verify results are relevant
- Check that similarity scores are reasonable (0.0 to 1.0)

### Phase 7: Cleanup

#### 7.1 Remove Backups (Optional)

If everything is working correctly, clean up backup data:

```bash
# Remove embedding backups from database
npm run embedding:migrate clear-all --skip-backup
# This only affects the backup properties, not actual embeddings
```

## Safety Features

### Rollback Plan

If something goes wrong:

```bash
# Restore from backup properties (if not cleaned up)
npm run embedding:migrate restore

# OR restore from Neo4j backup
# - Stop Memento MCP
# - Restore Neo4j database from dump
# - Restart services
```

### Dry Run Mode

**ALWAYS** use `--dry-run` first to preview changes:

```bash
npm run embedding:migrate <command> --dry-run
```

This shows what WOULD happen without actually modifying data.

## Quick Reference Commands

```bash
# Assessment
npm run embedding:analyze                                        # Full diagnostic
npm run embedding:analyze config                                 # Config only
npm run embedding:analyze database                               # Database only

# Migration (always dry-run first!)
npm run embedding:migrate analyze --target-model <model>
npm run embedding:migrate clear-mismatched --target-model <model> --dry-run
npm run embedding:migrate clear-mismatched --target-model <model>
npm run embedding:migrate clear-all --target-model <model>
npm run embedding:migrate recreate-index --target-model <model>
npm run embedding:migrate list-needing --target-model <model>

# Recovery
npm run embedding:migrate restore
```

## Common Scenarios

### Scenario 1: Mostly Correct, Few Mismatches

You have mostly 3072D embeddings, but a few are 1536D or missing.

```bash
# 1. Verify current state
npm run embedding:analyze

# 2. Clear only mismatched (preserves correct embeddings)
npm run embedding:migrate clear-mismatched --target-model text-embedding-3-large --dry-run
npm run embedding:migrate clear-mismatched --target-model text-embedding-3-large

# 3. Regenerate missing ones (automatic via application)
# Just use Memento normally - it will regenerate as needed
```

### Scenario 2: Complete Model Change

You want to switch from text-embedding-3-small to text-embedding-3-large.

```bash
# 1. Backup
npm run embedding:migrate clear-all --dry-run  # Preview

# 2. Clear all embeddings
npm run embedding:migrate clear-all --target-model text-embedding-3-large

# 3. Recreate index
npm run embedding:migrate recreate-index --target-model text-embedding-3-large

# 4. Update environment
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# 5. Restart Memento - embeddings regenerate automatically
```

### Scenario 3: Starting Fresh

You want a completely clean database.

```bash
# 1. Clear everything
npm run embedding:migrate clear-all --target-model text-embedding-3-large

# 2. Recreate index
npm run embedding:migrate recreate-index --target-model text-embedding-3-large

# 3. Configure environment
export OPENAI_API_KEY=your-key
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# 4. Restart Memento and use normally
```

## Cost Considerations

### Regeneration Costs

OpenAI embedding costs (as of 2024):
- **text-embedding-3-small**: $0.020 per 1M tokens (~400 pages)
- **text-embedding-3-large**: $0.130 per 1M tokens (~400 pages)

**Example**: Regenerating embeddings for 1,000 entities with average 500 tokens each:
- Total tokens: 500,000
- Cost (3-small): ~$0.01
- Cost (3-large): ~$0.065

**Tip**: If cost is a concern, clear only mismatched embeddings instead of regenerating everything.

## Troubleshooting

### Issue: Dimension mismatch errors

**Solution**:
```bash
npm run embedding:analyze config  # Check configuration
# Fix environment variables as recommended
npm run embedding:migrate recreate-index --target-model <your-model>
```

### Issue: Vector index not found

**Solution**:
```bash
npm run embedding:migrate recreate-index --target-model text-embedding-3-large
```

### Issue: Embeddings not regenerating

**Check**:
1. Is OPENAI_API_KEY set? `echo $OPENAI_API_KEY`
2. Is model configured? `npm run embedding:analyze config`
3. Are entities being accessed/modified? (triggers regeneration)
4. Check Memento logs for errors

### Issue: Rate limit errors

**Solution**:
- Reduce rate limits in environment:
  ```bash
  export EMBEDDING_RATE_LIMIT_TOKENS=10  # Default: 20
  export EMBEDDING_RATE_LIMIT_INTERVAL=60000  # 1 minute
  ```
- Process fewer entities at once
- Add delays between operations

## Best Practices

1. **Always run diagnostics first**: `npm run embedding:analyze`
2. **Always use `--dry-run` before real operations**
3. **Always create backups before migrations**
4. **Set explicit model in environment** (don't rely on defaults)
5. **Verify after each phase** (run analyze again)
6. **Monitor costs** when regenerating many embeddings
7. **Keep environment variables consistent** across all services

## Environment Variable Recommendations

**Recommended Setup**:
```bash
# In your .env or environment
export OPENAI_API_KEY=your-api-key-here
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large
# Let dimensions auto-configure from model (recommended)
# NEO4J_VECTOR_DIMENSIONS will inherit automatically
```

**What NOT to do**:
```bash
# DON'T manually set mismatched dimensions
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large  # 3072D
export NEO4J_VECTOR_DIMENSIONS=1536  # ❌ MISMATCH!
```

**Override only when necessary**:
```bash
# Only override if you have a specific reason
export OPENAI_EMBEDDING_DIMENSIONS=3072  # Override if needed
export NEO4J_VECTOR_DIMENSIONS=3072      # Keep in sync
```
