export interface VehiclePreciseTraceabilityRecord {
  isDeleted: string;
  plantNo: string;
  vin: string;
  keypartNo: string;
  scanTime: string;
  keypartType: string;
  keypartTypeDescC: string;
  vpps?: string | null;
  partNo: string;
  supplierNo?: string | null;
  orignalLabel?: string | null;
  subKeypartType?: string | null;
  orderType?: string | null;
}

export interface VehiclePreciseTraceabilityPayload {
  data: VehiclePreciseTraceabilityRecord[];
  records: VehiclePreciseTraceabilityRecord[];
}

export interface VehiclePreciseTraceabilityLogEntry {
  VIN: string;
  KeypartCount: number;
  handover_tpoint_date?: string;
  Status: 'SUCCESS' | 'FAILED';
  ResponseStatus?: string;
  ResponseMessage?: string;
  RequestPayload?: string;
  RetryCount: number;
  SentAt?: string;
  LastAttemptAt?: string;
}
