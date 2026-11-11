export interface OrderBroadcastRecord {
  plantNo: string;
  plantName: string;
  plantNameC: string;
  zvinno: string;
  zvrn: string;
  drnno: string;
  zsono: string;
  zordtyp: string;
  planStart: string;
  planFinish: string;
  zdeleted: string;
  zdeldate: string;
  zdeltime: string;
  isDeleted: string;
  raw_exact_date?: string;
}

export interface OrderBroadcastPayload {
  records: OrderBroadcastRecord[];
}

export interface EaiResponse {
  status: string; // 'S' for success, 'E' for error
  message: string;
}

export interface SyncResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  details: {
    vin: string;
    status: 'SUCCESS' | 'FAILED';
    responseStatus?: string;
    message?: string;
  }[];
}
