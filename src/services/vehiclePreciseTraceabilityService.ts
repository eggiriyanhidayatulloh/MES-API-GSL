import sql from 'mssql';
import axios from 'axios';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { buildStrictMgWhereSql, buildReleaseDateExpr, buildReleaseDateFilterSql } from '../utils/vehicleFilter';
import {
  VehiclePreciseTraceabilityRecord,
  VehiclePreciseTraceabilityPayload,
} from '../types/vehiclePreciseTraceability';
import { EaiResponse, SyncResult } from '../types/orderBroadcast';

interface TItemMapping {
  PartIdentifyCode: string;
  PartIdentifyName: string;
  TItem_Field: string;
  ItemSeq: number;
}

export class VehiclePreciseTraceabilityService {
  private mappingCache: Map<string, TItemMapping> | null = null;

  /**
   * Mengambil mapping TItem_Field ke PartIdentifyCode & PartIdentifyName dari v_RecallItem_TItemMap
   */
  private async getTItemMappings(): Promise<Map<string, TItemMapping>> {
    if (this.mappingCache && this.mappingCache.size > 0) {
      return this.mappingCache;
    }

    const pool = await getDbPool();
    const query = `
      SELECT PartIdentifyCode, PartIdentifyName, TItem_Field, ItemSeq
      FROM [dbo].[v_RecallItem_TItemMap] WITH (NOLOCK);
    `;
    const result = await pool.request().query(query);
    const map = new Map<string, TItemMapping>();

    for (const row of result.recordset) {
      if (row.TItem_Field) {
        map.set(row.TItem_Field.trim(), {
          PartIdentifyCode: (row.PartIdentifyCode || '').trim(),
          PartIdentifyName: (row.PartIdentifyName || '').trim(),
          TItem_Field: (row.TItem_Field || '').trim(),
          ItemSeq: row.ItemSeq,
        });
      }
    }

    this.mappingCache = map;
    return map;
  }

