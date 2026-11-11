import sql from 'mssql';
import axios from 'axios';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  VehicleBasicInfoRecord,
  VehicleBasicInfoPayload,
  VehicleBasicInfoConfigItem,
} from '../types/vehicleBasicInfo';
import { EaiResponse, SyncResult } from '../types/orderBroadcast';
import { parseEaiResponse, extractEaiErrorMessage } from '../utils/eaiHelper';
import { buildStrictMgWhereSql, buildReleaseDateExpr, buildReleaseDateFilterSql } from '../utils/vehicleFilter';

export class VehicleBasicInfoService {
  private lastDatePrefix: string = '';
  private currentSeq: number = 0;
  private seqInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Mendapatkan format prefix tanggal GMT+7 (Asia/Jakarta) dengan pola YYMMDD
   * Contoh: 2026-10-20 -> "261020"
   */
  public getTodayPrefix(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    return `${year}${month}${day}`;
  }

  /**
   * Menjamin sequence counter diinisialisasi dari TransmissionID tertinggi hari ini di tabel Log
   */
  public async ensureSequenceInitialized(todayPrefix: string): Promise<void> {
    if (this.seqInitialized && this.lastDatePrefix === todayPrefix) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const pool = await getDbPool();
        const query = `
          SELECT MAX([TransmissionID]) AS MaxTransmissionID
          FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WITH (NOLOCK)
          WHERE [TransmissionID] LIKE @prefix + '%';
        `;

        const request = pool.request();
        request.input('prefix', sql.VarChar(10), todayPrefix);
        const result = await request.query(query);

        const maxId: string | null = result.recordset[0]?.MaxTransmissionID;
        if (maxId && maxId.startsWith(todayPrefix) && maxId.length >= todayPrefix.length + 4) {
          const suffix = maxId.substring(todayPrefix.length, todayPrefix.length + 4);
          const parsed = parseInt(suffix, 10);
          this.currentSeq = isNaN(parsed) ? 0 : parsed + 1;
        } else {
          this.currentSeq = 0;
        }

        this.lastDatePrefix = todayPrefix;
        this.seqInitialized = true;
        logger.info(`VehicleBasicInfo sequence initialized for prefix ${todayPrefix}: next seq=${this.currentSeq}`);
      } catch (err) {
        logger.error('Failed to initialize VehicleBasicInfo sequence from DB:', err);
        if (!this.seqInitialized) {
          this.currentSeq = 0;
          this.lastDatePrefix = todayPrefix;
          this.seqInitialized = true;
        }
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Menghasilkan ID unik bertingkat: format yymmddxxxx (0000 - 9999)
   */
  public async generateNextId(): Promise<string> {
    const todayPrefix = this.getTodayPrefix();
    await this.ensureSequenceInitialized(todayPrefix);

    const seqNumber = this.currentSeq % 10000;
    this.currentSeq++;
    const seqStr = String(seqNumber).padStart(4, '0');
    return `${todayPrefix}${seqStr}`;
  }

  /**
   * Mengambil daftar feature codes untuk vehicleCode tertentu dari mg_featureconfig.
   * KETENTUAN: Jika tidak ada fitur (0 feature), tetap mengembalikan 1 baris dummy:
   * [ { featureId: "1", featureCode: "", orderNo: null, lastUpdateTime: null, orderType: null } ]
   */
  public async fetchFeaturesByVehicleCode(vehicleCode: string, id?: string): Promise<VehicleBasicInfoConfigItem[]> {
    if (!vehicleCode || vehicleCode.trim() === '') {
      return [
        {
          id: id || '',
          featureId: '1',
          featureCode: '',
          orderNo: null,
          lastUpdateTime: null,
          orderType: null,
        },
      ];
    }

    const pool = await getDbPool();
    const query = `
      SELECT DISTINCT 
        ISNULL(featureid, '')   AS featureId,
        ISNULL(featurecode, '') AS featureCode
      FROM [dbo].[mg_featureconfig] WITH (NOLOCK)
      WHERE [vehiclecode] = @vehicleCode 
        AND [featurecode] IS NOT NULL 
        AND [featurecode] <> ''
      ORDER BY featureId, featureCode;
    `;

    const request = pool.request();
    request.input('vehicleCode', sql.VarChar(50), vehicleCode);

    const result = await request.query(query);
    if (result.recordset.length === 0) {
      return [
        {
          id: id || '',
          featureId: '1',
          featureCode: '',
          orderNo: null,
          lastUpdateTime: null,
          orderType: null,
        },
      ];
    }

    return result.recordset.map((row, idx) => ({
      id: id || '',
      featureId: (row.featureId && row.featureId.trim() !== '' ? row.featureId.trim() : String(idx + 1)),
      featureCode: ((row.featureCode ?? row.featurecode ?? row.FeatureCode) || '').trim(),
      orderNo: null,
      lastUpdateTime: null,
      orderType: null,
    }));
  }

  /**
   * Mengambil data kendaraan yang belum terkirim oleh service ini.
   * Status pengiriman hanya dicek dari tabel log baru: MES_EAI_VehicleBasicInfo_Log
   */
  public async fetchUnsentRecords(limit: number = config.processing.batchSize): Promise<VehicleBasicInfoRecord[]> {
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    const pool = await getDbPool();
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm', varietyAlias: 'v' });
    const dateCols = ['m.handover_tpoint_date', 'c.handover_tpoint_date', 'm.createtime'];
    const query = `
      SELECT TOP (@limit)
        'ID001'                                                AS plantNo,
        'MG'                                                   AS normt,
        ISNULL(v.ProjectName, m.noproduct)                     AS materialNo,
        m.vin                                                  AS vin,
        ISNULL(m.pincode, '')                                  AS pn,
        ISNULL(m.bomversion, '')                               AS bomversion,
        ISNULL(m.engineno, '')                                 AS engineNo,
        ISNULL(m.modelyear, '')                                AS modelyear,
        ISNULL(m.noproduct, '')                                AS product,
        ISNULL(m.vhc_model, '')                                AS vhcModel,
        ISNULL(m.handover_tpoint_date, c.handover_tpoint_date) AS finishTime,
        '0'                                                    AS isDeleted,
        m.vehiclecode
      FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
      LEFT JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON m.vin = c.vin
      LEFT JOIN [BaseData].[dbo].[CarVarietyCode] v WITH (NOLOCK) 
          ON c.CarVarietyCode = v.CarVarietyCode
      LEFT JOIN [dbo].[MES_EAI_VehicleBasicInfo_Log] l WITH (NOLOCK) 
          ON m.vin = l.VIN
      WHERE ${mgFilter}
        AND ${buildReleaseDateFilterSql(dateCols)}
        AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
      ORDER BY ${buildReleaseDateExpr(dateCols)} DESC, m.Auto_ID DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, safeLimit);
    request.input('maxRetry', sql.Int, config.processing.maxRetryCount);
    request.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);

    const result = await request.query(query);
    const records: VehicleBasicInfoRecord[] = [];

    for (const row of result.recordset) {
      const vCode = row.vehiclecode || '';
      const id = await this.generateNextId();
      const configs = await this.fetchFeaturesByVehicleCode(vCode, id);

      let formattedFinishTime: string | null = null;
      if (row.finishTime) {
        const d = new Date(row.finishTime);
        if (!isNaN(d.getTime())) {
          formattedFinishTime = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
        }
      }

      records.push({
        id,
        plantNo: 'ID001',
        product: row.product && row.product.trim() !== '' ? row.product.trim() : null,
        modelyear: row.modelyear && row.modelyear.trim() !== '' ? row.modelyear.trim() : null,
        orderNo: null,
        orderType: null,
        orderStatus: null,
        prodFinishTime: null,
        drnno: null,
        normt: 'MG',
        materialNo: row.materialNo && row.materialNo.trim() !== '' ? row.materialNo.trim() : null,
        tps: null,
        vin: row.vin,
        engineNo: row.engineNo && row.engineNo.trim() !== '' ? row.engineNo.trim() : null,
        checkoutNo14: null,
        checkoutNo15: null,
        checkoutDate: null,
        pn: row.pn && row.pn.trim() !== '' ? row.pn.trim() : null,
        vehicleStatus: null,
        gaTime: null,
        finishTime: formattedFinishTime,
        bomversion: row.bomversion && row.bomversion.trim() !== '' ? row.bomversion.trim() : null,
        testRepNo: null,
        productCode: null,
        zvrn: null,
        productType: null,
        vsn: null,
        assembleDesc: null,
        reservedField1: 'initial',
        tvv: null,
        vhcModel: row.vhcModel && row.vhcModel.trim() !== '' ? row.vhcModel.trim() : null,
        configs,
        vehiclecode: vCode,
        isDeleted: row.isDeleted,
      });
    }

    return records;
  }

  /**
   * Mengambil data kendaraan berdasarkan nomor VIN
   */
  public async fetchRecordByVin(vin: string, customId?: string): Promise<VehicleBasicInfoRecord | null> {
    const pool = await getDbPool();
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm', varietyAlias: 'v' });
    const query = `
      SELECT TOP 1
        'ID001'                                                AS plantNo,
        'MG'                                                   AS normt,
        ISNULL(v.ProjectName, m.noproduct)                     AS materialNo,
        m.vin                                                  AS vin,
        ISNULL(m.pincode, '')                                  AS pn,
        ISNULL(m.bomversion, '')                               AS bomversion,
        ISNULL(m.engineno, '')                                 AS engineNo,
        ISNULL(m.modelyear, '')                                AS modelyear,
        ISNULL(m.noproduct, '')                                AS product,
        ISNULL(m.vhc_model, '')                                AS vhcModel,
        ISNULL(m.handover_tpoint_date, c.handover_tpoint_date) AS finishTime,
        '0'                                                    AS isDeleted,
        m.vehiclecode
      FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
      LEFT JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON m.vin = c.vin
      LEFT JOIN [BaseData].[dbo].[CarVarietyCode] v WITH (NOLOCK) 
          ON c.CarVarietyCode = v.CarVarietyCode
      WHERE m.vin = @vin
        AND ${mgFilter};
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);

    const result = await request.query(query);
    if (result.recordset.length === 0) {
      return null;
    }

    const row = result.recordset[0];
    const vCode = row.vehiclecode || '';
    const id = customId || (await this.generateNextId());
    const configs = await this.fetchFeaturesByVehicleCode(vCode, id);

    let formattedFinishTime: string | null = null;
    if (row.finishTime) {
      const d = new Date(row.finishTime);
      if (!isNaN(d.getTime())) {
        formattedFinishTime = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
      }
    }

    return {
      id,
      plantNo: 'ID001',
      product: row.product && row.product.trim() !== '' ? row.product.trim() : null,
      modelyear: row.modelyear && row.modelyear.trim() !== '' ? row.modelyear.trim() : null,
      orderNo: null,
      orderType: null,
      orderStatus: null,
      prodFinishTime: null,
      drnno: null,
      normt: 'MG',
      materialNo: row.materialNo && row.materialNo.trim() !== '' ? row.materialNo.trim() : null,
      tps: null,
      vin: row.vin,
      engineNo: row.engineNo && row.engineNo.trim() !== '' ? row.engineNo.trim() : null,
      checkoutNo14: null,
      checkoutNo15: null,
      checkoutDate: null,
      pn: row.pn && row.pn.trim() !== '' ? row.pn.trim() : null,
      vehicleStatus: null,
      gaTime: null,
      finishTime: formattedFinishTime,
      bomversion: row.bomversion && row.bomversion.trim() !== '' ? row.bomversion.trim() : null,
      testRepNo: null,
      productCode: null,
      zvrn: null,
      productType: null,
      vsn: null,
      assembleDesc: null,
      reservedField1: 'initial',
      tvv: null,
      vhcModel: row.vhcModel && row.vhcModel.trim() !== '' ? row.vhcModel.trim() : null,
      configs,
      vehiclecode: vCode,
      isDeleted: row.isDeleted,
    };
  }

