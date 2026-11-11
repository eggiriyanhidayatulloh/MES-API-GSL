import { Request, Response } from 'express';
import { vehicleOfflineBomService } from '../services/vehicleOfflineBomService';
import { logger } from '../utils/logger';

export class VehicleOfflineBomController {
  public async syncNow(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.body?.limit ? parseInt(req.body.limit, 10) : undefined;
      const result = await vehicleOfflineBomService.syncBatch(limit);
      res.status(200).json({
        success: true,
        message: `Vehicle Offline BOM sync completed: ${result.successCount} succeeded, ${result.failureCount} failed.`,
        data: result,
      });
    } catch (err: any) {
      logger.error('Error in VehicleOfflineBomController.syncNow:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error during Vehicle Offline BOM sync',
      });
    }
  }

  public async syncSingleRecord(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const result = await vehicleOfflineBomService.syncSingleRecord(id);
      if (result.success) {
        res.status(200).json({
          success: true,
          message: `Vehicle Offline BOM Record ID ${id} sent successfully.`,
          data: result.data,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          data: result.data,
        });
      }
    } catch (err: any) {
      logger.error(`Error in VehicleOfflineBomController.syncSingleRecord (${id}):`, err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error during single record sync',
      });
    }
  }

  public async syncByVin(req: Request, res: Response): Promise<void> {
    const { vin } = req.params;
    try {
      const result = await vehicleOfflineBomService.syncByVin(vin);
      if (result.success) {
        res.status(200).json({
          success: true,
          message: `Vehicle Offline BOM for VIN ${vin} sent successfully (${result.data?.totalRows || 0} row(s)).`,
          data: result.data,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          data: result.data,
        });
      }
    } catch (err: any) {
      logger.error(`Error in VehicleOfflineBomController.syncByVin (${vin}):`, err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error during VIN BOM sync',
      });
    }
  }

  public async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query?.limit ? parseInt(req.query.limit as string, 10) : 50;
      const logs = await vehicleOfflineBomService.getRecentLogs(limit);
      res.status(200).json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (err: any) {
      logger.error('Error in VehicleOfflineBomController.getLogs:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error while fetching logs',
      });
    }
  }

  public async getPayload(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const payloadData = await vehicleOfflineBomService.getPayloadById(id);
      res.status(200).json({
        success: true,
        data: payloadData,
      });
    } catch (err: any) {
      logger.error(`Error in VehicleOfflineBomController.getPayload (${id}):`, err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error while fetching payload',
      });
    }
  }

  public async materialize(_req: Request, res: Response): Promise<void> {
    try {
      const insertedCount = await vehicleOfflineBomService.materializePendingVehicleBoms(true);
      res.status(200).json({
        success: true,
        message: `Materialized ${insertedCount} new Vehicle Offline BOM row(s).`,
        data: { insertedCount },
      });
    } catch (err: any) {
      logger.error('Error in VehicleOfflineBomController.materialize:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error during BOM materialization',
      });
    }
  }

  public async getMasterSummary(_req: Request, res: Response): Promise<void> {
    try {
      const models = await vehicleOfflineBomService.getMasterSummary();
      res.status(200).json({
        success: true,
        count: models.length,
        data: models,
      });
    } catch (err: any) {
      logger.error('Error in VehicleOfflineBomController.getMasterSummary:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error while fetching master BOM summary',
      });
    }
  }
}

export const vehicleOfflineBomController = new VehicleOfflineBomController();
