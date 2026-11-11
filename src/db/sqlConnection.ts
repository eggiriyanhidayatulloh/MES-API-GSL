import sql from 'mssql';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: sql.ConnectionPool | null = null;

export async function getDbPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  try {
    logger.info(`Connecting to SQL Server [${config.db.server}:${config.db.port}], Database: [${config.db.database}]...`);
    pool = await new sql.ConnectionPool(config.db).connect();
    
    pool.on('error', (err: any) => {
      logger.error('Unexpected error on idle SQL Server connection pool:', err);
      pool = null;
    });

    logger.info('SQL Server connection pool established successfully.');
    return pool;
  } catch (error) {
    logger.error('Failed to connect to SQL Server:', error);
    pool = null;
    throw error;
  }
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
      logger.info('SQL Server connection pool closed.');
    } catch (err) {
      logger.error('Error closing SQL connection pool:', err);
    } finally {
      pool = null;
    }
  }
}
