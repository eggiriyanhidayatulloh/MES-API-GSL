export interface VehicleBasicInfoConfigItem {
  id?: string;
  featureId: string;
  featureCode: string;
  orderNo: string | null;
  lastUpdateTime: string | null;
  orderType: string | null;
}

export interface VehicleBasicInfoRecord {
  id?: string;
  plantNo: string;
  product: string | null;
  modelyear: string | null;
  orderNo: string | null;
  orderType: string | null;
  orderStatus: string | null;
  prodFinishTime: string | null;
  drnno: string | null;
  normt: string;
  materialNo: string | null;
  tps: string | null;
  vin: string;
  engineNo: string | null;
  checkoutNo14: string | null;
  checkoutNo15: string | null;
  checkoutDate: string | null;
  pn: string | null;
  vehicleStatus: string | null;
  gaTime: string | null;
  finishTime: string | null;
  bomversion: string | null;
  testRepNo: string | null;
  productCode: string | null;
  zvrn: string | null;
  productType: string | null;
  vsn: string | null;
  assembleDesc: string | null;
  reservedField1: string | null;
  tvv: string | null;
  vhcModel: string | null;
  configs: VehicleBasicInfoConfigItem[];

  // Internal metadata fields (used for logging and tracking)
  vehiclecode?: string;
  isDeleted?: string;
  boms?: any[];
}

export interface VehicleBasicInfoPayloadItem {
  id?: string;
  plantNo: string;
  product: string | null;
  modelyear: string | null;
  orderNo: string | null;
  orderType: string | null;
  orderStatus: string | null;
  prodFinishTime: string | null;
  drnno: string | null;
  normt: string;
  materialNo: string | null;
  tps: string | null;
  vin: string;
  engineNo: string | null;
  checkoutNo14: string | null;
  checkoutNo15: string | null;
  checkoutDate: string | null;
  pn: string | null;
  vehicleStatus: string | null;
  gaTime: string | null;
  finishTime: string | null;
  bomversion: string | null;
  testRepNo: string | null;
  productCode: string | null;
  zvrn: string | null;
  productType: string | null;
  vsn: string | null;
  assembleDesc: string | null;
  reservedField1: string | null;
  tvv: string | null;
  vhcModel: string | null;
  configs: VehicleBasicInfoConfigItem[];
}

export interface VehicleBasicInfoPayload {
  records: VehicleBasicInfoPayloadItem[];
}

// Backward compatibility aliases
export type ConfigItem = VehicleBasicInfoConfigItem;
export interface BomItem {
  id: string;
  partNo: string;
  ecuname: string;
  moduleid: string;
}
