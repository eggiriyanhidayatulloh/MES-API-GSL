import sql from 'mssql';
import axios from 'axios';
import { getDbPool } from '../db/sqlConnection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { buildStrictMgWhereSql, buildReleaseDateExpr, buildReleaseDateFilterSql } from '../utils/vehicleFilter';
import {
  VehiclePassingPointRecord,
  VehiclePassingPointPayload,
} from '../types/vehiclePassingPoint';
import { EaiResponse, SyncResult } from '../types/orderBroadcast';

export class VehiclePassingPointService {
  /**
   * Mengambil data kendaraan yang handover_tpoint_date sudah terisi dan belum pernah sukses dikirim
   */
  public async fetchUnsentRecords(limit: number = config.processing.batchSize): Promise<VehiclePassingPointRecord[]> {
    const pool = await getDbPool();
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' });
    const dateCols = ['c.handover_tpoint_date'];
    const query = `
      SELECT TOP (@limit)
        'ID001'                                                                              AS plantNo,
        b.plan_ID                                                                            AS moNum,
        b.VIN                                                                                AS vin,
        'GA'                                                                                 AS ulocNo,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS arrivalTime,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.handover_tpoint_date, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS leavingTime,
        '0'                                                                                  AS isDeleted,
        c.handover_tpoint_date                                                               AS raw_handover_date
      FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK) 
          ON m.vin = b.VIN
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON m.vin = c.vin
      LEFT JOIN [BaseData].[dbo].[VehicleCode] vc WITH (NOLOCK) 
          ON m.vehiclecode = vc.vehiclecode 
         AND m.vsn_10 = vc.vsn
      LEFT JOIN [dbo].[MES_EAI_VehiclePassingPoint_Log] l WITH (NOLOCK) 
          ON b.VIN = l.VIN
      WHERE ${mgFilter}
        AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
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
    return result.recordset as VehiclePassingPointRecord[];
  }

  /**
   * Mengambil data spesifik berdasarkan nomor VIN
   */
  public async fetchRecordByVin(vin: string): Promise<VehiclePassingPointRecord | null> {
    const pool = await getDbPool();
    const mgFilter = buildStrictMgWhereSql({ traceAlias: 'c', mgAlias: 'm' });
    const query = `
      SELECT TOP 1
        'ID001'                                                                              AS plantNo,
        b.plan_ID                                                                            AS moNum,
        b.VIN                                                                                AS vin,
        'GA'                                                                                 AS ulocNo,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS arrivalTime,
        CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.handover_tpoint_date, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                                             AS leavingTime,
        '0'                                                                                  AS isDeleted,
        c.handover_tpoint_date                                                               AS raw_handover_date
      FROM [dbo].[mg_car_as_data] m WITH (NOLOCK)
      INNER JOIN [dbo].[MES_Plan_BodySequence] b WITH (NOLOCK) 
          ON m.vin = b.VIN
      INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
          ON m.vin = c.vin
      LEFT JOIN [BaseData].[dbo].[VehicleCode] vc WITH (NOLOCK) 
          ON m.vehiclecode = vc.vehiclecode 
         AND m.vsn_10 = vc.vsn
      WHERE b.VIN = @vin
        AND ${mgFilter};
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);

