import sql from 'mssql';
import { getDbPool } from '../db/sqlConnection';
import { logger } from '../utils/logger';

export interface CleanupResult {
  retentionDays: number;
  orderBroadcastDeleted: number;
  vehicleBasicInfoDeleted: number;
  vehiclePassingPointDeleted: number;
  vehiclePreciseTraceabilityDeleted: number;
  vehicleOfflineBomDeleted: number;
  totalDeleted: number;
}

export class LogCleanupService {
  /**
   * Automatically deletes log records older than the specified retention days (default: 90 days)
   */
  public async cleanupOldLogs(retentionDays: number = 90): Promise<CleanupResult> {
    try {
      const pool = await getDbPool();
      logger.info(`[LogCleanup] Running automatic log retention cleanup (older than ${retentionDays} days)...`);

      // 1. Clean OrderBroadcast Log
      const req1 = pool.request();
      req1.input('days', sql.Int, retentionDays);
      const res1 = await req1.query(`
        DELETE FROM [dbo].[MES_EAI_OrderBroadcast_Log]
        WHERE [LastAttemptAt] < DATEADD(DAY, -@days, GETDATE());
        SELECT @@ROWCOUNT AS deletedCount;
      `);
      const obDeleted = res1.recordset[0]?.deletedCount || 0;

      // 2. Clean VehicleBasicInfo Log
      const req2 = pool.request();
      req2.input('days', sql.Int, retentionDays);
      const res2 = await req2.query(`
        DELETE FROM [dbo].[MES_EAI_VehicleBasicInfo_Log]
        WHERE [LastAttemptAt] < DATEADD(DAY, -@days, GETDATE());
        SELECT @@ROWCOUNT AS deletedCount;
      `);
      const vbiDeleted = res2.recordset[0]?.deletedCount || 0;

      // 3. Clean VehiclePassingPoint Log
      const req3 = pool.request();
      req3.input('days', sql.Int, retentionDays);
      const res3 = await req3.query(`
        DELETE FROM [dbo].[MES_EAI_VehiclePassingPoint_Log]
        WHERE [LastAttemptAt] < DATEADD(DAY, -@days, GETDATE());
        SELECT @@ROWCOUNT AS deletedCount;
      `);
      const vppDeleted = res3.recordset[0]?.deletedCount || 0;

      // 4. Clean VehiclePreciseTraceability Log
      const req4 = pool.request();
      req4.input('days', sql.Int, retentionDays);
      const res4 = await req4.query(`
        DELETE FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log]
        WHERE [LastAttemptAt] < DATEADD(DAY, -@days, GETDATE());
        SELECT @@ROWCOUNT AS deletedCount;
      `);
      const vptDeleted = res4.recordset[0]?.deletedCount || 0;

      // 5. Clean VehicleOfflineBOM Log (aman jika tabel belum dibuat di DB PRD)
      const req5 = pool.request();
      req5.input('days', sql.Int, retentionDays);
      const res5 = await req5.query(`
        IF OBJECT_ID('dbo.MES_EAI_VehicleOfflineBOM_Log', 'U') IS NOT NULL
        BEGIN
          DELETE FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log]
          WHERE [LastAttemptAt] < DATEADD(DAY, -@days, GETDATE());
          SELECT @@ROWCOUNT AS deletedCount;
        END
        ELSE
        BEGIN
          SELECT 0 AS deletedCount;
        END
      `);
      const vobDeleted = res5.recordset[0]?.deletedCount || 0;

      const totalDeleted = obDeleted + vbiDeleted + vppDeleted + vptDeleted + vobDeleted;
      logger.info(
        `[LogCleanup] Completed. Deleted records: OrderBroadcast: ${obDeleted}, VehicleBasicInfo: ${vbiDeleted}, VehiclePassingPoint: ${vppDeleted}, VehiclePreciseTraceability: ${vptDeleted}, VehicleOfflineBOM: ${vobDeleted} (Total: ${totalDeleted})`
      );

      return {
        retentionDays,
        orderBroadcastDeleted: obDeleted,
        vehicleBasicInfoDeleted: vbiDeleted,
        vehiclePassingPointDeleted: vppDeleted,
        vehiclePreciseTraceabilityDeleted: vptDeleted,
        vehicleOfflineBomDeleted: vobDeleted,
        totalDeleted,
      };
    } catch (error: any) {
      logger.error('[LogCleanup] Error during log retention cleanup:', error);
      throw error;
    }
  }
}

export const logCleanupService = new LogCleanupService();