  /**
   * Helper untuk membersihkan dan memformat datetime ke format ISO-8601 UTC (YYYY-MM-DDTHH:mm:ssZ)
   * Contoh: 2026-10-20T02:45:49Z
   */
  private formatScanTime(raw: any): string {
    if (!raw) return '';
    if (raw instanceof Date) {
      return raw.toISOString().substring(0, 19) + 'Z';
    }
    const str = String(raw).trim();
    if (!str) return '';

    // Jika format memiliki titik jam (misal 2024-01-05 09.28.09)
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}\.\d{2}\.\d{2}/.test(str)) {
      const parts = str.split(/\s+/);
      const datePart = parts[0];
      const timePart = parts[1].replace(/\./g, ':').substring(0, 8);
      return `${datePart}T${timePart}Z`;
    }

    // Jika format YYYY-MM-DD HH:mm:ss... (dengan spasi)
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(str)) {
      const parts = str.split(/\s+/);
      const datePart = parts[0];
      const timePart = parts[1].substring(0, 8);
      return `${datePart}T${timePart}Z`;
    }

    // Jika sudah memiliki 'T' (misal 2024-01-05T09:28:09...)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
      return str.substring(0, 19) + 'Z';
    }

    // Coba parse dengan Date jika string valid
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().substring(0, 19) + 'Z';
    }

    // Fallback jika panjang >= 19
    if (str.length >= 19) {
      return str.substring(0, 10) + 'T' + str.substring(11, 19).replace(/\./g, ':') + 'Z';
    }

    return str;
  }

  /**
   * Ekstraksi partNo dan supplierNo dari barcode jika polanya cocok
   */
  private parseBarcode(barcode: string, keypartType: string): { partNo: string; supplierNo: string } {
    if (!barcode) return { partNo: '', supplierNo: '' };
    const clean = barcode.trim();

    // 1. Pola 15-karakter EV Components (misal 949792AP5021221: Type 94, Part 9792, Supplier AP5, SN 021221)
    if (clean.length === 15 && /^[A-Z0-9]{15}$/.test(clean)) {
      return {
        partNo: clean.substring(2, 6),
        supplierNo: clean.substring(6, 9),
      };
    }

    // 2. Pola 27~29 karakter SGMW standard (misal 2180300082354684201J7020032: Type 21, Supplier 8030, Part 23546842)
    if (clean.length >= 26) {
      const partMatch = clean.match(/(?:11|23|24|25|54|83)\d{6}/);
      const partNo = partMatch ? partMatch[0] : (keypartType || clean.substring(0, 8));
      const supplierNo = clean.substring(2, 6);
      return { partNo, supplierNo };
    }

    // 3. Pola mesin/motor atau dummy
    if (clean.includes('DUMMY')) {
      return { partNo: 'DUMMY', supplierNo: '' };
    }

    return { partNo: keypartType || clean.substring(0, 8), supplierNo: '' };
  }

  /**
   * Mengambil daftar nomor VIN yang sudah Handover dan belum sukses dikirim
   */
  public async fetchUnsentVins(limit: number = config.processing.batchSize): Promise<string[]> {
    const pool = await getDbPool();
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' });
    const dateCols = ['c.handover_tpoint_date'];

    const query = `
      SELECT TOP (@limit)
        r.vin
      FROM [dbo].[MES_MQ_RecallItems] r WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON r.vin = c.vin
      LEFT JOIN [dbo].[mg_car_as_data] m WITH (NOLOCK) 
          ON r.vin = m.vin
      LEFT JOIN [dbo].[MES_EAI_VehiclePreciseTraceability_Log] l WITH (NOLOCK) 
          ON r.vin = l.VIN
      WHERE ${mgFilter}
        AND c.handover_tpoint_date IS NOT NULL 
        AND c.handover_tpoint_date <> ''
        AND ${buildReleaseDateFilterSql(dateCols)}
        AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
      ORDER BY ${buildReleaseDateExpr(dateCols)} DESC, c.Auto_ID DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, safeLimit);
    request.input('maxRetry', sql.Int, config.processing.maxRetryCount);
    request.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);

    const result = await request.query(query);
    return result.recordset.map((row: any) => String(row.vin).trim());
  }

  /**
   * Mengambil dan mentransformasikan seluruh komponen barcode untuk 1 VIN tertentu
   */
  public async fetchRecordsForVin(vin: string): Promise<{ records: VehiclePreciseTraceabilityRecord[]; handoverDate?: string }> {
    const pool = await getDbPool();
    const mappings = await this.getTItemMappings();
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' });

    const query = `
      SELECT TOP 1
        r.*,
        c.handover_tpoint_date
      FROM [dbo].[MES_MQ_RecallItems] r WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) ON r.vin = c.vin
      LEFT JOIN [dbo].[mg_car_as_data] m WITH (NOLOCK) ON r.vin = m.vin
      WHERE r.vin = @vin
        AND ${mgFilter};
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);

    const result = await request.query(query);
    if (result.recordset.length === 0) {
      return { records: [], handoverDate: undefined };
    }

    const row = result.recordset[0];
    const handoverDate = row.handover_tpoint_date ? String(row.handover_tpoint_date).trim() : '';
    const records: VehiclePreciseTraceabilityRecord[] = [];

    for (let i = 1; i <= 150; i++) {
      const field = 'TItem_' + String(i).padStart(2, '0');
      const val = row[field];

      if (val && typeof val === 'string' && val.trim() !== '') {
        const barcode = val.trim();
        const mapping = mappings.get(field);

        const rawScan =
          row[field + '_ScanDatetime'] ||
          row['SM_DateTime'] ||
          handoverDate ||
          '';
        const scanTime = this.formatScanTime(rawScan);

        const keypartType = mapping ? mapping.PartIdentifyCode : '';
        const keypartTypeDescC = mapping ? mapping.PartIdentifyName : '';
        const { partNo, supplierNo } = this.parseBarcode(barcode, keypartType);
        const resolvedPartNo =
          partNo && partNo.trim() !== '' && partNo.trim() !== 'N/A'
            ? partNo.trim()
            : (keypartType || barcode.substring(0, 8) || '54458867');

        records.push({
          isDeleted: '0',
          plantNo: 'ID001',
          vin: vin,
          keypartNo: barcode,
          scanTime: scanTime,
          keypartType: keypartType,
          keypartTypeDescC: keypartTypeDescC,
          vpps: null,
          partNo: resolvedPartNo,
          supplierNo: supplierNo || null,
          orignalLabel: null,
          subKeypartType: null,
          orderType: 'A',
        });
      }
    }

    return { records, handoverDate };
  }

  /**
   * Mengirim payload ke MuleSoft EAI
   */
  public async pushToEai(records: VehiclePreciseTraceabilityRecord[]): Promise<EaiResponse> {
    const cleanRecords = records.map((r) => ({
      ...r,
      plantNo: r.plantNo === 'WH15' ? 'ID001' : (r.plantNo || 'ID001'),
      scanTime: this.formatScanTime(r.scanTime),
    }));

    const payload: VehiclePreciseTraceabilityPayload = {
      data: cleanRecords,
      records: cleanRecords,
    };

    const targetUrl = config.eai.vehiclePreciseTraceabilityUrl;
    logger.info(`Sending ${records.length} keypart record(s) for VIN ${records[0]?.vin} to MuleSoft: ${targetUrl}`);

    const response = await axios.post<EaiResponse>(targetUrl, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      timeout: 20000,
    });

    return response.data;
  }

  /**
   * Update tabel log MES_EAI_VehiclePreciseTraceability_Log
   */
  public async updateLog(
    vin: string,
    keypartCount: number,
    handoverDate: string,
    status: 'SUCCESS' | 'FAILED',
    responseStatus?: string,
    responseMessage?: string,
    payloadJson?: string
  ): Promise<void> {
    const pool = await getDbPool();
    const query = `
      IF EXISTS (SELECT 1 FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log] WHERE [VIN] = @vin)
      BEGIN
        UPDATE [dbo].[MES_EAI_VehiclePreciseTraceability_Log]
        SET 
          [KeypartCount] = @keypartCount,
          [handover_tpoint_date] = @handoverDate,
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
        INSERT INTO [dbo].[MES_EAI_VehiclePreciseTraceability_Log] (
          [VIN], [KeypartCount], [handover_tpoint_date], [Status], 
          [ResponseStatus], [ResponseMessage], [RequestPayload], [RetryCount], [SentAt], [LastAttemptAt]
        )
        VALUES (
          @vin, @keypartCount, @handoverDate, @status, 
          @responseStatus, @responseMessage, @requestPayload,
          CASE WHEN @status = 'FAILED' THEN 1 ELSE 0 END, 
          CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE NULL END, 
          GETDATE()
        );
      END
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);
    request.input('keypartCount', sql.Int, keypartCount);
    request.input('handoverDate', sql.VarChar(50), handoverDate || '');
    request.input('status', sql.VarChar(20), status);
    request.input('responseStatus', sql.VarChar(10), responseStatus || null);
    request.input('responseMessage', sql.NVarChar(500), responseMessage || null);
    request.input('requestPayload', sql.NVarChar(sql.MAX), payloadJson || null);

    await request.query(query);
  }

  /**
   * Menjalankan sinkronisasi batch (maksimal 50 VIN)
   */
  public async syncBatch(limit: number = config.processing.batchSize): Promise<SyncResult> {
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    logger.info(`Starting VehiclePreciseTraceability sync batch (limit: ${safeLimit} VINs)...`);
    const vins = await this.fetchUnsentVins(safeLimit);

    const result: SyncResult = {
      totalProcessed: vins.length,
      successCount: 0,
      failureCount: 0,
      details: [],
    };

    if (vins.length === 0) {
      logger.info('No new or pending records found for VehiclePreciseTraceability.');
      return result;
    }

    logger.info(`Found ${vins.length} pending VIN(s) for VehiclePreciseTraceability.`);

    for (const vin of vins) {
      const { records, handoverDate } = await this.fetchRecordsForVin(vin);

      if (records.length === 0) {
        logger.warn(`VIN ${vin} has no keypart barcode records in MES_MQ_RecallItems. Skipping.`);
        continue;
      }

      const payloadJson = JSON.stringify(
        {
          data: records,
          records: records,
        },
        null,
        2
      );

      try {
        const eaiResp = await this.pushToEai(records);

        if (eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's')) {
          await this.updateLog(vin, records.length, handoverDate || '', 'SUCCESS', eaiResp.status, eaiResp.message, payloadJson);
          result.successCount++;
          result.details.push({
            vin,
            status: 'SUCCESS',
            responseStatus: eaiResp.status,
            message: eaiResp.message,
          });
          logger.info(`VehiclePreciseTraceability VIN ${vin} (${records.length} parts) sent successfully: ${eaiResp.message}`);
        } else {
          const errMsg = eaiResp ? `EAI error: status=${eaiResp.status}, message=${eaiResp.message}` : 'Empty response from EAI';
          await this.updateLog(vin, records.length, handoverDate || '', 'FAILED', eaiResp?.status || 'E', errMsg, payloadJson);
          result.failureCount++;
          result.details.push({
            vin,
            status: 'FAILED',
            responseStatus: eaiResp?.status,
            message: errMsg,
          });
          logger.warn(`VehiclePreciseTraceability VIN ${vin} rejected by EAI: ${errMsg}`);
        }
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Unknown network error';
        await this.updateLog(vin, records.length, handoverDate || '', 'FAILED', 'E', errMsg, payloadJson);
        result.failureCount++;
        result.details.push({
          vin,
          status: 'FAILED',
          responseStatus: 'E',
          message: errMsg,
        });
        logger.error(`Failed to push VehiclePreciseTraceability VIN ${vin} to EAI:`, errMsg);
      }
    }

    logger.info(
      `VehiclePreciseTraceability sync batch finished: ${result.successCount} succeeded, ${result.failureCount} failed out of ${result.totalProcessed}.`
    );

    return result;
  }

  /**
   * Menjalankan sinkronisasi khusus 1 nomor VIN
   */
  public async syncSingleVin(vin: string): Promise<{ success: boolean; message: string; data?: any }> {
    logger.info(`Manual sync requested for VehiclePreciseTraceability VIN: ${vin}`);
    const { records, handoverDate } = await this.fetchRecordsForVin(vin);

    if (records.length === 0) {
      return { success: false, message: `VIN [${vin}] not found or has no keypart barcodes in MES_MQ_RecallItems.` };
    }

    const payloadJson = JSON.stringify(
      {
        data: records,
        records: records,
      },
      null,
      2
    );

    try {
      const eaiResp = await this.pushToEai(records);
      const isSuccess = eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's');

      await this.updateLog(
        vin,
        records.length,
        handoverDate || '',
        isSuccess ? 'SUCCESS' : 'FAILED',
        eaiResp.status,
        eaiResp.message,
        payloadJson
      );

      return {
        success: isSuccess,
        message: eaiResp.message,
        data: {
          vin,
          keypartCount: records.length,
          handoverDate,
          eaiResponse: eaiResp,
        },
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Network error';
      await this.updateLog(vin, records.length, handoverDate || '', 'FAILED', 'E', errMsg, payloadJson);
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
        [KeypartCount],
        [handover_tpoint_date],
        [Status],
        [ResponseStatus],
        [ResponseMessage],
        [RetryCount],
        CONVERT(VARCHAR(19), [SentAt], 120) AS [SentAt],
        CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt]
      FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log] WITH (NOLOCK)
      ORDER BY [LastAttemptAt] DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, limit);
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Mengambil payload JSON tersimpan atau generated untuk VIN tertentu
   */
  public async getPayloadByVin(vin: string): Promise<any> {
    const pool = await getDbPool();
    const logResult = await pool
      .request()
      .input('vin', sql.VarChar(50), vin)
      .query(`SELECT [RequestPayload], [Status], [ResponseStatus], [ResponseMessage], CONVERT(VARCHAR(19), [LastAttemptAt], 120) AS [LastAttemptAt] 
              FROM [dbo].[MES_EAI_VehiclePreciseTraceability_Log] WITH (NOLOCK) WHERE [VIN] = @vin`);

    let payload: any = null;
    let logInfo = null;

    if (logResult.recordset.length > 0) {
      logInfo = logResult.recordset[0];
      if (logInfo.RequestPayload) {
        try {
          payload = JSON.parse(logInfo.RequestPayload);
          const sanitizeItem = (item: any) => {
            if (item.plantNo === 'WH15') item.plantNo = 'ID001';
            if (item.scanTime) item.scanTime = this.formatScanTime(item.scanTime);
          };
          if (payload && Array.isArray(payload.records)) payload.records.forEach(sanitizeItem);
          if (payload && Array.isArray(payload.data)) payload.data.forEach(sanitizeItem);
          if (Array.isArray(payload)) payload.forEach(sanitizeItem);
        } catch (e) {
          payload = logInfo.RequestPayload;
        }
      }
    }

    if (!payload) {
      const { records } = await this.fetchRecordsForVin(vin);
      if (records.length > 0) {
        payload = {
          data: records,
          records: records,
        };
      }
    }

    return {
      vin,
      interfaceName: 'Vehicle Precise Traceability',
      log: logInfo,
      payload,
    };
  }
}

export const vehiclePreciseTraceabilityService = new VehiclePreciseTraceabilityService();
