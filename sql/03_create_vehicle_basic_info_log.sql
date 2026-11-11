-- ============================================================================
-- Description: Create table MES_EAI_VehicleBasicInfo_Log to track sent VIN records
-- Target DB:   PTSGMW_MES
-- NOTE:        mg_car_as_data is strictly READ-ONLY. Tracking occurs exclusively here.
-- ============================================================================

USE [PTSGMW_MES];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_EAI_VehicleBasicInfo_Log')
BEGIN
    CREATE TABLE [dbo].[MES_EAI_VehicleBasicInfo_Log] (
        [VIN]                       VARCHAR(50) NOT NULL PRIMARY KEY,
        [TransmissionID]            VARCHAR(20) NULL,
        [VehicleCode]               VARCHAR(50) NULL,
        [FeatureCount]              INT DEFAULT 0,
        [Status]                    VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED'
        [ResponseStatus]            VARCHAR(10) NULL,     -- 'S' / 'E'
        [ResponseMessage]           NVARCHAR(500) NULL,
        [RequestPayload]            NVARCHAR(MAX) NULL,
        [RetryCount]                INT DEFAULT 0,
        [SentAt]                    DATETIME DEFAULT GETDATE(),
        [LastAttemptAt]             DATETIME DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX [IX_MES_EAI_VehicleBasicInfo_Log_Status] 
    ON [dbo].[MES_EAI_VehicleBasicInfo_Log] ([Status]);

    PRINT 'Table MES_EAI_VehicleBasicInfo_Log created successfully.';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('[dbo].[MES_EAI_VehicleBasicInfo_Log]') AND name = 'RequestPayload')
    BEGIN
        ALTER TABLE [dbo].[MES_EAI_VehicleBasicInfo_Log] ADD [RequestPayload] NVARCHAR(MAX) NULL;
        PRINT 'Added RequestPayload column to MES_EAI_VehicleBasicInfo_Log.';
    END
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('[dbo].[MES_EAI_VehicleBasicInfo_Log]') AND name = 'TransmissionID')
    BEGIN
        ALTER TABLE [dbo].[MES_EAI_VehicleBasicInfo_Log] ADD [TransmissionID] VARCHAR(20) NULL;
        PRINT 'Added TransmissionID column to MES_EAI_VehicleBasicInfo_Log.';
    END
    PRINT 'Table MES_EAI_VehicleBasicInfo_Log already exists.';
END
GO