    const result = await request.query(query);
    if (result.recordset.length === 0) {
      return null;
    }
    return result.recordset[0] as VehiclePassingPointRecord;
  }

  /**
   * Mengirim payload ke MuleSoft EAI
   */
  public async pushToEai(records: VehiclePassingPointRecord[]): Promise<EaiResponse> {
    const payload: VehiclePassingPointPayload = {
      records: records.map((r) => ({
        plantNo: r.plantNo === 'WH15' ? 'ID001' : (r.plantNo || 'ID001'),
        moNum: r.moNum || '',
        vin: r.vin,
        ulocNo: (!r.ulocNo || r.ulocNo.trim() === '') ? 'GA' : r.ulocNo.trim(),
        arrivalTime: r.arrivalTime,
        leavingTime: r.leavingTime,
        isDeleted: r.isDeleted,
      })),
    };

    const targetUrl = config.eai.vehiclePassingPointUrl;
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
   * Update tabel log MES_EAI_VehiclePassingPoint_Log
   */
  public async updateLog(
    vin: string,
    moNum: string,
    handoverDate: string,
    status: 'SUCCESS' | 'FAILED',
    responseStatus?: string,
    responseMessage?: string,
    payloadJson?: string
  ): Promise<void> {
    const pool = await getDbPool();
    const query = `
      IF EXISTS (SELECT 1 FROM [dbo].[MES_EAI_VehiclePassingPoint_Log] WHERE [VIN] = @vin)
      BEGIN
        UPDATE [dbo].[MES_EAI_VehiclePassingPoint_Log]
        SET 
          [moNum] = @moNum,
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
        INSERT INTO [dbo].[MES_EAI_VehiclePassingPoint_Log] (
          [VIN], [moNum], [handover_tpoint_date], [Status], 
          [ResponseStatus], [ResponseMessage], [RequestPayload], [RetryCount], [SentAt], [LastAttemptAt]
        )
        VALUES (
          @vin, @moNum, @handoverDate, @status, 
          @responseStatus, @responseMessage, @requestPayload,
          CASE WHEN @status = 'FAILED' THEN 1 ELSE 0 END, 
          CASE WHEN @status = 'SUCCESS' THEN GETDATE() ELSE NULL END, 
          GETDATE()
        );
      END
    `;

    const request = pool.request();
    request.input('vin', sql.VarChar(50), vin);
    request.input('moNum', sql.VarChar(50), moNum || '');
    request.input('handoverDate', sql.VarChar(50), handoverDate || '');
    request.input('status', sql.VarChar(20), status);
    request.input('responseStatus', sql.VarChar(10), responseStatus || null);
    request.input('responseMessage', sql.NVarChar(500), responseMessage || null);
    request.input('requestPayload', sql.NVarChar(sql.MAX), payloadJson || null);

    await request.query(query);
  }

  /**
   * Menjalankan sinkronisasi batch
   */
  public async syncBatch(limit: number = config.processing.batchSize): Promise<SyncResult> {
    const safeLimit = Math.min(Math.max(1, limit || config.processing.batchSize), 50);
    logger.info(`Starting VehiclePassingPoint sync batch (limit: ${safeLimit})...`);
    const records = await this.fetchUnsentRecords(safeLimit);

    const result: SyncResult = {
      totalProcessed: records.length,
      successCount: 0,
      failureCount: 0,
      details: [],
    };

    if (records.length === 0) {
      logger.info('No new or pending records found for VehiclePassingPoint.');
      return result;
    }

    logger.info(`Found ${records.length} pending record(s) for VehiclePassingPoint.`);

    for (const record of records) {
      const vin = record.vin;
      const moNum = record.moNum;
      const handoverDate = record.raw_handover_date || '';
      const payloadJson = JSON.stringify({
        records: [{
          plantNo: record.plantNo,
          moNum: record.moNum,
          vin: record.vin,
          ulocNo: record.ulocNo,
          arrivalTime: record.arrivalTime,
          leavingTime: record.leavingTime,
          isDeleted: record.isDeleted,
        }]
      }, null, 2);

      try {
        const eaiResp = await this.pushToEai([record]);

        if (eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's')) {
          await this.updateLog(vin, moNum, handoverDate, 'SUCCESS', eaiResp.status, eaiResp.message, payloadJson);
          result.successCount++;
          result.details.push({
            vin,
            status: 'SUCCESS',
            responseStatus: eaiResp.status,
            message: eaiResp.message,
          });
          logger.info(`VehiclePassingPoint VIN ${vin} sent successfully: ${eaiResp.message}`);
        } else {
          const errMsg = eaiResp ? `EAI error: status=${eaiResp.status}, message=${eaiResp.message}` : 'Empty response from EAI';
          await this.updateLog(vin, moNum, handoverDate, 'FAILED', eaiResp?.status || 'E', errMsg, payloadJson);
          result.failureCount++;
          result.details.push({
            vin,
            status: 'FAILED',
            responseStatus: eaiResp?.status,
            message: errMsg,
          });
          logger.warn(`VehiclePassingPoint VIN ${vin} rejected by EAI: ${errMsg}`);
        }
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Unknown network error';
        await this.updateLog(vin, moNum, handoverDate, 'FAILED', 'E', errMsg, payloadJson);
        result.failureCount++;
        result.details.push({
          vin,
          status: 'FAILED',
          responseStatus: 'E',
          message: errMsg,
        });
        logger.error(`Failed to push VehiclePassingPoint VIN ${vin} to EAI:`, errMsg);
      }
    }

    logger.info(
      `VehiclePassingPoint sync batch finished: ${result.successCount} succeeded, ${result.failureCount} failed out of ${result.totalProcessed}.`
    );

    return result;
  }

  /**
   * Menjalankan sinkronisasi khusus 1 nomor VIN
   */
  public async syncSingleVin(vin: string): Promise<{ success: boolean; message: string; data?: any }> {
    logger.info(`Manual sync requested for VehiclePassingPoint VIN: ${vin}`);
    const record = await this.fetchRecordByVin(vin);

    if (!record) {
      return { success: false, message: `VIN [${vin}] not found or missing handover date.` };
    }

    const payloadJson = JSON.stringify({
      records: [{
        plantNo: record.plantNo,
        moNum: record.moNum,
        vin: record.vin,
        ulocNo: record.ulocNo,
        arrivalTime: record.arrivalTime,
        leavingTime: record.leavingTime,
        isDeleted: record.isDeleted,
      }]
    }, null, 2);

    try {
      const eaiResp = await this.pushToEai([record]);
      const isSuccess = eaiResp && (eaiResp.status === 'S' || eaiResp.status === 's');

      await this.updateLog(
        vin,
        record.moNum,
        record.raw_handover_date || '',
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
          moNum: record.moNum,
          arrivalTime: record.arrivalTime,
          leavingTime: record.leavingTime,
          eaiResponse: eaiResp,
        },
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Network error';
      await this.updateLog(vin, record.moNum, record.raw_handover_date || '', 'FAILED', 'E', errMsg, payloadJson);
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
        [moNum],
        [handover_tpoint_date],
        [Status],
        [ResponseStatus],
        [ResponseMessage],
        [RetryCount],
        [SentAt],
        [LastAttemptAt]
      FROM [dbo].[MES_EAI_VehiclePassingPoint_Log] WITH (NOLOCK)
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
              FROM [dbo].[MES_EAI_VehiclePassingPoint_Log] WITH (NOLOCK) WHERE [VIN] = @vin`);

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
              if (!rec.ulocNo || rec.ulocNo.trim() === '') rec.ulocNo = 'GA';
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
              moNum: record.moNum,
              vin: record.vin,
              ulocNo: (!record.ulocNo || record.ulocNo.trim() === '') ? 'GA' : record.ulocNo.trim(),
              arrivalTime: record.arrivalTime,
              leavingTime: record.leavingTime,
              isDeleted: record.isDeleted,
            },
          ],
        };
      }
    }

    return {
      vin,
      interfaceName: 'Vehicle Passing Point',
      log: logInfo,
      payload,
    };
  }
}

export const vehiclePassingPointService = new VehiclePassingPointService();