  /**
   * Helper serialisasi payload JSON sesuai kontrak schema EAI VehicleBasicInfo_Pub
   */
  public buildPayloadJson(record: VehicleBasicInfoRecord): string {
    const recordId = record.id || '0000000001';
    return JSON.stringify(
      {
        records: [
          {
            id: recordId,
            plantNo: record.plantNo,
            product: record.product,
            modelyear: record.modelyear,
            orderNo: record.orderNo ?? null,
            orderType: record.orderType ?? null,
            orderStatus: record.orderStatus ?? null,
            prodFinishTime: record.prodFinishTime ?? null,
            drnno: record.drnno ?? null,
            normt: record.normt,
            materialNo: record.materialNo,
            tps: record.tps ?? null,
            vin: record.vin,
            engineNo: record.engineNo ?? null,
            checkoutNo14: record.checkoutNo14 ?? null,
            checkoutNo15: record.checkoutNo15 ?? null,
            checkoutDate: record.checkoutDate ?? null,
            pn: record.pn,
            vehicleStatus: record.vehicleStatus ?? null,
            gaTime: record.gaTime ?? null,
            finishTime: record.finishTime ?? null,
            bomversion: record.bomversion,
            testRepNo: record.testRepNo ?? null,
            productCode: record.productCode ?? null,
            zvrn: record.zvrn ?? null,
            productType: record.productType ?? null,
            vsn: record.vsn ?? null,
            assembleDesc: record.assembleDesc ?? null,
            reservedField1: record.reservedField1 ?? 'initial',
            tvv: record.tvv ?? null,
            vhcModel: record.vhcModel ?? null,
            configs: record.configs.map((c) => ({
              id: recordId,
              featureId: c.featureId,
              featureCode: c.featureCode,
              orderNo: c.orderNo ?? null,
              lastUpdateTime: c.lastUpdateTime ?? null,
              orderType: c.orderType ?? null,
            })),
          },
        ],
      },
      null,
      2
    );
  }

