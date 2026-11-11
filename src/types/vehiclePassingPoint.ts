export interface VehiclePassingPointRecord {
  plantNo: string;
  moNum: string;
  vin: string;
  ulocNo: string;
  arrivalTime: string;
  leavingTime: string;
  isDeleted: string;
  raw_handover_date?: string;
}

export interface VehiclePassingPointPayload {
  records: VehiclePassingPointRecord[];
}
