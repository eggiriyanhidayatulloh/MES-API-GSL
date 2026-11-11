import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import healthRoutes from './routes/healthRoutes';
import authRoutes from './routes/authRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import orderBroadcastRoutes from './routes/orderBroadcastRoutes';
import vehicleBasicInfoRoutes from './routes/vehicleBasicInfoRoutes';
import vehiclePassingPointRoutes from './routes/vehiclePassingPointRoutes';
import vehiclePreciseTraceabilityRoutes from './routes/vehiclePreciseTraceabilityRoutes';
import vehicleOfflineBomRoutes from './routes/vehicleOfflineBomRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import { authMiddleware } from './middlewares/authMiddleware';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static files for Web Dashboard (Always public so UI can load)
  const publicDir = path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Request logger middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.originalUrl.startsWith('/api/dashboard/summary')) {
      logger.info(`[HTTP] ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  // UI Route
  app.get(['/', '/dashboard'], (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Public Routes (Health check & Auth)
  app.use('/', healthRoutes);
  app.use('/api/auth', authRoutes);

  // Protected API Routes (Requires valid session token)
  app.use('/api/dashboard', authMiddleware, dashboardRoutes);
  app.use('/api/scheduler', schedulerRoutes);
  app.use('/api/order-broadcast', authMiddleware, orderBroadcastRoutes);
  app.use('/api/vehicle-basic-info', authMiddleware, vehicleBasicInfoRoutes);
  app.use('/api/vehicle-passing-point', authMiddleware, vehiclePassingPointRoutes);
  app.use('/api/vehicle-precise-traceability', authMiddleware, vehiclePreciseTraceabilityRoutes);
  app.use('/api/vehicle-offline-bom', authMiddleware, vehicleOfflineBomRoutes);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled server error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Internal server error',
    });
  });

  return app;
}
