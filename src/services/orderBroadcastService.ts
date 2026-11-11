import sql from 'mssql';
import axios from 'axios';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { buildStrictMgWhereSql, buildReleaseDateExpr, buildReleaseDateFilterSql } from '../utils/vehicleFilter';
import {
  OrderBroadcastRecord,
  OrderBroadcastPayload,
  EaiResponse,
  SyncResult,
} from '../types/orderBroadcast';

export class OrderBroadcastService {
  /**
   * Mengambil record yang belum pernah dikirim atau yang gagal (retry < MAX_RETRY_COUNT)
   */
  public async fetchUnsentRecords(limit: number = config.processing.batchSize): Promise<OrderBroadcastRecord[]> {
    const pool = await getDbPool();
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c' });
    const dateCols = ['c.GAOnline_Tpoint_ExactDate'];
    const query = `
      SELECT TOP (@limit)
        'ID001'                                                                               AS plantNo,
        'PT. SGMW Motor Indonesia'                                                           AS plantName,
        'Cikarang Factory'                                                                   AS plantNameC,
        b.VIN                                                                                AS zvinno,
        ''                                                                                   AS zvrn,
        ''                                                                                   AS drnno,
        b.plan_ID                                                                            AS zsono,
        'MG_Order'                                                                           AS zordtyp,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS planStart,
        CONVERT(VARCHAR(19), DATEADD(DAY, 5, TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME)), 126) + 'Z' 
                                                                                             AS planFinish,
        '0'                                                                                  AS zdeleted,
        ''                                                                                   AS zdeldate,
        ''                                                                                   AS zdeltime,
        '0'                                                                                  AS isDeleted,
        c.GAOnline_Tpoint_ExactDate                                                          AS raw_exact_date
      FROM [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON b.VIN = c.vin
      LEFT JOIN [dbo].[MES_EAI_OrderBroadcast_Log] l WITH (NOLOCK) 
          ON b.VIN = l.VIN
      WHERE ${mgFilter}
        AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
        AND c.GAOnline_Tpoint_ExactDate <> ''
        AND ${buildReleaseDateFilterSql(dateCols)}
        AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
      ORDER BY ${buildReleaseDateExpr(dateCols)} DESC, c.Auto_ID DESC;
    `;

    const request = pool.request();
    request.input('limit', sql.Int, safeLimit);
    request.input('maxRetry', sql.Int, config.processing.maxRetryCount);
    request.input('releaseStartDate', sql.VarChar(20), config.processing.releaseStartDate);

    const result = await request.query(query);
    return result.recordset as OrderBroadcastRecord[];
  }

