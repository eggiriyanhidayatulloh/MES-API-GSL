-- ============================================================================
-- Description: Create table MES_EAI_VehiclePreciseTraceability_Log to track sent keypart traceability records
-- Target DB:   PTSGMW_MES
-- ============================================================================

USE [PTSGMW_MES];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_EAI_VehiclePreciseTraceability_Log')
BEGIN
    CREATE TABLE [dbo].[MES_EAI_VehiclePreciseTraceability_Log] (
        [VIN]                       VARCHAR(50) NOT NULL PRIMARY KEY,
        [KeypartCount]              INT DEFAULT 0,
        [handover_tpoint_date]      VARCHAR(50) NULL,
        [Status]                    VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED'
        [ResponseStatus]            VARCHAR(10) NULL,     -- 'S' / 'E'
        [ResponseMessage]           NVARCHAR(500) NULL,
        [RequestPayload]            NVARCHAR(MAX) NULL,
        [RetryCount]                INT DEFAULT 0,
        [SentAt]                    DATETIME DEFAULT GETDATE(),
        [LastAttemptAt]             DATETIME DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX [IX_MES_EAI_VehiclePreciseTraceability_Log_Status] 
    ON [dbo].[MES_EAI_VehiclePreciseTraceability_Log] ([Status]);

    PRINT 'Table MES_EAI_VehiclePreciseTraceability_Log created successfully.';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('[dbo].[MES_EAI_VehiclePreciseTraceability_Log]') AND name = 'RequestPayload')
    BEGIN
        ALTER TABLE [dbo].[MES_EAI_VehiclePreciseTraceability_Log] ADD [RequestPayload] NVARCHAR(MAX) NULL;
        PRINT 'Added RequestPayload column to MES_EAI_VehiclePreciseTraceability_Log.';
    END
    PRINT 'Table MES_EAI_VehiclePreciseTraceability_Log already exists.';
END
GO