  /**
   * Mengirim payload ke MuleSoft EAI
   */
  public async pushToEai(records: VehicleBasicInfoRecord[]): Promise<EaiResponse> {
    const payload: VehicleBasicInfoPayload = {
      records: records.map((r) => {
        const recordId = r.id || '0000000001';
        return {
          id: recordId,
          plantNo: r.plantNo,
          product: r.product,
          modelyear: r.modelyear,
          orderNo: r.orderNo ?? null,
          orderType: r.orderType ?? null,
          orderStatus: r.orderStatus ?? null,
          prodFinishTime: r.prodFinishTime ?? null,
          drnno: r.drnno ?? null,
          normt: r.normt,
          materialNo: r.materialNo,
          tps: r.tps ?? null,
          vin: r.vin,
          engineNo: r.engineNo ?? null,
          checkoutNo14: r.checkoutNo14 ?? null,
          checkoutNo15: r.checkoutNo15 ?? null,
          checkoutDate: r.checkoutDate ?? null,
          pn: r.pn,
          vehicleStatus: r.vehicleStatus ?? null,
          gaTime: r.gaTime ?? null,
          finishTime: r.finishTime ?? null,
          bomversion: r.bomversion,
          testRepNo: r.testRepNo ?? null,
          productCode: r.productCode ?? null,
          zvrn: r.zvrn ?? null,
          productType: r.productType ?? null,
          vsn: r.vsn ?? null,
          assembleDesc: r.assembleDesc ?? null,
          reservedField1: r.reservedField1 ?? 'initial',
          tvv: r.tvv ?? null,
          vhcModel: r.vhcModel ?? null,
          configs: r.configs.map((c) => ({
            id: recordId,
            featureId: c.featureId,
            featureCode: c.featureCode,
            orderNo: c.orderNo ?? null,
            lastUpdateTime: c.lastUpdateTime ?? null,
            orderType: c.orderType ?? null,
          })),
        };
      }),
    };

    const targetUrl = config.eai.vehicleBasicInfoUrl;
    logger.info(`Sending ${payload.records.length} record(s) to MuleSoft [${config.eai.environment}]: ${targetUrl}`);

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 20000,
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
   * Update HANYA ke tabel log baru: MES_EAI_VehicleBasicInfo_Log
   * PENTING: mg_car_as_data TIDAK disentuh/diupdate sama sekali karena sudah ada job eksisting.
   */
  public async updateLog(
    vin: string,
    vehicleCode: string,
    featureCount: number,
    status: 'SUCCESS' | 'FAILED',
    responseStatus?: string,
    responseMessage?: string,
    payloadJson?: string,
    transmissionId?: string
  ): Promise<void> {
    const pool = await getDbPool();

    const logQuery = `
      IF EXISTS (SELECT 1 FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WHERE [VIN] = @vin)
      BEGIN
        UPDATE [dbo].[MES_EAI_VehicleBasicInfo_Log]
        SET 
          [TransmissionID] = ISNULL(@transmissionId, [TransmissionID]),
          [VehicleCode] = @vehicleCode,
          [FeatureCount] = @featureCount,
          [Status] = @status,
          [ResponseStatus] = @responseStatus,
          [ResponseMessage] = @responseMessage,
          [RequestPayload] = ISNULL(@requestPayload, [RequestPayload]),
          [RetryCount] = CASE WHEN @status = 'FAILED' THEN [RetryCount] + 1 ELSE [RetryCount] END,
          [LastAttemptAt] = GETDATE(),
          [SentAt] = CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE [SentAt] END
        WHERE [VIN] = @vin;
      END
      ELSE
      BEGIN
        INSERT INTO [dbo].[MES_EAI_VehicleBasicInfo_Log] (
          [VIN], [TransmissionID], [VehicleCode], [FeatureCount], [Status], 
          [ResponseStatus], [ResponseMessage], [RequestPayload], [RetryCount], [SentAt], [LastAttemptAt]
        )
        VALUES (
          @vin, @transmissionId, @vehicleCode, @featureCount, @status, 
          @responseStatus, @responseMessage, @requestPayload,
          CASE WHEN @status = 'FAILED' THEN 1 ELSE 0 END, 
          CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE NULL END, 
          GETDATE()
        );
      END
    `;

    const requestLog = pool.request();
    requestLog.input('vin', sql.VarChar(50), vin);
    requestLog.input('transmissionId', sql.VarChar(20), transmissionId || null);
    requestLog.input('vehicleCode', sql.VarChar(50), vehicleCode || '');
    requestLog.input('featureCount', sql.Int, featureCount);
    requestLog.input('status', sql.VarChar(20), status);
    requestLog.input('responseStatus', sql.VarChar(10), responseStatus || null);
    requestLog.input('responseMessage', sql.NVarChar(500), responseMessage || null);
    requestLog.input('requestPayload', sql.NVarChar(sql.MAX), payloadJson || null);
    await requestLog.query(logQuery);
  }

  /**
   * Menjalankan sinkronisasi batch
   */
  public async syncBatch(limit: number = config.processing.batchSize): Promise<SyncResult> {
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    logger.info(`Starting VehicleBasicInfo sync batch (limit: ${safeLimit})...`);
    const records = await this.fetchUnsentRecords(safeLimit);

    const result: SyncResult = {
      totalProcessed: records.length,
      successCount: 0,
      failureCount: 0,
      details: [],
    };

    if (records.length === 0) {
      logger.info('No new or pending records found for VehicleBasicInfo.');
      return result;
    }

    logger.info(`Found ${records.length} pending record(s) for VehicleBasicInfo.`);

    for (const record of records) {
      const vin = record.vin;
      const vCode = record.vehiclecode || '';
      const featureCount = record.configs.filter((c: any) => {
        const code = (c.featureCode || '').trim();
        return code !== '';
      }).length;
      const transmissionId = record.id;
      const payloadJson = this.buildPayloadJson(record);

      try {
        const eaiResp = await this.pushToEai([record]);

        if (eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's')) {
          await this.updateLog(vin, vCode, featureCount, 'SUCCESS', eaiResp.status, eaiResp.message, payloadJson, transmissionId);
          result.successCount++;
          result.details.push({
            vin,
            status: 'SUCCESS',
            responseStatus: eaiResp.status,
            message: eaiResp.message,
          });
          logger.info(`VehicleBasicInfo VIN ${vin} (ID: ${transmissionId}) sent successfully (${featureCount} features): ${eaiResp.message}`);
        } else {
          const errMsg = eaiResp?.message || (eaiResp ? `EAI error: status=${eaiResp.status}, message=${eaiResp.message}` : 'Empty response from EAI');
          await this.updateLog(vin, vCode, featureCount, 'FAILED', eaiResp?.status || 'E', errMsg, payloadJson, transmissionId);
          result.failureCount++;
          result.details.push({
            vin,
            status: 'FAILED',
            responseStatus: eaiResp?.status || 'E',
            message: errMsg,
          });
          logger.warn(`VehicleBasicInfo VIN ${vin} (ID: ${transmissionId}) rejected by EAI: ${errMsg}`);
        }
      } catch (err: any) {
        const errMsg = extractEaiErrorMessage(err);
        await this.updateLog(vin, vCode, featureCount, 'FAILED', 'E', errMsg, payloadJson, transmissionId);
        result.failureCount++;
        result.details.push({
          vin,
          status: 'FAILED',
          responseStatus: 'E',
          message: errMsg,
        });
        logger.error(`Failed to push VehicleBasicInfo VIN ${vin} (ID: ${transmissionId}) to EAI:`, errMsg);
      }
    }

    logger.info(
      `VehicleBasicInfo sync batch finished: ${result.successCount} succeeded, ${result.failureCount} failed out of ${result.totalProcessed}.`
    );

    return result;
  }

