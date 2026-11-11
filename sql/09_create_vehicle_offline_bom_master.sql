-- ============================================================================
-- Description: Create Master Template & Model Mapping tables for Vehicle Offline BOM
-- Target DB:   PTSGMW_MES
-- Interface:   MES_VehicleOfflineBOM_Pub
-- Purpose:     Stores master (ecuname, moduleid, partno) templates per vehicle model
--              so MES-API-GSL can dynamically combine them with Vehicle Basic Info
--              (bomversion, materialNo/vehiclecode, product, modelyear) per VIN.
-- ============================================================================

USE [PTSGMW_MES];
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Model Mapping Table: maps 11-char vehiclecode prefix & CarVarietyCode -> ModelCode
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_Vehicle_OfflineBOM_ModelMap')
BEGIN
    CREATE TABLE [dbo].[MES_Vehicle_OfflineBOM_ModelMap] (
        [MapID]             INT IDENTITY(1,1) PRIMARY KEY,
        [ModelCode]         VARCHAR(50) NOT NULL,
        [ModelName]         VARCHAR(100) NOT NULL,
        [CarVarietyCode]    VARCHAR(20) NULL,
        [VehicleCodePrefix] VARCHAR(20) NOT NULL,
        [CreatedAt]         DATETIME DEFAULT GETDATE()
    );

    CREATE UNIQUE NONCLUSTERED INDEX [UX_MES_Vehicle_OfflineBOM_ModelMap_Prefix]
    ON [dbo].[MES_Vehicle_OfflineBOM_ModelMap] ([VehicleCodePrefix]);

    CREATE NONCLUSTERED INDEX [IX_MES_Vehicle_OfflineBOM_ModelMap_Variety]
    ON [dbo].[MES_Vehicle_OfflineBOM_ModelMap] ([CarVarietyCode]);

    PRINT 'Table MES_Vehicle_OfflineBOM_ModelMap created successfully.';
END
GO

-- 2. Master BOM Template Table: stores (ecuname, moduleid, partno) per ModelCode
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MES_Vehicle_OfflineBOM_Master')
BEGIN
    CREATE TABLE [dbo].[MES_Vehicle_OfflineBOM_Master] (
        [MasterID]  BIGINT IDENTITY(1,1) PRIMARY KEY,
        [ModelCode] VARCHAR(50) NOT NULL,
        [partno]    VARCHAR(50) NOT NULL,
        [ecuname]   VARCHAR(50) NOT NULL,
        [moduleid]  VARCHAR(20) NOT NULL,
        [isDeleted] VARCHAR(10) NOT NULL DEFAULT '0',
        [CreatedAt] DATETIME DEFAULT GETDATE(),
        [UpdatedAt] DATETIME DEFAULT GETDATE()
    );

    CREATE UNIQUE NONCLUSTERED INDEX [UX_MES_Vehicle_OfflineBOM_Master_Item]
    ON [dbo].[MES_Vehicle_OfflineBOM_Master] ([ModelCode], [ecuname], [moduleid], [partno]);

    PRINT 'Table MES_Vehicle_OfflineBOM_Master created successfully.';
END
GO

-- 3. Filtered unique index on MES_Vehicle_OfflineBOM for per-VIN deduplication
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_MES_Vehicle_OfflineBOM_VinItem'
      AND object_id = OBJECT_ID('[dbo].[MES_Vehicle_OfflineBOM]')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_MES_Vehicle_OfflineBOM_VinItem]
    ON [dbo].[MES_Vehicle_OfflineBOM] ([vin], [ecuname], [moduleid], [partno])
    WHERE [vin] IS NOT NULL;

    PRINT 'Filtered unique index UX_MES_Vehicle_OfflineBOM_VinItem created successfully.';
END
GO

