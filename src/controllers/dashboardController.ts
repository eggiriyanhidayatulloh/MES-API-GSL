import { Request, Response } from 'express';
import sql from 'mssql';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { vehicleOfflineBomService } from '../services/vehicleOfflineBomService';
import { schedulerService } from '../services/schedulerService';
import { buildStrictMgWhereSql, buildReleaseDateFilterSql } from '../utils/vehicleFilter';

export class DashboardController {
  public async getSummary(_req: Request, res: Response): Promise<void> {
    try {
      const pool = await getDbPool();

      // 1. Order Broadcast Stats
      const obCountsQuery = `
        SELECT 
          COUNT(CASE WHEN Status = 'SUCCESS' THEN 1 END) AS successCount,
          COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) AS failedCount,
          COUNT(*) AS totalLogged
        FROM [dbo].[MES_EAI_OrderBroadcast_Log] WITH (NOLOCK);
      `;
      const obCountsResult = await pool.request().query(obCountsQuery);
      const obCounts = obCountsResult.recordset[0] || { successCount: 0, failedCount: 0, totalLogged: 0 };

      const obPendingQuery = `
        SELECT COUNT(*) AS pendingCount
        FROM [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK)
        INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) ON b.VIN = c.vin
        LEFT JOIN [dbo].[MES_EAI_OrderBroadcast_Log] l WITH (NOLOCK) ON b.VIN = l.VIN
        WHERE ${buildStrictMgWhereSql({ traceAlias: 'c' })}
          AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
          AND c.GAOnline_Tpoint_ExactDate <> ''
          AND ${buildReleaseDateFilterSql(['c.GAOnline_Tpoint_ExactDate'])}
          AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry));
      `;
      const reqObPending = pool.request();
      reqObPending.input('maxRetry', sql.Int, config.processing.maxRetryCount);
      reqObPending.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);
      const obPendingResult = await reqObPending.query(obPendingQuery);
      const obPending = obPendingResult.recordset[0]?.pendingCount || 0;

      // 2. Vehicle Basic Info Stats
      const vbiCountsQuery = `
        SELECT 
          COUNT(CASE WHEN Status = 'SUCCESS' THEN 1 END) AS successCount,
          COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) AS failedCount,
          COUNT(*) AS totalLogged
        FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WITH (NOLOCK);
      `;
      const vbiCountsResult = await pool.request().query(vbiCountsQuery);
      const vbiCounts = vbiCountsResult.recordset[0] || { successCount: 0, failedCount: 0, totalLogged: 0 };

      const vbiPendingQuery = `
        SELECT COUNT(*) AS pendingCount
        FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
        LEFT JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) ON m.vin = c.vin
        LEFT JOIN [BaseData].[dbo].[CarVarietyCode] v WITH (NOLOCK) ON c.CarVarietyCode = v.CarVarietyCode
        LEFT JOIN [dbo].[MES_EAI_VehicleBasicInfo_Log] l WITH (NOLOCK) ON m.vin = l.VIN
        WHERE ${buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm', varietyAlias: 'v' })}
          AND ${buildReleaseDateFilterSql(['m.handover_tpoint_date', 'c.handover_tpoint_date', 'm.createtime'])}
          AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry));
      `;
      const reqVbiPending = pool.request();
      reqVbiPending.input('maxRetry', sql.Int, config.processing.maxRetryCount);
      reqVbiPending.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);
      const vbiPendingResult = await reqVbiPending.query(vbiPendingQuery);
      const vbiPending = vbiPendingResult.recordset[0]?.pendingCount || 0;

      // 3. Vehicle Passing Point Stats
      const vppCountsQuery = `
        SELECT 
          COUNT(CASE WHEN Status = 'SUCCESS' THEN 1 END) AS successCount,
          COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) AS failedCount,
          COUNT(*) AS totalLogged
        FROM [dbo].[MES_EAI_VehiclePassingPoint_Log] WITH (NOLOCK);
      `;
      const vppCountsResult = await pool.request().query(vppCountsQuery);
      const vppCounts = vppCountsResult.recordset[0] || { successCount: 0, failedCount: 0, totalLogged: 0 };

