import { Request, Response } from 'express';
import { orderBroadcastService } from '../services/orderBroadcastService';
import { logger } from '../utils/logger';

export class OrderBroadcastController {
  /**
   * POST /api/order-broadcast/sync
   * Trigger manual batch sync
   */
  public async syncNow(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit as string, 10)), 50) : 50;
      const result = await orderBroadcastService.syncBatch(limit);
      res.status(200).json({
        success: true,
        message: 'OrderBroadcast sync completed.',
        data: result,
      });
    } catch (error: any) {
      logger.error('Error in syncNow controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * POST /api/order-broadcast/sync/:vin
   * Trigger sync for specific VIN
   */
  public async syncSingleVin(req: Request, res: Response): Promise<void> {
    try {
      const vin = req.params.vin;
      if (!vin) {
        res.status(400).json({ success: false, message: 'Parameter VIN is required.' });
        return;
      }

      const result = await orderBroadcastService.syncSingleVin(vin);
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error: any) {
      logger.error('Error in syncSingleVin controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * GET /api/order-broadcast/logs
   * View recent sync logs
   */
  public async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const logs = await orderBroadcastService.getRecentLogs(limit);
      res.status(200).json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (error: any) {
      logger.error('Error in getLogs controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * GET /api/order-broadcast/payload/:vin
   * View JSON payload for specific VIN
   */
  public async getPayload(req: Request, res: Response): Promise<void> {
    try {
      const vin = req.params.vin;
      if (!vin) {
        res.status(400).json({ success: false, message: 'VIN is required.' });
        return;
      }
      const data = await orderBroadcastService.getPayloadByVin(vin);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      logger.error('Error in getPayload controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }
}

export const orderBroadcastController = new OrderBroadcastController();
