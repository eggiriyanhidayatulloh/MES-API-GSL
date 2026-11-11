import { Request, Response } from 'express';
import { vehiclePassingPointService } from '../services/vehiclePassingPointService';
import { logger } from '../utils/logger';

export class VehiclePassingPointController {
  /**
   * POST /api/vehicle-passing-point/sync
   * Trigger manual batch sync
   */
  public async syncNow(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit as string, 10)), 50) : 50;
      const result = await vehiclePassingPointService.syncBatch(limit);
      res.status(200).json({
        success: true,
        message: 'VehiclePassingPoint sync completed.',
        data: result,
      });
    } catch (error: any) {
      logger.error('Error in syncNow VehiclePassingPoint controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * POST /api/vehicle-passing-point/sync/:vin
   * Trigger sync for specific VIN
   */
  public async syncSingleVin(req: Request, res: Response): Promise<void> {
    try {
      const vin = req.params.vin;
      if (!vin) {
        res.status(400).json({ success: false, message: 'Parameter VIN is required.' });
        return;
      }

      const result = await vehiclePassingPointService.syncSingleVin(vin);
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error: any) {
      logger.error('Error in syncSingleVin VehiclePassingPoint controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * GET /api/vehicle-passing-point/logs
   * View recent sync logs
   */
  public async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const logs = await vehiclePassingPointService.getRecentLogs(limit);
      res.status(200).json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (error: any) {
      logger.error('Error in getLogs VehiclePassingPoint controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * GET /api/vehicle-passing-point/payload/:vin
   * View JSON payload for specific VIN
   */
  public async getPayload(req: Request, res: Response): Promise<void> {
    try {
      const vin = req.params.vin;
      if (!vin) {
        res.status(400).json({ success: false, message: 'VIN is required.' });
        return;
      }
      const data = await vehiclePassingPointService.getPayloadByVin(vin);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      logger.error('Error in getPayload VehiclePassingPoint controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }
}

export const vehiclePassingPointController = new VehiclePassingPointController();
