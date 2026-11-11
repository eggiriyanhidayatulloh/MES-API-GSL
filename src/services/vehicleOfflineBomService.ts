import sql from 'mssql';
import axios from 'axios';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  VehicleOfflineBomRecord,
  VehicleOfflineBomPayload,
  VehicleOfflineBomSyncResult,
} from '../types/vehicleOfflineBom';
import { EaiResponse } from '../types/orderBroadcast';
import { parseEaiResponse, extractEaiErrorMessage } from '../utils/eaiHelper';
import masterBomJson from '../data/vehicleOfflineBomMaster.json';

interface MasterBomItem {
  ecuname: string;
  moduleid: string;
  partno: string;
  isDeleted?: string;
}

interface MasterBomModel {
  modelCode: string;
  modelName: string;
  mappings: Array<{ carVarietyCode: string; vehicleCodePrefix: string }>;
  items: MasterBomItem[];
}

interface MasterBomConfig {
  models: MasterBomModel[];
}

const masterBomConfig = masterBomJson as MasterBomConfig;

export class VehicleOfflineBomService {
  private schemaReady = false;
  private schemaPromise: Promise<void> | null = null;
  private materializePromise: Promise<number> | null = null;
  private lastMaterializedAt = 0;
  private readonly materializeCooldownMs = 15000;

  /**
   * Memastikan tabel master & mapping Vehicle Offline BOM tersedia dan ter-seed dari konfigurasi
   */
  public async ensureMasterSchemaAndSeed(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    if (this.schemaPromise) {
      return this.schemaPromise;
    }

    this.schemaPromise = (async () => {
      try {
        const pool = await getDbPool();
        await pool.request().query(`
          SET ANSI_NULLS ON;
          SET QUOTED_IDENTIFIER ON;

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
          END

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
          END

          IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'UX_MES_Vehicle_OfflineBOM_VinItem'
              AND object_id = OBJECT_ID('[dbo].[MES_Vehicle_OfflineBOM]')
          )
          BEGIN
            CREATE UNIQUE NONCLUSTERED INDEX [UX_MES_Vehicle_OfflineBOM_VinItem]
            ON [dbo].[MES_Vehicle_OfflineBOM] ([vin], [ecuname], [moduleid], [partno])
            WHERE [vin] IS NOT NULL;
          END
        `);

        const needsSeed = await this.isMasterSeedIncomplete(pool);
        if (needsSeed) {
          const seeded = await this.seedMasterFromConfig();
          logger.info(
            `[VehicleOfflineBOM] Master BOM seeded: ${seeded.mappingsInserted} mapping(s), ${seeded.itemsInserted} item(s).`
          );
        }

        this.schemaReady = true;
      } catch (err) {
        logger.error('[VehicleOfflineBOM] Failed to initialize master schema/seed:', err);
        throw err;
      } finally {
        this.schemaPromise = null;
      }
    })();

    return this.schemaPromise;
  }

  private async isMasterSeedIncomplete(pool: sql.ConnectionPool): Promise<boolean> {
    const mapRes = await pool.request().query(`
      SELECT [VehicleCodePrefix] FROM [dbo].[MES_Vehicle_OfflineBOM_ModelMap] WITH (NOLOCK);
    `);
    const existingPrefixes = new Set(mapRes.recordset.map((r: any) => String(r.VehicleCodePrefix).trim()));

    const masterRes = await pool.request().query(`
      SELECT [ModelCode], COUNT(*) AS cnt
      FROM [dbo].[MES_Vehicle_OfflineBOM_Master] WITH (NOLOCK)
      GROUP BY [ModelCode];
    `);
    const existingCounts = new Map<string, number>();
    for (const row of masterRes.recordset) {
      existingCounts.set(String(row.ModelCode).trim(), Number(row.cnt || 0));
    }

    for (const model of masterBomConfig.models) {
      for (const mapping of model.mappings) {
        if (!existingPrefixes.has(mapping.vehicleCodePrefix)) {
          return true;
        }
      }
      if ((existingCounts.get(model.modelCode) || 0) < model.items.length) {
        return true;
      }
    }
    return false;
  }

