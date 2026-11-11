import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    server: process.env.DB_SERVER || '10.140.240.10',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'PTSGMW_MES',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '15000', 10),
      requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT || '30000', 10),
    },
    pool: {
      max: 10,
      min: 1,
      idleTimeoutMillis: 30000,
    },
  },

  eai: {
    environment: (process.env.EAI_ENV || 'TEST').toUpperCase(),
    orderBroadcastUrl:
      (process.env.EAI_ENV || 'TEST').toUpperCase() === 'PRD'
        ? process.env.EAI_ORDER_BROADCAST_PRD_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_OrderBroadcast_Pub'
        : process.env.EAI_ORDER_BROADCAST_TEST_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_OrderBroadcast_Pub',
    vehicleBasicInfoUrl:
      (process.env.EAI_ENV || 'TEST').toUpperCase() === 'PRD'
        ? process.env.EAI_VEHICLE_BASIC_INFO_PRD_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleBasicInfo_Pub'
        : process.env.EAI_VEHICLE_BASIC_INFO_TEST_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleBasicInfo_Pub',
    vehiclePassingPointUrl:
      (process.env.EAI_ENV || 'TEST').toUpperCase() === 'PRD'
        ? process.env.EAI_VEHICLE_PASSING_POINT_PRD_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePassingPoint_Pub'
        : process.env.EAI_VEHICLE_PASSING_POINT_TEST_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePassingPoint_Pub',
    vehiclePreciseTraceabilityUrl:
      (process.env.EAI_ENV || 'TEST').toUpperCase() === 'PRD'
        ? process.env.EAI_VEHICLE_PRECISE_TRACEABILITY_PRD_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePreciseTraceability_Pub'
        : process.env.EAI_VEHICLE_PRECISE_TRACEABILITY_TEST_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePreciseTraceability_Pub',
    vehicleOfflineBomUrl:
      (process.env.EAI_ENV || 'TEST').toUpperCase() === 'PRD'
        ? process.env.EAI_VEHICLE_OFFLINE_BOM_PRD_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub'
        : process.env.EAI_VEHICLE_OFFLINE_BOM_TEST_URL || 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub',
  },

  scheduler: {
    enabled: process.env.CRON_ENABLED === 'true',
    cronOrderBroadcast: process.env.CRON_ORDER_BROADCAST || '*/30 * * * *',
    cronVehicleBasicInfo: process.env.CRON_VEHICLE_BASIC_INFO || '*/30 * * * *',
    cronVehiclePassingPoint: process.env.CRON_VEHICLE_PASSING_POINT || '*/30 * * * *',
    cronVehiclePreciseTraceability: process.env.CRON_VEHICLE_PRECISE_TRACEABILITY || '*/30 * * * *',
    cronVehicleOfflineBom: process.env.CRON_VEHICLE_OFFLINE_BOM || '*/30 * * * *',
  },

  processing: {
    batchSize: Math.min(parseInt(process.env.BATCH_SIZE || '50', 10), 50),
    maxRetryCount: parseInt(process.env.MAX_RETRY_COUNT || '3', 10),
    releaseStartDate: (process.env.RELEASE_START_DATE || '2026-11-10').trim(),
  },

  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || '',
    jwtSecret: process.env.JWT_SECRET || '',
  },
};