      const vppPendingQuery = `
        SELECT COUNT(*) AS pendingCount
        FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
        INNER JOIN [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK) ON m.vin = b.VIN
        INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) ON m.vin = c.vin
        LEFT JOIN [dbo].[MES_EAI_VehiclePassingPoint_Log] l WITH (NOLOCK) ON b.VIN = l.VIN
        WHERE ${buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' })}
          AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
          AND c.handover_tpoint_date IS NOT NULL 
          AND c.handover_tpoint_date <> ''
          AND ${buildReleaseDateFilterSql(['c.handover_tpoint_date'])}
          AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry));
      `;
      const reqVppPending = pool.request();
      reqVppPending.input('maxRetry', sql.Int, config.processing.maxRetryCount);
      reqVppPending.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);
      const vppPendingResult = await reqVppPending.query(vppPendingQuery);
      const vppPending = vppPendingResult.recordset[0]?.pendingCount || 0;

      // 4. Vehicle Precise Traceability Stats
      const vptCountsQuery = `
        SELECT 
          COUNT(CASE WHEN Status = 'SUCCESS' THEN 1 END) AS successCount,
          COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) AS failedCount,
          COUNT(*) AS totalLogged
        FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log] WITH (NOLOCK);
      `;
      const vptCountsResult = await pool.request().query(vptCountsQuery);
      const vptCounts = vptCountsResult.recordset[0] || { successCount: 0, failedCount: 0, totalLogged: 0 };

      const vptPendingQuery = `
        SELECT COUNT(*) AS pendingCount
        FROM [dbo].[MES_MQ_RecallItems] r WITH (NOLOCK)
        INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) ON r.vin = c.vin
        LEFT JOIN [dbo].[mg_car_as_data] m WITH (NOLOCK) ON r.vin = m.vin
        LEFT JOIN [dbo].[MES_EAI_VehiclePreciseTraceability_Log] l WITH (NOLOCK) ON r.vin = l.VIN
        WHERE ${buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' })}
          AND c.handover_tpoint_date IS NOT NULL 
          AND c.handover_tpoint_date <> ''
          AND ${buildReleaseDateFilterSql(['c.handover_tpoint_date'])}
          AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry));
      `;
      const reqVptPending = pool.request();
      reqVptPending.input('maxRetry', sql.Int, config.processing.maxRetryCount);
      reqVptPending.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);
      const vptPendingResult = await reqVptPending.query(vptPendingQuery);
      const vptPending = vptPendingResult.recordset[0]?.pendingCount || 0;

      // 5. Vehicle Offline BOM Stats (hanya auto-materialize jika scheduler interface aktif, aman jika tabel belum ada di DB PRD)
      if (schedulerService.isInterfaceEnabled('vehicle-offline-bom')) {
        await vehicleOfflineBomService.materializePendingVehicleBoms(false);
      }
      const vobCountsQuery = `
        IF OBJECT_ID('dbo.MES_EAI_VehicleOfflineBOM_Log', 'U') IS NOT NULL
        BEGIN
          SELECT 
            COUNT(CASE WHEN Status = 'SUCCESS' THEN 1 END) AS successCount,
            COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) AS failedCount,
            COUNT(*) AS totalLogged
          FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] WITH (NOLOCK);
        END
        ELSE
        BEGIN
          SELECT 0 AS successCount, 0 AS failedCount, 0 AS totalLogged;
        END
      `;
      const vobCountsResult = await pool.request().query(vobCountsQuery);
      const vobCounts = vobCountsResult.recordset[0] || { successCount: 0, failedCount: 0, totalLogged: 0 };

      const vobPendingQuery = `
        IF OBJECT_ID('dbo.MES_Vehicle_OfflineBOM', 'U') IS NOT NULL
           AND OBJECT_ID('dbo.MES_EAI_VehicleOfflineBOM_Log', 'U') IS NOT NULL
        BEGIN
          SELECT COUNT(*) AS pendingCount
          FROM [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
          LEFT JOIN [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK) ON b.Auto_ID = l.BOMRecordID
          WHERE (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry));
        END
        ELSE
        BEGIN
          SELECT 0 AS pendingCount;
        END
      `;
      const reqVobPending = pool.request();
      reqVobPending.input('maxRetry', sql.Int, config.processing.maxRetryCount);
      const vobPendingResult = await reqVobPending.query(vobPendingQuery);
      const vobPending = vobPendingResult.recordset[0]?.pendingCount || 0;

      // 6. Recent Logs for all 5 interfaces (Dates converted to style 120 YYYY-MM-DD HH:mm:ss in GMT+7)
      const obLogsQuery = `
        SELECT TOP 50
          [VIN], [plan_ID], [GAOnline_Tpoint_ExactDate], [Status], 
          [ResponseStatus], [ResponseMessage], [RetryCount],
          CONVERT(VARCHAR(19), [SentAt], 120) AS [SentAt],
          CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt]
        FROM [dbo].[MES_EAI_OrderBroadcast_Log] WITH (NOLOCK)
        ORDER BY [LastAttemptAt] DESC;
      `;
      const obLogsResult = await pool.request().query(obLogsQuery);
      const recentOrderBroadcast = obLogsResult.recordset || [];

      const vbiLogsQuery = `
        SELECT TOP 50
          [VIN], [TransmissionID], [VehicleCode], [FeatureCount], [Status], 
          [ResponseStatus], [ResponseMessage], [RetryCount],
          CONVERT(VARCHAR(19), [SentAt], 120) AS [SentAt],
          CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt]
        FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WITH (NOLOCK)
        ORDER BY [LastAttemptAt] DESC;
      `;
      const vbiLogsResult = await pool.request().query(vbiLogsQuery);
      const recentVehicleBasicInfo = vbiLogsResult.recordset || [];

      const vppLogsQuery = `
        SELECT TOP 50
          [VIN], [moNum], [handover_tpoint_date], [Status], 
          [ResponseStatus], [ResponseMessage], [RetryCount],
          CONVERT(VARCHAR(19), [SentAt], 120) AS [SentAt],
          CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt]
        FROM [dbo].[MES_EAI_VehiclePassingPoint_Log] WITH (NOLOCK)
        ORDER BY [LastAttemptAt] DESC;
      `;
      const vppLogsResult = await pool.request().query(vppLogsQuery);
      const recentVehiclePassingPoint = vppLogsResult.recordset || [];

      const vptLogsQuery = `
        SELECT TOP 50
          [VIN], [KeypartCount], [handover_tpoint_date], [Status], 
          [ResponseStatus], [ResponseMessage], [RetryCount],
          CONVERT(VARCHAR(19), [SentAt], 120) AS [SentAt],
          CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt]
        FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log] WITH (NOLOCK)
        ORDER BY [LastAttemptAt] DESC;
      `;
      const vptLogsResult = await pool.request().query(vptLogsQuery);
      const recentVehiclePreciseTraceability = vptLogsResult.recordset || [];

      const vobLogsQuery = `
        IF OBJECT_ID('dbo.MES_EAI_VehicleOfflineBOM_Log', 'U') IS NOT NULL
           AND OBJECT_ID('dbo.MES_Vehicle_OfflineBOM', 'U') IS NOT NULL
        BEGIN
          SELECT TOP 50
            l.[LogID], l.[BOMRecordID] AS [recordId], l.[BOMRecordID], l.[MaterialNo], l.[PartNo],
            l.[BOMVersion], l.[ECUName], b.[moduleid] AS [moduleid], l.[VIN],
            l.[Status], l.[ResponseStatus], l.[ResponseMessage], l.[RetryCount],
            CONVERT(VARCHAR(19), l.[SentAt], 120) AS [SentAt],
            CONVERT(VARCHAR(19), l.[LastAttemptAt], 120) AS [LastAttemptAt]
          FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
          LEFT JOIN [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
            ON l.[BOMRecordID] = b.[Auto_ID]
          ORDER BY l.[LastAttemptAt] DESC;
        END
      `;
      const vobLogsResult = await pool.request().query(vobLogsQuery);
      const recentVehicleOfflineBom = vobLogsResult.recordset || [];

      const serverInfo = {
        service: 'MES-API-GSL',
        uptimeSeconds: Math.floor(process.uptime()),
        environment: config.eai.environment,
        database: {
          server: config.db.server,
          database: config.db.database,
          status: pool.connected ? 'CONNECTED' : 'DISCONNECTED',
        },
        endpoints: {
          orderBroadcast: config.eai.orderBroadcastUrl,
          vehicleBasicInfo: config.eai.vehicleBasicInfoUrl,
          vehiclePassingPoint: config.eai.vehiclePassingPointUrl,
          vehiclePreciseTraceability: config.eai.vehiclePreciseTraceabilityUrl,
          vehicleOfflineBom: config.eai.vehicleOfflineBomUrl,
        },
        scheduler: {
          enabled: config.scheduler.enabled,
          cronOrderBroadcast: config.scheduler.cronOrderBroadcast,
          cronVehicleBasicInfo: config.scheduler.cronVehicleBasicInfo,
          cronVehiclePassingPoint: config.scheduler.cronVehiclePassingPoint,
          cronVehiclePreciseTraceability: config.scheduler.cronVehiclePreciseTraceability,
          cronVehicleOfflineBom: config.scheduler.cronVehicleOfflineBom,
        },
      };

      const statsInfo = {
        orderBroadcast: {
          success: obCounts.successCount || 0,
          failed: obCounts.failedCount || 0,
          pending: obPending,
          totalLogged: obCounts.totalLogged || 0,
        },
        vehicleBasicInfo: {
          success: vbiCounts.successCount || 0,
          failed: vbiCounts.failedCount || 0,
          pending: vbiPending,
          totalLogged: vbiCounts.totalLogged || 0,
        },
        vehiclePassingPoint: {
          success: vppCounts.successCount || 0,
          failed: vppCounts.failedCount || 0,
          pending: vppPending,
          totalLogged: vppCounts.totalLogged || 0,
        },
        vehiclePreciseTraceability: {
          success: vptCounts.successCount || 0,
          failed: vptCounts.failedCount || 0,
          pending: vptPending,
          totalLogged: vptCounts.totalLogged || 0,
        },
        vehicleOfflineBom: {
          success: vobCounts.successCount || 0,
          failed: vobCounts.failedCount || 0,
          pending: vobPending,
          totalLogged: vobCounts.totalLogged || 0,
        },
      };

      const logsInfo = {
        orderBroadcast: recentOrderBroadcast,
        vehicleBasicInfo: recentVehicleBasicInfo,
        vehiclePassingPoint: recentVehiclePassingPoint,
        vehiclePreciseTraceability: recentVehiclePreciseTraceability,
        vehicleOfflineBom: recentVehicleOfflineBom,
      };

      res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        system: serverInfo,
        stats: statsInfo,
        logs: logsInfo,
        data: {
          server: serverInfo,
          system: serverInfo,
          stats: statsInfo,
          logs: logsInfo,
        },
      });
    } catch (error: any) {
      logger.error('Error in getSummary dashboard controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch dashboard summary',
      });
    }
  }
}

export const dashboardController = new DashboardController();