  /**
   * Seed tabel mapping model dan master ECU/ModuleId/PartNo dari vehicleOfflineBomMaster.json secara idempoten
   */
  public async seedMasterFromConfig(): Promise<{ mappingsInserted: number; itemsInserted: number }> {
    const pool = await getDbPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    let mappingsInserted = 0;
    let itemsInserted = 0;

    try {
      for (const model of masterBomConfig.models) {
        for (const mapping of model.mappings) {
          const req = new sql.Request(transaction);
          req.input('modelCode', sql.VarChar(50), model.modelCode);
          req.input('modelName', sql.VarChar(100), model.modelName);
          req.input('carVarietyCode', sql.VarChar(20), mapping.carVarietyCode || null);
          req.input('prefix', sql.VarChar(20), mapping.vehicleCodePrefix);

          const res = await req.query(`
            IF NOT EXISTS (
              SELECT 1 FROM [dbo].[MES_Vehicle_OfflineBOM_ModelMap]
              WHERE [VehicleCodePrefix] = @prefix
            )
            BEGIN
              INSERT INTO [dbo].[MES_Vehicle_OfflineBOM_ModelMap]
                ([ModelCode], [ModelName], [CarVarietyCode], [VehicleCodePrefix])
              VALUES (@modelCode, @modelName, @carVarietyCode, @prefix);
              SELECT 1 AS inserted;
            END
            ELSE
            BEGIN
              SELECT 0 AS inserted;
            END
          `);
          mappingsInserted += res.recordset[0]?.inserted || 0;
        }

        // Insert master items in chunks of 100 rows using parameterized multi-row VALUES
        const chunkSize = 100;
        for (let i = 0; i < model.items.length; i += chunkSize) {
          const chunk = model.items.slice(i, i + chunkSize);
          const req = new sql.Request(transaction);
          req.input('modelCode', sql.VarChar(50), model.modelCode);

          const valueRows: string[] = [];
          chunk.forEach((item, idx) => {
            req.input(`partno${idx}`, sql.VarChar(50), item.partno);
            req.input(`ecuname${idx}`, sql.VarChar(50), item.ecuname);
            req.input(`moduleid${idx}`, sql.VarChar(20), item.moduleid);
            req.input(`isDeleted${idx}`, sql.VarChar(10), item.isDeleted || '0');
            valueRows.push(`(@modelCode, @partno${idx}, @ecuname${idx}, @moduleid${idx}, @isDeleted${idx})`);
          });

          const res = await req.query(`
            INSERT INTO [dbo].[MES_Vehicle_OfflineBOM_Master]
              ([ModelCode], [partno], [ecuname], [moduleid], [isDeleted])
            SELECT v.ModelCode, v.partno, v.ecuname, v.moduleid, v.isDeleted
            FROM (VALUES ${valueRows.join(', ')}) AS v(ModelCode, partno, ecuname, moduleid, isDeleted)
            WHERE NOT EXISTS (
              SELECT 1 FROM [dbo].[MES_Vehicle_OfflineBOM_Master] existing
              WHERE existing.[ModelCode] = v.ModelCode
                AND existing.[ecuname] = v.ecuname
                AND existing.[moduleid] = v.moduleid
                AND existing.[partno] = v.partno
            );
            SELECT @@ROWCOUNT AS inserted;
          `);
          itemsInserted += res.recordset[0]?.inserted || 0;
        }
      }

      await transaction.commit();
      return { mappingsInserted, itemsInserted };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  /**
   * Menghasilkan / melengkapi baris MES_Vehicle_OfflineBOM per VIN dengan menggabungkan
   * field Vehicle Basic Info (bomversion, materialNo=vehiclecode, product, modelyear)
   * dan master ECU/ModuleId/PartNo berdasarkan model mobilnya.
   */
  public async materializePendingVehicleBoms(force: boolean = false): Promise<number> {
    await this.ensureMasterSchemaAndSeed();

    if (!force && Date.now() - this.lastMaterializedAt < this.materializeCooldownMs) {
      return 0;
    }

    if (this.materializePromise) {
      return this.materializePromise;
    }

    this.materializePromise = (async () => {
      try {
        const pool = await getDbPool();
        const query = `
          ;WITH RawVehicles AS (
            SELECT
              COALESCE(m.vin, c.vin) AS vin,
              COALESCE(NULLIF(LTRIM(RTRIM(m.vehiclecode)), ''), NULLIF(LTRIM(RTRIM(vc.vehiclecode)), ''), '') AS vehiclecode,
              COALESCE(NULLIF(LTRIM(RTRIM(m.bomversion)), ''), NULLIF(LTRIM(RTRIM(vc.bomversion)), ''), '') AS bomversion,
              COALESCE(NULLIF(LTRIM(RTRIM(m.noproduct)), ''), NULLIF(LTRIM(RTRIM(vc.noproduct)), ''), '') AS product,
              COALESCE(NULLIF(LTRIM(RTRIM(m.modelyear)), ''), NULLIF(LTRIM(RTRIM(vc.modelyear)), ''), '') AS modelyear,
              COALESCE(
                NULLIF(LTRIM(RTRIM(c.CarVarietyCode)), ''),
                LEFT(NULLIF(LTRIM(RTRIM(m.vsn_10)), ''), 4),
                LEFT(NULLIF(LTRIM(RTRIM(c.vsn)), ''), 4),
                ''
              ) AS carVarietyCode
            FROM [dbo].[MES_Trace_Cars] c WITH (NOLOCK)
            FULL OUTER JOIN [dbo].[mg_car_as_data] m WITH (NOLOCK)
              ON c.vin = m.vin
            OUTER APPLY (
              SELECT TOP 1
                vc1.vehiclecode,
                vc1.bomversion,
                vc1.noproduct,
                vc1.modelyear
              FROM [BaseData].[dbo].[VehicleCode] vc1 WITH (NOLOCK)
              WHERE vc1.vsn = LEFT(COALESCE(NULLIF(LTRIM(RTRIM(m.vsn_10)), ''), NULLIF(LTRIM(RTRIM(c.vsn)), ''), ''), 10)
            ) vc
            WHERE (c.ExtItem9 = 'MG' OR m.brand = 'MG')
              AND COALESCE(m.vin, c.vin) IS NOT NULL
              AND COALESCE(m.vin, c.vin) <> ''
          ),
          MatchedVehicles AS (
            SELECT
              rv.vin,
              rv.vehiclecode AS materialNo,
              rv.bomversion,
              rv.product,
              rv.modelyear,
              COALESCE(mmPrefix.ModelCode, mmVariety.ModelCode) AS ModelCode
            FROM RawVehicles rv
            OUTER APPLY (
              SELECT TOP 1 mm.ModelCode
              FROM [dbo].[MES_Vehicle_OfflineBOM_ModelMap] mm WITH (NOLOCK)
              WHERE rv.vehiclecode <> ''
                AND LEFT(rv.vehiclecode, LEN(mm.VehicleCodePrefix)) = mm.VehicleCodePrefix
            ) mmPrefix
            OUTER APPLY (
              SELECT TOP 1 mm.ModelCode
              FROM [dbo].[MES_Vehicle_OfflineBOM_ModelMap] mm WITH (NOLOCK)
              WHERE mmPrefix.ModelCode IS NULL
                AND rv.carVarietyCode <> ''
                AND mm.CarVarietyCode = rv.carVarietyCode
            ) mmVariety
            WHERE COALESCE(mmPrefix.ModelCode, mmVariety.ModelCode) IS NOT NULL
              AND rv.vehiclecode <> ''
          )
          INSERT INTO [dbo].[MES_Vehicle_OfflineBOM] (
            [bomversion], [plantNo], [plantName], [plantNameC],
            [materialNo], [partno], [product], [modelyear],
            [ecuname], [moduleid], [vin], [isDeleted]
          )
          SELECT
            mv.bomversion,
            'ID001',
            'PT. SGMW Motor Indonesia',
            'Cikarang Factory',
            mv.materialNo,
            mst.partno,
            mv.product,
            mv.modelyear,
            mst.ecuname,
            mst.moduleid,
            mv.vin,
            mst.isDeleted
          FROM MatchedVehicles mv
          INNER JOIN [dbo].[MES_Vehicle_OfflineBOM_Master] mst WITH (NOLOCK)
            ON mv.ModelCode = mst.ModelCode
          WHERE NOT EXISTS (
            SELECT 1
            FROM [dbo].[MES_Vehicle_OfflineBOM] existing WITH (NOLOCK)
            WHERE existing.[vin] = mv.vin
              AND existing.[ecuname] = mst.ecuname
              AND ISNULL(existing.[moduleid], '') = ISNULL(mst.moduleid, '')
              AND existing.[partno] = mst.partno
          );
          SELECT @@ROWCOUNT AS insertedCount;
        `;

        const result = await pool.request().query(query);
        const insertedCount = result.recordset[0]?.insertedCount || 0;
        this.lastMaterializedAt = Date.now();
        if (insertedCount > 0) {
          logger.info(`[VehicleOfflineBOM] Materialized ${insertedCount} BOM row(s) from Vehicle Basic Info + Master.`);
        }
        return insertedCount;
      } finally {
        this.materializePromise = null;
      }
    })();

    return this.materializePromise;
  }

  /**
   * Helper SQL query builder agar resolusi data Vehicle Basic Info konsisten antara batch & single fetch
   */
  private buildVehicleBomSelectSql(options: { top?: string; whereClause: string; orderBy?: string }): string {
    const topPart = options.top ? `TOP ${options.top}` : '';
    const orderPart = options.orderBy ? `ORDER BY ${options.orderBy}` : '';
    return `
      SELECT ${topPart}
        b.Auto_ID AS recordId,
        COALESCE(
          NULLIF(LTRIM(RTRIM(m.m_bomversion)), ''),
          NULLIF(LTRIM(RTRIM(vc.vc_bomversion)), ''),
          NULLIF(LTRIM(RTRIM(b.bomversion)), ''),
          ''
        ) AS bomversion,
        'ID001' AS plantNo,
        ISNULL(NULLIF(LTRIM(RTRIM(b.plantName)), ''), 'PT. SGMW Motor Indonesia') AS plantName,
        ISNULL(NULLIF(LTRIM(RTRIM(b.plantNameC)), ''), 'Cikarang Factory') AS plantNameC,
        COALESCE(
          NULLIF(LTRIM(RTRIM(m.m_vehiclecode)), ''),
          NULLIF(LTRIM(RTRIM(vc.vc_vehiclecode)), ''),
          NULLIF(LTRIM(RTRIM(b.materialNo)), ''),
          ''
        ) AS materialNo,
        b.partno AS partno,
        COALESCE(
          NULLIF(LTRIM(RTRIM(m.m_noproduct)), ''),
          NULLIF(LTRIM(RTRIM(vc.vc_noproduct)), ''),
          NULLIF(LTRIM(RTRIM(b.product)), ''),
          ''
        ) AS product,
        COALESCE(
          NULLIF(LTRIM(RTRIM(m.m_modelyear)), ''),
          NULLIF(LTRIM(RTRIM(vc.vc_modelyear)), ''),
          NULLIF(LTRIM(RTRIM(b.modelyear)), ''),
          ''
        ) AS modelyear,
        b.ecuname AS ecuname,
        b.moduleid AS moduleid,
        b.vin AS vin,
        ISNULL(NULLIF(LTRIM(RTRIM(b.isDeleted)), ''), '0') AS isDeleted
      FROM [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1
          m1.bomversion AS m_bomversion,
          m1.vehiclecode AS m_vehiclecode,
          m1.noproduct AS m_noproduct,
          m1.modelyear AS m_modelyear,
          m1.vsn_10 AS m_vsn10
        FROM [dbo].[mg_car_as_data] m1 WITH (NOLOCK)
        WHERE b.vin IS NOT NULL AND m1.vin = b.vin
      ) m
      OUTER APPLY (
        SELECT TOP 1 c1.vsn AS c_vsn
        FROM [dbo].[MES_Trace_Cars] c1 WITH (NOLOCK)
        WHERE b.vin IS NOT NULL AND c1.vin = b.vin
      ) c
      OUTER APPLY (
        SELECT TOP 1
          vc1.bomversion AS vc_bomversion,
          vc1.vehiclecode AS vc_vehiclecode,
          vc1.noproduct AS vc_noproduct,
          vc1.modelyear AS vc_modelyear
        FROM [BaseData].[dbo].[VehicleCode] vc1 WITH (NOLOCK)
        WHERE (
          b.vin IS NOT NULL
          AND vc1.vsn = LEFT(COALESCE(NULLIF(LTRIM(RTRIM(m.m_vsn10)), ''), NULLIF(LTRIM(RTRIM(c.c_vsn)), ''), ''), 10)
        ) OR (
          b.vin IS NULL
          AND vc1.vehiclecode = b.materialNo
        )
      ) vc
      LEFT JOIN [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
        ON b.Auto_ID = l.BOMRecordID
      WHERE ${options.whereClause}
      ${orderPart};
    `;
  }

  private mapRowToRecord(row: any): VehicleOfflineBomRecord {
    return {
      recordId: row.recordId,
      bomversion: (row.bomversion || '').trim(),
      plantNo: 'ID001',
      plantName: (row.plantName || 'PT. SGMW Motor Indonesia').trim(),
      plantNameC: (row.plantNameC || 'Cikarang Factory').trim(),
      materialNo: (row.materialNo || '').trim(),
      partno: (row.partno || '').trim(),
      product: (row.product || '').trim(),
      modelyear: (row.modelyear || '').trim(),
      ecuname: (row.ecuname || '').trim(),
      moduleid: row.moduleid != null ? String(row.moduleid).trim() : null,
      vin: row.vin ? String(row.vin).trim() : null,
      isDeleted: (row.isDeleted || '0').trim(),
    };
  }

  /**
   * Mengambil daftar VIN yang masih memiliki baris BOM belum terkirim / belum melebihi batas retry
   */
  public async fetchUnsentVins(vinLimit: number = config.processing.batchSize): Promise<string[]> {
    const safeVinLimit = Math.min(Math.max(1, vinLimit || config.processing.batchSize), 50);
    const pool = await getDbPool();
    const request = pool.request();
    request.input('limit', sql.Int, safeVinLimit);
    request.input('maxRetry', sql.Int, config.processing.maxRetryCount);

    const result = await request.query(`
      SELECT TOP (@limit) b.[vin]
      FROM [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
      LEFT JOIN [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
        ON b.[Auto_ID] = l.[BOMRecordID]
      WHERE b.[vin] IS NOT NULL
        AND LTRIM(RTRIM(b.[vin])) <> ''
        AND (l.[Status] IS NULL OR (l.[Status] = 'FAILED' AND l.[RetryCount] < @maxRetry))
      GROUP BY b.[vin]
      ORDER BY MIN(b.[Auto_ID]) ASC;
    `);

    return result.recordset.map((row: any) => String(row.vin).trim());
  }

  /**
   * Mengambil SELURUH baris BOM untuk 1 VIN tertentu (pendingOnly=true untuk batch, false untuk re-send manual)
   */
  public async fetchRecordsForVin(vin: string, pendingOnly: boolean = true): Promise<VehicleOfflineBomRecord[]> {
    await this.ensureMasterSchemaAndSeed();
    const pool = await getDbPool();
    const whereClause = pendingOnly
      ? `b.[vin] = @vin AND (l.[Status] IS NULL OR (l.[Status] = 'FAILED' AND l.[RetryCount] < @maxRetry))`
      : `b.[vin] = @vin`;

    const query = this.buildVehicleBomSelectSql({
      whereClause,
      orderBy: 'b.Auto_ID ASC',
    });

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin.trim());
    if (pendingOnly) {
      request.input('maxRetry', sql.Int, config.processing.maxRetryCount);
    }

    const result = await request.query(query);
    return result.recordset.map((row) => this.mapRowToRecord(row));
  }

  /**
   * Mengambil baris BOM legacy (vin IS NULL) yang belum terkirim
   */
  private async fetchUnsentLegacyRecords(): Promise<VehicleOfflineBomRecord[]> {
    const pool = await getDbPool();
    const query = this.buildVehicleBomSelectSql({
      whereClause: `b.[vin] IS NULL AND (l.[Status] IS NULL OR (l.[Status] = 'FAILED' AND l.[RetryCount] < @maxRetry))`,
      orderBy: 'b.Auto_ID ASC',
    });

    const request = pool.request();
    request.input('maxRetry', sql.Int, config.processing.maxRetryCount);
    const result = await request.query(query);
    return result.recordset.map((row) => this.mapRowToRecord(row));
  }

  /**
   * Mengambil seluruh baris BOM untuk maksimal @vinLimit unit mobil (tidak memotong 1 mobil di 50 baris)
   */
  public async fetchUnsentRecords(vinLimit: number = config.processing.batchSize): Promise<VehicleOfflineBomRecord[]> {
    await this.materializePendingVehicleBoms(true);
    const vins = await this.fetchUnsentVins(vinLimit);
    const allRecords: VehicleOfflineBomRecord[] = [];

    for (const vin of vins) {
      const vinRecords = await this.fetchRecordsForVin(vin, true);
      allRecords.push(...vinRecords);
    }

    const legacyRecords = await this.fetchUnsentLegacyRecords();
    allRecords.push(...legacyRecords);
    return allRecords;
  }

  /**
   * Mengambil record berdasarkan Auto_ID
   */
  public async fetchRecordById(id: number | string): Promise<VehicleOfflineBomRecord | null> {
    await this.ensureMasterSchemaAndSeed();
    const pool = await getDbPool();
    const query = this.buildVehicleBomSelectSql({
      top: '1',
      whereClause: 'b.Auto_ID = @id',
    });

    const request = pool.request();
    request.input('id', sql.BigInt, Number(id));

    const result = await request.query(query);
    if (result.recordset.length === 0) return null;

    return this.mapRowToRecord(result.recordset[0]);
  }

  /**
   * Ringkasan master template dan mapping model yang terdaftar
   */
  public async getMasterSummary(): Promise<any[]> {
    await this.ensureMasterSchemaAndSeed();
    const pool = await getDbPool();
    const [mapRes, countRes] = await Promise.all([
      pool.request().query(`
        SELECT [ModelCode], [ModelName], [CarVarietyCode], [VehicleCodePrefix]
        FROM [dbo].[MES_Vehicle_OfflineBOM_ModelMap] WITH (NOLOCK)
        ORDER BY [ModelCode], [VehicleCodePrefix];
      `),
      pool.request().query(`
        SELECT [ModelCode], COUNT(*) AS MasterItemCount
        FROM [dbo].[MES_Vehicle_OfflineBOM_Master] WITH (NOLOCK)
        GROUP BY [ModelCode];
      `),
    ]);

    const countMap = new Map<string, number>();
    for (const row of countRes.recordset) {
      countMap.set(String(row.ModelCode).trim(), Number(row.MasterItemCount || 0));
    }

    const grouped = new Map<string, {
      ModelCode: string;
      ModelName: string;
      CarVarietyCodes: string[];
      VehicleCodePrefixes: string[];
      MasterItemCount: number;
    }>();

    for (const row of mapRes.recordset) {
      const code = String(row.ModelCode).trim();
      let entry = grouped.get(code);
      if (!entry) {
        entry = {
          ModelCode: code,
          ModelName: String(row.ModelName).trim(),
          CarVarietyCodes: [],
          VehicleCodePrefixes: [],
          MasterItemCount: countMap.get(code) || 0,
        };
        grouped.set(code, entry);
      }
      if (row.CarVarietyCode) entry.CarVarietyCodes.push(String(row.CarVarietyCode).trim());
      if (row.VehicleCodePrefix) entry.VehicleCodePrefixes.push(String(row.VehicleCodePrefix).trim());
    }

    return Array.from(grouped.values()).map((entry) => ({
      ModelCode: entry.ModelCode,
      ModelName: entry.ModelName,
      CarVarietyCodes: entry.CarVarietyCodes.join(','),
      VehicleCodePrefixes: entry.VehicleCodePrefixes.join(','),
      MasterItemCount: entry.MasterItemCount,
    }));
  }

  /**
   * Build payload JSON string
   */
  public buildPayloadJson(records: VehicleOfflineBomRecord[]): string {
    return JSON.stringify(
      {
        records: records.map((r) => ({
          bomversion: r.bomversion,
          plantNo: r.plantNo,
          plantName: r.plantName,
          plantNameC: r.plantNameC,
          materialNo: r.materialNo,
          partno: r.partno,
          product: r.product,
          modelyear: r.modelyear,
          ecuname: r.ecuname,
          moduleid: r.moduleid,
          vin: r.vin ?? null,
          isDeleted: r.isDeleted,
        })),
      },
      null,
      2
    );
  }

  /**
   * Mengirim payload ke MuleSoft EAI
   */
  public async pushToEai(records: VehicleOfflineBomRecord[]): Promise<EaiResponse> {
    const payload: VehicleOfflineBomPayload = {
      records: records.map((r) => ({
        bomversion: r.bomversion,
        plantNo: r.plantNo,
        plantName: r.plantName,
        plantNameC: r.plantNameC,
        materialNo: r.materialNo,
        partno: r.partno,
        product: r.product,
        modelyear: r.modelyear,
        ecuname: r.ecuname,
        moduleid: r.moduleid,
        vin: r.vin ?? null,
        isDeleted: r.isDeleted,
      })),
    };

    const targetUrl = config.eai.vehicleOfflineBomUrl;
    logger.info(`Sending ${payload.records.length} Offline BOM record(s) to MuleSoft [${config.eai.environment}]: ${targetUrl}`);

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 30000,
      });

