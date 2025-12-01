// Usage Analysis Queries for Memento

// 1. Count total entities (baseline for understanding scale)
MATCH (e:Entity)
RETURN count(e) as totalEntities;

// 2. Count entities with embeddings
MATCH (e:Entity)
WHERE e.embedding IS NOT NULL
RETURN count(e) as entitiesWithEmbeddings;

// 3. Check if there are any activity/access logs stored
// (This will help estimate search frequency)
MATCH (n)
WHERE n.lastAccessed IS NOT NULL OR n.accessCount IS NOT NULL
RETURN labels(n) as nodeType, count(n) as count
LIMIT 10;

// 4. Get entity creation timeline (helps estimate embedding generation frequency)
MATCH (e:Entity)
WHERE e.createdAt IS NOT NULL
WITH date(datetime({epochMillis: e.createdAt})) as creationDate
RETURN creationDate, count(*) as entitiesCreated
ORDER BY creationDate DESC
LIMIT 30;

// 5. Check relationship density (affects graph-aware search benefits)
MATCH ()-[r]->()
RETURN count(r) as totalRelationships;

// 6. Average observations per entity (affects embedding token usage)
MATCH (e:Entity)
WHERE e.observations IS NOT NULL
RETURN avg(size(e.observations)) as avgObservations,
       max(size(e.observations)) as maxObservations,
       min(size(e.observations)) as minObservations;
