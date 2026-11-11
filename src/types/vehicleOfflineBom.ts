export interface VehicleOfflineBomRecord {
  recordId?: number | string;
  bomversion: string;
  plantNo: string;
  plantName: string;
  plantNameC: string;
  materialNo: string;
  partno: string;
  product: string;
  modelyear: string;
  ecuname: string;
  moduleid: string | null;
  vin: string | null;
  isDeleted: string;
}

export interface VehicleOfflineBomPayloadItem {
  bomversion: string;
  plantNo: string;
  plantName: string;
  plantNameC: string;
  materialNo: string;
  partno: string;
  product: string;
  modelyear: string;
  ecuname: string;
  moduleid: string | null;
  vin: string | null;
  isDeleted: string;
}

export interface VehicleOfflineBomPayload {
  records: VehicleOfflineBomPayloadItem[];
}

export interface VehicleOfflineBomSyncDetail {
  recordId: number | string;
  materialNo: string;
  partno: string;
  status: 'SUCCESS' | 'FAILED';
  responseStatus?: string;
  message?: string;
}

export interface VehicleOfflineBomSyncResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  details: VehicleOfflineBomSyncDetail[];
}