      return parseEaiResponse(response.data);
    } catch (err: any) {
      return {
        status: 'E',
        message: extractEaiErrorMessage(err),
      };
    }
  }

  /**
   * Batch upsert log transmisi ke [dbo].[MES_EAI_VehicleOfflineBOM_Log] dalam 1 transaksi (chunk 50 baris)
   */
  public async updateLogsBatch(
    records: VehicleOfflineBomRecord[],
    status: 'SUCCESS' | 'FAILED',
    responseStatus?: string,
    responseMessage?: string
  ): Promise<void> {
    if (records.length === 0) return;

    const pool = await getDbPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const chunkSize = 50;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const req = new sql.Request(transaction);
        req.input('status', sql.VarChar(20), status);
        req.input('responseStatus', sql.VarChar(10), responseStatus || null);
        req.input('responseMessage', sql.NVarChar(500), responseMessage || null);

        const valueRows: string[] = [];
        chunk.forEach((rec, idx) => {
          req.input(`recordId${idx}`, sql.BigInt, Number(rec.recordId || 0));
          req.input(`materialNo${idx}`, sql.VarChar(50), rec.materialNo || null);
          req.input(`partno${idx}`, sql.VarChar(50), rec.partno || null);
          req.input(`bomversion${idx}`, sql.VarChar(50), rec.bomversion || null);
          req.input(`ecuname${idx}`, sql.VarChar(50), rec.ecuname || null);
          req.input(`vin${idx}`, sql.VarChar(50), rec.vin || null);
          req.input(`payload${idx}`, sql.NVarChar(sql.MAX), this.buildPayloadJson([rec]));
          valueRows.push(
            `(@recordId${idx}, @materialNo${idx}, @partno${idx}, @bomversion${idx}, @ecuname${idx}, @vin${idx}, @payload${idx})`
          );
        });

        await req.query(`
          UPDATE l
          SET
            l.[MaterialNo] = v.materialNo,
            l.[PartNo] = v.partno,
            l.[BOMVersion] = v.bomversion,
            l.[ECUName] = v.ecuname,
            l.[VIN] = v.vin,
            l.[Status] = @status,
            l.[ResponseStatus] = @responseStatus,
            l.[ResponseMessage] = @responseMessage,
            l.[RequestPayload] = ISNULL(v.requestPayload, l.[RequestPayload]),
            l.[RetryCount] = CASE WHEN @status = 'FAILED' THEN l.[RetryCount] + 1 ELSE l.[RetryCount] END,
            l.[LastAttemptAt] = GETDATE(),
            l.[SentAt] = CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE l.[SentAt] END
          FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] l
          INNER JOIN (VALUES ${valueRows.join(', ')}) AS v(recordId, materialNo, partno, bomversion, ecuname, vin, requestPayload)
            ON l.[BOMRecordID] = v.recordId;

          INSERT INTO [dbo].[MES_EAI_VehicleOfflineBOM_Log] (
            [BOMRecordID], [MaterialNo], [PartNo], [BOMVersion], [ECUName], [VIN],
            [Status], [ResponseStatus], [ResponseMessage], [RequestPayload], [RetryCount], [SentAt], [LastAttemptAt]
          )
          SELECT
            v.recordId, v.materialNo, v.partno, v.bomversion, v.ecuname, v.vin,
            @status, @responseStatus, @responseMessage, v.requestPayload,
            CASE WHEN @status = 'FAILED' THEN 1 ELSE 0 END,
            CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE NULL END,
            GETDATE()
          FROM (VALUES ${valueRows.join(', ')}) AS v(recordId, materialNo, partno, bomversion, ecuname, vin, requestPayload)
          WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] existing
            WHERE existing.[BOMRecordID] = v.recordId
          );
        `);
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  private async sendAndLogBatch(
    records: VehicleOfflineBomRecord[],
    contextLabel: string
  ): Promise<{
    success: boolean;
    responseStatus: string;
    message: string;
    eaiResponse?: EaiResponse;
  }> {
    try {
      const eaiResp = await this.pushToEai(records);
      const isSuccess = Boolean(eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's'));
      const responseStatus = eaiResp?.status || (isSuccess ? 'S' : 'E');
      const errMsg =
        eaiResp?.message ||
        (eaiResp ? `EAI error: status=${eaiResp.status}, message=${eaiResp.message}` : 'Empty response from EAI');
      const message = isSuccess ? eaiResp.message : errMsg;

      await this.updateLogsBatch(
        records,
        isSuccess ? 'SUCCESS' : 'FAILED',
        responseStatus,
        message
      );

      if (isSuccess) {
        logger.info(
          `VehicleOfflineBOM [${contextLabel}] (${records.length} row(s)) sent successfully: ${message}`
        );
      } else {
        logger.warn(`VehicleOfflineBOM [${contextLabel}] (${records.length} row(s)) rejected by EAI: ${message}`);
      }

      return { success: isSuccess, responseStatus, message, eaiResponse: eaiResp };
    } catch (err: any) {
      const errMsg = extractEaiErrorMessage(err);
      await this.updateLogsBatch(records, 'FAILED', 'E', errMsg);
      logger.error(`Failed to push VehicleOfflineBOM [${contextLabel}] to EAI:`, errMsg);
      return { success: false, responseStatus: 'E', message: errMsg };
    }
  }

  /**
   * Jalankan sinkronisasi batch per unit mobil (mengirim SELURUH baris BOM milik tiap VIN dalam 1 request per VIN)
   */
  public async syncBatch(vinLimit: number = config.processing.batchSize): Promise<VehicleOfflineBomSyncResult> {
    await this.materializePendingVehicleBoms(true);
    const safeVinLimit = Math.min(Math.max(1, vinLimit || config.processing.batchSize), 50);
    logger.info(`Starting VehicleOfflineBOM sync batch (limit: ${safeVinLimit} VIN(s), full BOM per VIN)...`);

    const vins = await this.fetchUnsentVins(safeVinLimit);
    const legacyRecords = await this.fetchUnsentLegacyRecords();

    const result: VehicleOfflineBomSyncResult = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      details: [],
    };

    if (vins.length === 0 && legacyRecords.length === 0) {
      logger.info('No new or pending records found for VehicleOfflineBOM.');
      return result;
    }

    logger.info(
      `Found ${vins.length} pending VIN(s) and ${legacyRecords.length} legacy row(s) for VehicleOfflineBOM.`
    );

    const groups: Array<{ label: string; records: VehicleOfflineBomRecord[] }> = [];
    for (const vin of vins) {
      const vinRecords = await this.fetchRecordsForVin(vin, true);
      if (vinRecords.length > 0) {
        groups.push({ label: `VIN ${vin}`, records: vinRecords });
      }
    }
    if (legacyRecords.length > 0) {
      groups.push({ label: 'Legacy (VIN=null)', records: legacyRecords });
    }

    for (const group of groups) {
      result.totalProcessed += group.records.length;
      const outcome = await this.sendAndLogBatch(group.records, group.label);

      if (outcome.success) {
        result.successCount += group.records.length;
      } else {
        result.failureCount += group.records.length;
      }

      for (const rec of group.records) {
        result.details.push({
          recordId: rec.recordId || 0,
          materialNo: rec.materialNo,
          partno: rec.partno,
          status: outcome.success ? 'SUCCESS' : 'FAILED',
          responseStatus: outcome.responseStatus,
          message: outcome.message,
        });
      }
    }

    logger.info(
      `VehicleOfflineBOM sync batch finished across ${groups.length} unit(s): ${result.successCount} succeeded, ${result.failureCount} failed out of ${result.totalProcessed} BOM row(s).`
    );

    return result;
  }

  /**
   * Menjalankan sinkronisasi / re-send seluruh baris BOM milik 1 nomor VIN
   */
  public async syncByVin(vin: string): Promise<{ success: boolean; message: string; data?: any }> {
    const cleanVin = (vin || '').trim();
    logger.info(`Manual full-BOM sync requested for VIN: ${cleanVin}`);
    await this.materializePendingVehicleBoms(true);
    const records = await this.fetchRecordsForVin(cleanVin, false);

    if (records.length === 0) {
      return { success: false, message: `No Vehicle Offline BOM rows found for VIN [${cleanVin}].` };
    }

    const outcome = await this.sendAndLogBatch(records, `VIN ${cleanVin}`);
    return {
      success: outcome.success,
      message: outcome.message,
      data: {
        vin: cleanVin,
        materialNo: records[0].materialNo,
        totalRows: records.length,
        eaiResponse: outcome.eaiResponse,
      },
    };
  }

  /**
   * Menjalankan sinkronisasi khusus 1 record ID
   */
  public async syncSingleRecord(id: number | string): Promise<{ success: boolean; message: string; data?: any }> {
    logger.info(`Manual sync requested for VehicleOfflineBOM ID: ${id}`);
    const record = await this.fetchRecordById(id);

    if (!record) {
      return { success: false, message: `Record ID [${id}] not found in MES_Vehicle_OfflineBOM.` };
    }

    const outcome = await this.sendAndLogBatch([record], `ID ${id}`);
    return {
      success: outcome.success,
      message: outcome.message,
      data: outcome.eaiResponse
        ? {
            recordId: record.recordId || id,
            materialNo: record.materialNo,
            partno: record.partno,
            ecuname: record.ecuname,
            vin: record.vin,
            eaiResponse: outcome.eaiResponse,
          }
        : undefined,
    };
  }

  /**
   * Mengambil riwayat log pengiriman terakhir
   */
  public async getRecentLogs(limit: number = 50): Promise<any[]> {
    const pool = await getDbPool();
    const query = `
      SELECT TOP (@limit)
        l.[LogID],
        l.[BOMRecordID],
        l.[MaterialNo],
        l.[PartNo],
        l.[BOMVersion],
        l.[ECUName],
        b.[moduleid] AS [moduleid],
        l.[VIN],
        l.[Status],
        l.[ResponseStatus],
        l.[ResponseMessage],
        l.[RetryCount],
        l.[SentAt],
        l.[LastAttemptAt]
      FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
      LEFT JOIN [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
        ON l.[BOMRecordID] = b.[Auto_ID]
      ORDER BY l.[LastAttemptAt] DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, limit);
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Mengambil payload tersimpan atau preview generated
   */
  public async getPayloadById(id: number | string): Promise<any> {
    const pool = await getDbPool();
    const logResult = await pool
      .request()
      .input('id', sql.BigInt, Number(id))
      .query(
        `SELECT [RequestPayload], [BOMRecordID], [Status], [ResponseStatus], [ResponseMessage], [LastAttemptAt]
         FROM [dbo].[MES_EAI_VehicleOfflineBOM_Log] WITH (NOLOCK) WHERE [BOMRecordID] = @id`
      );

    let payload: any = null;
    let logInfo = null;

    if (logResult.recordset.length > 0) {
      logInfo = logResult.recordset[0];
      if (logInfo.RequestPayload) {
        try {
          payload = JSON.parse(logInfo.RequestPayload);
        } catch {
          payload = logInfo.RequestPayload;
        }
      }
    }

    if (!payload) {
      const record = await this.fetchRecordById(id);
      if (record) {
        payload = JSON.parse(this.buildPayloadJson([record]));
      }
    }

    return {
      recordId: id,
      interfaceName: 'Vehicle Offline BOM',
      log: logInfo,
      payload,
    };
  }
}

export const vehicleOfflineBomService = new VehicleOfflineBomService();
