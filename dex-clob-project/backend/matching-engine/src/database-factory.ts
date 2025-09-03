import { IDatabaseManager } from './database-interface';
import { InMemoryDatabaseManager } from './database-memory';
// import { SQLiteDatabaseManager } from './database-sqlite';
// import { PostgreSQLDatabaseManager } from './database-postgresql';

export type DatabaseType = 'memory' | 'sqlite' | 'postgresql';

export class DatabaseFactory {
  static async createDatabase(type?: DatabaseType): Promise<IDatabaseManager> {
    const dbType = type || (process.env.DATABASE_TYPE as DatabaseType) || 'memory';
    
    console.log(`🎯 Initializing ${dbType.toUpperCase()} database...`);
    
    let database: IDatabaseManager;
    
    switch (dbType) {
      case 'postgresql':
        // database = new PostgreSQLDatabaseManager();
        console.log('⚠️ PostgreSQL not yet implemented, falling back to memory');
        database = new InMemoryDatabaseManager();
        break;
      case 'sqlite':
        // database = new SQLiteDatabaseManager();
        console.log('⚠️ SQLite not yet implemented, falling back to memory');
        database = new InMemoryDatabaseManager();
        break;
      case 'memory':
      default:
        database = new InMemoryDatabaseManager();
        break;
    }
    
    try {
      await database.connect();
      console.log(`✅ ${dbType.toUpperCase()} database initialized successfully`);
      return database;
    } catch (error) {
      console.error(`❌ Failed to initialize ${dbType} database:`, error);
      
      // Fallback to in-memory if other databases fail
      if (dbType !== 'memory') {
        console.log('🔄 Falling back to in-memory database...');
        const fallbackDb = new InMemoryDatabaseManager();
        await fallbackDb.connect();
        console.log('✅ In-memory fallback database initialized');
        return fallbackDb;
      }
      
      throw error;
    }
  }

  static async createWithHealthCheck(type?: DatabaseType): Promise<IDatabaseManager> {
    const database = await this.createDatabase(type);
    
    // Perform health check
    const health = await database.healthCheck();
    console.log(`🏥 Database health: ${health.status}`);
    
    if (health.recordCounts) {
      console.log(`📊 Record counts:`, health.recordCounts);
    }
    
    return database;
  }
}
