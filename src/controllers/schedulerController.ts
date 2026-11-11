import { Request, Response } from 'express';
import { schedulerService, PRESET_PATTERNS } from '../services/schedulerService';
import { interfaceMetadata } from '../data/interfaceMetadata';
import { logger } from '../utils/logger';

export class SchedulerController {
  /**
   * GET /api/scheduler/config
   * Mengambil status scheduler, jadwal aktif, dan preset yang tersedia
   */
  public getConfig(_req: Request, res: Response): void {
    try {
      const status = schedulerService.getStatus();
      res.status(200).json({
        success: true,
        data: {
          ...status,
          presets: PRESET_PATTERNS,
        },
      });
    } catch (error: any) {
      logger.error('Error fetching scheduler config:', error);
      res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  }

  /**
   * PUT /api/scheduler/config/:interfaceKey
   * Memperbarui jadwal scheduler untuk interface tertentu
   */
  public updateConfig(req: Request, res: Response): void {
    try {
      const { interfaceKey } = req.params;
      const updates = req.body;

      if (!interfaceKey) {
        res.status(400).json({ success: false, message: 'Interface key is required.' });
        return;
      }

      const updated = schedulerService.updateInterfaceSchedule(interfaceKey, updates);
      res.status(200).json({
        success: true,
        message: `Scheduler for [${interfaceKey}] updated successfully.`,
        data: updated,
      });
    } catch (error: any) {
      logger.error(`Error updating scheduler for [${req.params.interfaceKey}]:`, error);
      res.status(400).json({ success: false, message: error.message || 'Bad request' });
    }
  }

  /**
   * POST /api/scheduler/toggle/:interfaceKey
   * Menyalakan atau mematikan scheduler interface tertentu
   */
  public toggleInterface(req: Request, res: Response): void {
    try {
      const { interfaceKey } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ success: false, message: 'Field "enabled" (boolean) is required.' });
        return;
      }

      const updated = schedulerService.updateInterfaceSchedule(interfaceKey, { enabled });
      res.status(200).json({
        success: true,
        message: `Interface [${interfaceKey}] scheduler is now ${enabled ? 'ENABLED' : 'DISABLED'}.`,
        data: updated,
      });
    } catch (error: any) {
      logger.error(`Error toggling interface scheduler [${req.params.interfaceKey}]:`, error);
      res.status(400).json({ success: false, message: error.message || 'Bad request' });
    }
  }

  /**
   * POST /api/scheduler/global
   * Mengubah status scheduler global (ON / OFF)
   */
  public setGlobal(req: Request, res: Response): void {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ success: false, message: 'Field "enabled" (boolean) is required.' });
        return;
      }

      const result = schedulerService.setGlobalEnabled(enabled);
      res.status(200).json({
        success: true,
        message: `Global scheduler is now ${result ? 'ENABLED' : 'DISABLED'}.`,
        globalEnabled: result,
      });
    } catch (error: any) {
      logger.error('Error setting global scheduler state:', error);
      res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  }

  /**
   * GET /api/scheduler/details/:interfaceKey
   * Mengambil detail lengkap interface: SQL query, tabel referensi, script mapping, dan jadwal aktif
   */
  public getInterfaceDetails(req: Request, res: Response): void {
    try {
      const { interfaceKey } = req.params;
      const meta = interfaceMetadata[interfaceKey];

      if (!meta) {
        res.status(404).json({ success: false, message: `Interface [${interfaceKey}] not found.` });
        return;
      }

      const status = schedulerService.getStatus();
      const scheduleConfig = status.interfaces[interfaceKey] || null;

      res.status(200).json({
        success: true,
        data: {
          ...meta,
          schedule: scheduleConfig,
        },
      });
    } catch (error: any) {
      logger.error(`Error fetching interface details for [${req.params.interfaceKey}]:`, error);
      res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  }
}

export const schedulerController = new SchedulerController();
