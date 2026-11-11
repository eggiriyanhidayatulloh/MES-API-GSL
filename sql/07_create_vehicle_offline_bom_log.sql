-- ============================================================================
-- Description: Create tables for Vehicle Offline BOM (Source & Transmission Log)
-- Target DB:   PTSGMW_MES
-- Interface:   MES_VehicleOfflineBOM_Pub
-- Endpoint:    http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub
-- ============================================================================

USE [PTSGMW_MES];
GO

-- 1. Table Data Source: [dbo].[MES_Vehicle_OfflineBOM]
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_Vehicle_OfflineBOM')
BEGIN
    CREATE TABLE [dbo].[MES_Vehicle_OfflineBOM] (
        [Auto_ID]                   BIGINT IDENTITY(1,1) PRIMARY KEY,
        [bomversion]                VARCHAR(50) NULL,
        [plantNo]                   VARCHAR(20) NOT NULL DEFAULT 'ID001',
        [plantName]                 VARCHAR(100) NOT NULL DEFAULT 'PT. SGMW Motor Indonesia',
        [plantNameC]                NVARCHAR(100) NOT NULL DEFAULT 'Cikarang Factory',
        [materialNo]                VARCHAR(50) NOT NULL,
        [partno]                    VARCHAR(50) NOT NULL,
        [product]                   VARCHAR(50) NOT NULL,
        [modelyear]                 VARCHAR(20) NOT NULL,
        [ecuname]                   VARCHAR(50) NOT NULL,
        [moduleid]                  VARCHAR(20) NULL,
        [vin]                       VARCHAR(50) NULL,
        [isDeleted]                 VARCHAR(10) NOT NULL DEFAULT '0',
        [CreatedAt]                 DATETIME DEFAULT GETDATE(),
        [UpdatedAt]                 DATETIME DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX [IX_MES_Vehicle_OfflineBOM_Material] 
    ON [dbo].[MES_Vehicle_OfflineBOM] ([materialNo], [partno]);

    -- Insert Initial Reference Sample Data (bomversion resolved from [BaseData].[dbo].[VehicleCode])
    INSERT INTO [dbo].[MES_Vehicle_OfflineBOM] (
        [bomversion], [plantNo], [plantName], [plantNameC], [materialNo],
        [partno], [product], [modelyear], [ecuname], [moduleid], [vin], [isDeleted]
    ) VALUES (
        '20260130', 'ID001', 'PT. SGMW Motor Indonesia', 'Cikarang Factory', 'MMSL1D03XCLWSB',
        '10202085', 'ZSC', '2024', 'HVAC', '00', NULL, '0'
    );

    PRINT 'Table MES_Vehicle_OfflineBOM created successfully with sample data.';
END
ELSE
BEGIN
    PRINT 'Table MES_Vehicle_OfflineBOM already exists.';
END
GO

-- 2. Table Transmission Log: [dbo].[MES_EAI_VehicleOfflineBOM_Log]
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_EAI_VehicleOfflineBOM_Log')
BEGIN
    CREATE TABLE [dbo].[MES_EAI_VehicleOfflineBOM_Log] (
        [LogID]                     BIGINT IDENTITY(1,1) PRIMARY KEY,
        [BOMRecordID]               BIGINT NOT NULL,
        [MaterialNo]                VARCHAR(50) NULL,
        [PartNo]                    VARCHAR(50) NULL,
        [ECUName]                   VARCHAR(50) NULL,
        [BOMVersion]                VARCHAR(50) NULL,
        [VIN]                       VARCHAR(50) NULL,
        [Status]                    VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED'
        [ResponseStatus]            VARCHAR(10) NULL,     -- 'S' / 'E'
        [ResponseMessage]           NVARCHAR(500) NULL,
        [RequestPayload]            NVARCHAR(MAX) NULL,
        [RetryCount]                INT DEFAULT 0,
        [SentAt]                    DATETIME DEFAULT GETDATE(),
        [LastAttemptAt]             DATETIME DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX [IX_MES_EAI_VehicleOfflineBOM_Log_BOMRecordID] 
    ON [dbo].[MES_EAI_VehicleOfflineBOM_Log] ([BOMRecordID]);

    CREATE NONCLUSTERED INDEX [IX_MES_EAI_VehicleOfflineBOM_Log_Status] 
    ON [dbo].[MES_EAI_VehicleOfflineBOM_Log] ([Status]);

    PRINT 'Table MES_EAI_VehicleOfflineBOM_Log created successfully.';
END
ELSE
BEGIN
    PRINT 'Table MES_EAI_VehicleOfflineBOM_Log already exists.';
END
GO
