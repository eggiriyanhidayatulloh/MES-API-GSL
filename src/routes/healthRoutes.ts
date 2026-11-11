import { Router, Request, Response } from 'express';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  let dbStatus = 'UNKNOWN';
  let dbError: string | null = null;

  try {
    const pool = await getDbPool();
    await pool.request().query('SELECT 1 AS HealthCheck;');
    dbStatus = 'CONNECTED';
  } catch (err: any) {
    dbStatus = 'DISCONNECTED';
    dbError = err.message;
  }

  const healthData = {
    service: 'MES-API-GSL',
    status: dbStatus === 'CONNECTED' ? 'HEALTHY' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: {
      nodeEnv: config.nodeEnv,
      eaiEnv: config.eai.environment,
      schedulerEnabled: config.scheduler.enabled,
      cronPattern: config.scheduler.cronOrderBroadcast,
    },
    database: {
      server: config.db.server,
      name: config.db.database,
      status: dbStatus,
      error: dbError,
    },
    mulesoft: {
      orderBroadcastEndpoint: config.eai.orderBroadcastUrl,
    },
  };

  const statusCode = dbStatus === 'CONNECTED' ? 200 : 503;
  res.status(statusCode).json(healthData);
});

export default router;
