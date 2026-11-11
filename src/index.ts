import { createApp } from './app';
import { config } from './config';
import { getDbPool, closeDbPool } from './db/sqlConnection';
import { schedulerService } from './services/schedulerService';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    logger.info('==================================================');
    logger.info('       MES-API-GSL Integration Service            ');
    logger.info(`       Environment: ${config.eai.environment}    `);
    logger.info('==================================================');

    // 1. Initialize Database Connection
    await getDbPool();

    // 2. Start Express Web Server
    const app = createApp();
    const server = app.listen(config.port, () => {
      logger.info(`Server listening on http://localhost:${config.port}`);
      logger.info(`Health check available at http://localhost:${config.port}/health`);
      logger.info(`Manual sync endpoint: POST http://localhost:${config.port}/api/order-broadcast/sync`);
    });

    // 3. Start Background Scheduler (Cron)
    schedulerService.start();

    // 4. Graceful Shutdown Handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      schedulerService.stop();

      server.close(async () => {
        logger.info('HTTP server closed.');
        await closeDbPool();
        logger.info('Process terminated cleanly.');
        process.exit(0);
      });

      // Force shutdown after 10s if graceful shutdown hangs
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Fatal bootstrap error:', error);
    process.exit(1);
  }
}

bootstrap();
