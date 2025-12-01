import { Neo4jStorageProvider } from './dist/storage/neo4j/Neo4jStorageProvider.js';
import { EmbeddingServiceFactory } from './dist/embeddings/EmbeddingServiceFactory.js';

async function testGetEntityById() {
  console.log('Starting test...\n');

  // Create storage provider
  const storageProvider = new Neo4jStorageProvider({
    config: {
      uri: 'bolt://localhost:7687',
      database: 'neo4j',
      username: 'neo4j',
      password: 'password',
    }
  });

  try {
    const entityId = 'ae2d6df6-db5b-4ef0-9c3d-01bca41320f7';
    console.log(`Testing getEntityById with ID: ${entityId}\n`);

    // Test the fix
    const entity = await storageProvider.getEntityById(entityId);

    if (entity) {
      console.log('✅ SUCCESS: Entity found by ID!');
      console.log('Name:', entity.name);
      console.log('Type:', entity.entityType);
      console.log('ID:', entity.id);
      console.log('validTo:', entity.validTo);
      console.log('Version:', entity.version);
      console.log('Has embedding:', entity.embedding !== null && entity.embedding !== undefined);

      // Now test if we can generate an embedding for it
      console.log('\n--- Testing embedding generation ---');

      const embeddingService = EmbeddingServiceFactory.createFromEnvironment();
      const text = entity.observations?.join('\n') || '';

      console.log('Observations text:', text.substring(0, 100) + '...');

      const embedding = await embeddingService.generateEmbedding(text);
      console.log('Generated embedding length:', embedding.length);
      console.log('Sample values:', embedding.slice(0, 5));

      // Update the entity with the embedding
      console.log('\n--- Updating entity embedding ---');
      await storageProvider.updateEntityEmbedding(entity.name, {
        vector: embedding,
        model: embeddingService.getProviderInfo().model,
        lastUpdated: Date.now(),
      });

      console.log('✅ Entity embedding updated successfully!');

    } else {
      console.log('❌ FAILED: Entity not found by ID');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await storageProvider.close();
  }
}

testGetEntityById().catch(console.error);