  /**
   * Mengambil data spesifik berdasarkan nomor VIN
   */
  public async fetchRecordByVin(vin: string): Promise<OrderBroadcastRecord | null> {
    const pool = await getDbPool();
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c' });
    const query = `
      SELECT TOP 1
        'ID001'                                                                               AS plantNo,
        'PT. SGMW Motor Indonesia'                                                           AS plantName,
        'Cikarang Factory'                                                                   AS plantNameC,
        b.VIN                                                                                AS zvinno,
        ''                                                                                   AS zvrn,
        ''                                                                                   AS drnno,
        b.plan_ID                                                                            AS zsono,
        'MG_Order'                                                                           AS zordtyp,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS planStart,
        CONVERT(VARCHAR(19), DATEADD(DAY, 5, TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME)), 126) + 'Z' 
                                                                                             AS planFinish,
        '0'                                                                                  AS zdeleted,
        ''                                                                                   AS zdeldate,
        ''                                                                                   AS zdeltime,
        '0'                                                                                  AS isDeleted,
        c.GAOnline_Tpoint_ExactDate                                                          AS raw_exact_date
      FROM [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON b.VIN = c.vin
      WHERE b.VIN = @vin
        AND ${mgFilter};
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);

    const result = await request.query(query);
    if (result.recordset.length === 0) {
      return null;
    }
    return result.recordset[0] as OrderBroadcastRecord;
  }

  /**
   * Mengirim payload ke MuleSoft EAI
   */
  public async pushToEai(records: OrderBroadcastRecord[]): Promise<EaiResponse> {
    const payload: OrderBroadcastPayload = {
      records: records.map((r) => ({
        plantNo: r.plantNo === 'WH15' ? 'ID001' : (r.plantNo || 'ID001'),
        plantName: r.plantName,
        plantNameC: r.plantNameC,
        zvinno: r.zvinno,
        zvrn: r.zvrn,
        drnno: r.drnno,
        zsono: r.zsono,
        zordtyp: r.zordtyp,
        planStart: r.planStart,
        planFinish: r.planFinish,
        zdeleted: r.zdeleted,
        zdeldate: r.zdeldate,
        zdeltime: r.zdeltime,
        isDeleted: r.isDeleted,
      })),
    };

    const targetUrl = config.eai.orderBroadcastUrl;
    logger.info(`Sending ${payload.records.length} record(s) to MuleSoft [${config.eai.environment}]: ${targetUrl}`);

    const response = await axios.post<EaiResponse>(targetUrl, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      timeout: 15000,
    });

    return response.data;
  }

  /**
   * Update status pengiriman di tabel log
   */
  public async updateLog(
    vin: string,
    planId: string,
    exactDate: string,
    status: 'SUCCESS' | 'FAILED',
    responseStatus?: string,
    responseMessage?: string,
    payloadJson?: string
  ): Promise<void> {
    const pool = await getDbPool();
    const query = `
      IF EXISTS (SELECT 1 FROM [dbo].[MES_EAI_OrderBroadcast_Log] WHERE [VIN] = @vin)
      BEGIN
        UPDATE [dbo].[MES_EAI_OrderBroadcast_Log]
        SET 
          [plan_ID] = @planId,
          [GAOnline_Tpoint_ExactDate] = @exactDate,
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
        INSERT INTO [dbo].[MES_EAI_OrderBroadcast_Log] (
          [VIN], [plan_ID], [GAOnline_Tpoint_ExactDate], [Status], 
          [ResponseStatus], [ResponseMessage], [RequestPayload], [RetryCount], [SentAt], [LastAttemptAt]
        )
        VALUES (
          @vin, @planId, @exactDate, @status, 
          @responseStatus, @responseMessage, @requestPayload,
          CASE WHEN @status = 'FAILED' THEN 1 ELSE 0 END, 
          CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE NULL END, 
          GETDATE()
        );
      END
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);
    request.input('planId', sql.VarChar(50), planId || '');
    request.input('exactDate', sql.VarChar(50), exactDate || '');
    request.input('status', sql.VarChar(20), status);
    request.input('responseStatus', sql.VarChar(10), responseStatus || null);
    request.input('responseMessage', sql.NVarChar(500), responseMessage || null);
    request.input('requestPayload', sql.NVarChar(sql.MAX), payloadJson || null);