  /**
   * Menjalankan sinkronisasi khusus 1 nomor VIN
   */
  public async syncSingleVin(vin: string): Promise<{ success: boolean; message: string; data?: any }> {
    logger.info(`Manual sync requested for VehicleBasicInfo VIN: ${vin}`);
    const id = await this.generateNextId();
    const record = await this.fetchRecordByVin(vin, id);

    if (!record) {
      return { success: false, message: `VIN [${vin}] not found in mg_car_as_data.` };
    }

    const featureCount = record.configs.filter((c: any) => {
      const code = (c.featureCode || '').trim();
      return code !== '';
    }).length;
    const payloadJson = this.buildPayloadJson(record);

    try {
      const eaiResp = await this.pushToEai([record]);
      const isSuccess = eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's');
      const responseStatus = eaiResp?.status || (isSuccess ? 'S' : 'E');
      const responseMessage = eaiResp?.message || (isSuccess ? 'Success' : 'EAI rejected');

      await this.updateLog(
        vin,
        record.vehiclecode || '',
        featureCount,
        isSuccess ? 'SUCCESS' : 'FAILED',
        responseStatus,
        responseMessage,
        payloadJson,
        id
      );

      return {
        success: isSuccess,
        message: responseMessage,
        data: {
          id,
          vin,
          vehiclecode: record.vehiclecode,
          materialNo: record.materialNo,
          featuresCount: featureCount,
          configsCountSent: record.configs.length,
          eaiResponse: eaiResp,
        },
      };
    } catch (err: any) {
      const errMsg = extractEaiErrorMessage(err);
      await this.updateLog(vin, record.vehiclecode || '', featureCount, 'FAILED', 'E', errMsg, payloadJson, id);
      return { success: false, message: errMsg };
    }
  }

  /**
   * Mengambil riwayat log pengiriman terakhir
   */
  public async getRecentLogs(limit: number = 50): Promise<any[]> {
    const pool = await getDbPool();
    const query = `
      SELECT TOP (@limit)
        [VIN],
        [TransmissionID],
        [VehicleCode],
        [FeatureCount],
        [Status],
        [ResponseStatus],
        [ResponseMessage],
        [RetryCount],
        [SentAt],
        [LastAttemptAt]
      FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WITH (NOLOCK)
      ORDER BY [LastAttemptAt] DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, limit);
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Mengambil payload JSON tersimpan atau preview generated untuk VIN tertentu
   */
  public async getPayloadByVin(vin: string): Promise<any> {
    const pool = await getDbPool();
    const logResult = await pool.request()
      .input('vin', sql.VarChar(50), vin)
      .query(`SELECT [RequestPayload], [TransmissionID], [Status], [ResponseStatus], [ResponseMessage], [LastAttemptAt] 
              FROM [dbo].[MES_EAI_VehicleBasicInfo_Log] WITH (NOLOCK) WHERE [VIN] = @vin`);

    let payload: any = null;
    let logInfo = null;

    if (logResult.recordset.length > 0) {
      logInfo = logResult.recordset[0];
      if (logInfo.RequestPayload) {
        try {
          payload = JSON.parse(logInfo.RequestPayload);
        } catch (e) {
          payload = logInfo.RequestPayload;
        }
      }
    }

    if (!payload) {
      const previewId = logInfo?.TransmissionID || `${this.getTodayPrefix()}0000`;
      const record = await this.fetchRecordByVin(vin, previewId);
      if (record) {
        payload = JSON.parse(this.buildPayloadJson(record));
      }
    }

    return {
      vin,
      interfaceName: 'Vehicle Basic Info',
      log: logInfo,
      payload,
    };
  }
}

export const vehicleBasicInfoService = new VehicleBasicInfoService();
