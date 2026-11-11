-- ============================================================================
-- Description: Cleanup logs older than 90 days from EAI integration log tables
-- Target DB:   PTSGMW_MES
-- Retention:   90 Days
-- ============================================================================

USE [PTSGMW_MES];
GO

DECLARE @RetentionDays INT = 90;

-- 1. Order Broadcast Logs
DELETE FROM [dbo].[MES_EAI_OrderBroadcast_Log]
WHERE [LastAttemptAt] < DATEADD(DAY, -@RetentionDays, GETDATE());
PRINT 'Cleaned OrderBroadcast logs: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' rows deleted.';

-- 2. Vehicle Basic Info Logs
DELETE FROM [dbo].[MES_EAI_VehicleBasicInfo_Log]
WHERE [LastAttemptAt] < DATEADD(DAY, -@RetentionDays, GETDATE());
PRINT 'Cleaned VehicleBasicInfo logs: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' rows deleted.';

-- 3. Vehicle Passing Point Logs
DELETE FROM [dbo].[MES_EAI_VehiclePassingPoint_Log]
WHERE [LastAttemptAt] < DATEADD(DAY, -@RetentionDays, GETDATE());
PRINT 'Cleaned VehiclePassingPoint logs: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' rows deleted.';

-- 4. Vehicle Precise Traceability Logs
DELETE FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log]
WHERE [LastAttemptAt] < DATEADD(DAY, -@RetentionDays, GETDATE());
PRINT 'Cleaned VehiclePreciseTraceability logs: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' rows deleted.';
GO