    await request.query(query);
  }

  /**
   * Menjalankan proses sinkronisasi batch (digunakan oleh cron scheduler & REST endpoint)
   */
  public async syncBatch(limit: number = config.processing.batchSize): Promise<SyncResult> {
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    logger.info(`Starting OrderBroadcast sync batch (limit: ${safeLimit})...`);
    const records = await this.fetchUnsentRecords(safeLimit);

    const result: SyncResult = {
      totalProcessed: records.length,
      successCount: 0,
      failureCount: 0,
      details: [],
    };

    if (records.length === 0) {
      logger.info('No new or pending records found for OrderBroadcast.');
      return result;
    }

    logger.info(`Found ${records.length} pending record(s) to send.`);

    // Kirim per record untuk memastikan isolasi error dan audit log per VIN
    for (const record of records) {
      const vin = record.zvinno;
      const planId = record.zsono;
      const exactDate = record.raw_exact_date || '';
      const payloadJson = JSON.stringify({ records: [record] }, null, 2);

      try {
        const eaiResp = await this.pushToEai([record]);

        // Cek respon status dari MuleSoft ('S' = Success)
        if (eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's')) {
          await this.updateLog(vin, planId, exactDate, 'SUCCESS', eaiResp.status, eaiResp.message, payloadJson);
          result.successCount++;
          result.details.push({
            vin,
            status: 'SUCCESS',
            responseStatus: eaiResp.status,
            message: eaiResp.message,
          });
          logger.info(`VIN ${vin} sent successfully: ${eaiResp.message}`);
        } else {
          const errMsg = eaiResp ? `EAI returned error: status=${eaiResp.status}, message=${eaiResp.message}` : 'Empty response from EAI';
          await this.updateLog(vin, planId, exactDate, 'FAILED', eaiResp?.status || 'E', errMsg, payloadJson);
          result.failureCount++;
          result.details.push({
            vin,
            status: 'FAILED',
            responseStatus: eaiResp?.status,
            message: errMsg,
          });
          logger.warn(`VIN ${vin} rejected by EAI: ${errMsg}`);
        }
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Unknown network error';
        await this.updateLog(vin, planId, exactDate, 'FAILED', 'E', errMsg, payloadJson);
        result.failureCount++;
        result.details.push({
          vin,
          status: 'FAILED',
          responseStatus: 'E',
          message: errMsg,
        });
        logger.error(`Failed to push VIN ${vin} to EAI:`, errMsg);
      }
    }

    logger.info(
      `OrderBroadcast sync batch finished: ${result.successCount} succeeded, ${result.failureCount} failed out of ${result.totalProcessed}.`
    );

    return result;
  }

  /**
   * Menjalankan sinkronisasi khusus 1 nomor VIN
   */
  public async syncSingleVin(vin: string): Promise<{ success: boolean; message: string; data?: any }> {
    logger.info(`Manual sync requested for VIN: ${vin}`);
    const record = await this.fetchRecordByVin(vin);

    if (!record) {
      return { success: false, message: `VIN [${vin}] not found in MES_Plan_BodySequence or missing exact date.` };
    }

    const payloadJson = JSON.stringify({ records: [record] }, null, 2);

    try {
      const eaiResp = await this.pushToEai([record]);
      const isSuccess = eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's');

      await this.updateLog(
        vin,
        record.zsono,
        record.raw_exact_date || '',
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
          planId: record.zsono,
          planStart: record.planStart,
          planFinish: record.planFinish,
          eaiResponse: eaiResp,
        },
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Network error';
      await this.updateLog(vin, record.zsono, record.raw_exact_date || '', 'FAILED', 'E', errMsg, payloadJson);
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
        [plan_ID],
        [GAOnline_Tpoint_ExactDate],
        [Status],
        [ResponseStatus],
        [ResponseMessage],
        [RetryCount],
        [SentAt],
        [LastAttemptAt]
      FROM [dbo].[MES_EAI_OrderBroadcast_Log] WITH (NOLOCK)
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
    const logResult = await pool.request()
      .input('vin', sql.VarChar(50), vin)
      .query(`SELECT [RequestPayload], [Status], [ResponseStatus], [ResponseMessage], [LastAttemptAt] 
              FROM [dbo].[MES_EAI_OrderBroadcast_Log] WITH (NOLOCK) WHERE [VIN] = @vin`);

    let payload: any = null;
    let logInfo = null;

    if (logResult.recordset.length > 0) {
      logInfo = logResult.recordset[0];
      if (logInfo.RequestPayload) {
        try {
          payload = JSON.parse(logInfo.RequestPayload);
          if (payload && Array.isArray(payload.records)) {
            payload.records.forEach((rec: any) => {
              if (rec.plantNo === 'WH15') rec.plantNo = 'ID001';
            });
          }
        } catch (e) {
          payload = logInfo.RequestPayload;
        }
      }
    }

    if (!payload) {
      const record = await this.fetchRecordByVin(vin);
      if (record) {
        payload = {
          records: [
            {
              plantNo: record.plantNo === 'WH15' ? 'ID001' : (record.plantNo || 'ID001'),
              plantName: record.plantName,
              plantNameC: record.plantNameC,
              zvinno: record.zvinno,
              zvrn: record.zvrn,
              drnno: record.drnno,
              zsono: record.zsono,
              zordtyp: record.zordtyp,
              planStart: record.planStart,
              planFinish: record.planFinish,
              zdeleted: record.zdeleted,
              zdeldate: record.zdeldate,
              zdeltime: record.zdeltime,
              isDeleted: record.isDeleted,
            },
          ],
        };
      }
    }

    return {
      vin,
      interfaceName: 'Order Broadcast',
      log: logInfo,
      payload,
    };
  }
}

export const orderBroadcastService = new OrderBroadcastService();
