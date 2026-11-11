export interface InterfaceDetail {
  id: string;
  name: string;
  title: string;
  description: string;
  eaiEndpoint: string;
  triggerCondition: string;
  brandFilter: string;
  tables: Array<{ name: string; description: string }>;
  sqlQueries: Array<{ label: string; query: string }>;
  transformationRules: string[];
  payloadSample: any;
}

export const interfaceMetadata: Record<string, InterfaceDetail> = {
  'order-broadcast': {
    id: 'order-broadcast',
    name: 'MES_OrderBroadcast_Pub',
    title: '1. Order Broadcast',
    description: 'Mengirimkan data rencana produksi dan konfirmasi antrian GA Online ke MuleSoft EAI saat unit mencapai milestone GA Online.',
    eaiEndpoint: 'http://10.140.240.6:8888/http2dumpdb/MES_OrderBroadcast_Pub',
    triggerCondition: 'c.GAOnline_Tpoint_ExactDate IS NOT NULL AND c.GAOnline_Tpoint_ExactDate > 0',
    brandFilter: "c.brand = 'MG' OR c.ExtItem9 = 'MG'",
    tables: [
      { name: '[dbo].[MES_Plan_BodySequence]', description: 'Data master sequence bodi dan plan_ID (zsono).' },
      { name: '[dbo].[MES_Trace_Cars]', description: 'Pencatatan tracking mobil fisik, status GA Online, dan brand MG.' },
      { name: '[dbo].[MES_EAI_OrderBroadcast_Log]', description: 'Tabel log transmisi khusus untuk tracking pengiriman dan histori payload.' },
    ],
    sqlQueries: [
      {
        label: 'Fetch Pending / Unsent Records (Batch)',
        query: `SELECT TOP (@limit)
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
WHERE c.ExtItem9 = 'MG'
  AND ISNULL(LTRIM(RTRIM(c.CarVarietyCode)), '') NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND ISNULL(c.ProjectName, '') NOT IN ('CN113R', 'CN210MR')
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Confero%' AND ISNULL(c.ExtItem6, '') NOT LIKE 'Cortez%'
  AND c.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
  AND c.GAOnline_Tpoint_ExactDate <> ''
  AND TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.GAOnline_Tpoint_ExactDate)), 1, 19) AS DATETIME) >= TRY_CAST(@releaseStartDate AS DATETIME)
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
ORDER BY TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.GAOnline_Tpoint_ExactDate)), 1, 19) AS DATETIME) DESC, c.Auto_ID DESC;`,
      },
    ],
    transformationRules: [
      'plantNo bernilai "ID001" (diubah dari "WH15").',
      'Hanya mengambil kendaraan MG asli (mengecualikan Confero/Cortez/Wuling seperti C81C/CN113R).',
      'Hanya mengambil data terbaru per tanggal release (>= RELEASE_START_DATE) dengan urutan terbaru duluan (DESC).',
      'Trigger aktif jika unit telah melewati titik GA Online (GAOnline_Tpoint_ExactDate terisi).',
      'Maksimal 50 record per siklus batch (safe limit).',
    ],
    payloadSample: {
      records: [
        {
          plantNo: 'ID001',
          plantName: 'PT. SGMW Motor Indonesia',
          plantNameC: 'Cikarang Factory',
          zvinno: 'MK3W74099RJ000002',
          zvrn: '',
          drnno: '',
          zsono: '20231213-E-1-002',
          zordtyp: 'MG_Order',
          planStart: '2026-10-20T08:00:00Z',
          planFinish: '2026-10-25T08:00:00Z',
          zdeleted: '0',
          zdeldate: '',
          zdeltime: '',
          isDeleted: '0',
        },
      ],
    },
  },

  'vehicle-basic-info': {
    id: 'vehicle-basic-info',
    name: 'MES_VehicleBasicInfo_Pub',
    title: '2. Vehicle Basic Info',
    description: 'Mengirimkan data spesifikasi kendaraan, BOM offline, dan feature configuration codes dari MES ke MuleSoft EAI.',
    eaiEndpoint: 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleBasicInfo_Pub',
    triggerCondition: 'Tersedia di mg_car_as_data (READ-ONLY)',
    brandFilter: "m.brand = 'MG' OR c.ExtItem9 = 'MG'",
    tables: [
      { name: '[dbo].[mg_car_as_data]', description: 'Data master perakitan mobil (DIBACA READ-ONLY tanpa merubah tabel eksisting).' },
      { name: '[dbo].[MES_Trace_Cars]', description: 'Informasi varian dan mapping CarVarietyCode.' },
      { name: '[BaseData].[dbo].[CarVarietyCode]', description: 'Master referensi nama ProjectName untuk materialNo.' },
      { name: '[dbo].[mg_featureconfig]', description: 'Daftar barcode konfigurasi fitur mobil (vehiclecode -> featurecode).' },
      { name: '[dbo].[MES_EAI_VehicleBasicInfo_Log]', description: 'Tabel log transmisi sekaligus pencatat TransmissionID unik per mobil.' },
    ],
    sqlQueries: [
      {
        label: 'Fetch Pending / Unsent Vehicles (mg_car_as_data READ-ONLY)',
        query: `SELECT TOP (@limit)
  'ID001'                            AS plantNo,
  'MG'                               AS normt,
  ISNULL(v.ProjectName, m.noproduct) AS materialNo,
  m.vin                              AS vin,
  ISNULL(m.pincode, '')              AS pn,
  ISNULL(m.bomversion, '')           AS bomversion,
  ISNULL(m.engineno, '')             AS engineNo,
  ISNULL(m.modelyear, '')            AS modelyear,
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
WHERE (m.brand = 'MG' OR c.ExtItem9 = 'MG')
  AND ISNULL(LTRIM(RTRIM(c.CarVarietyCode)), '') NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND LEFT(ISNULL(LTRIM(RTRIM(m.vsn_10)), ''), 4) NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND m.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND COALESCE(TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.handover_tpoint_date)), 1, 19) AS DATETIME), TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME), TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.createtime)), 1, 19) AS DATETIME)) >= TRY_CAST(@releaseStartDate AS DATETIME)
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
ORDER BY COALESCE(TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.handover_tpoint_date)), 1, 19) AS DATETIME), TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME), TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.createtime)), 1, 19) AS DATETIME)) DESC, m.Auto_ID DESC;`,
      },
      {
        label: 'Fetch Feature Configurations by VehicleCode',
        query: `SELECT DISTINCT featurecode
FROM [dbo].[mg_featureconfig] WITH (NOLOCK)
WHERE [vehiclecode] = @vehicleCode 
  AND [featurecode] IS NOT NULL 
  AND [featurecode] <> ''
ORDER BY [featurecode];`,
      },
    ],
    transformationRules: [
      'plantNo bernilai "ID001" (diubah dari "WH15").',
      'Hanya mengambil kendaraan MG asli (>= RELEASE_START_DATE, urutan terbaru DESC; mengecualikan Confero/Cortez/Wuling).',
      'Format ID Transmisi: yymmddxxxx (10 digit numerik, reset harian 0000-9999 di GMT+7).',
      'Field id pada record root dan seluruh item dalam array configs bernilai SAMA persis.',
      'Casing & Contract Property sesuai schema EAI VehicleBasicInfo_Pub.',
      'Konfigurasi fitur mobil dimapping ke array configs.',
    ],
    payloadSample: {
      records: [
        {
          id: 'xxx0001',
          plantNo: 'ID001',
          product: 'ZSC',
          modelyear: '2024',
          orderNo: null,
          orderType: null,
          orderStatus: null,
          prodFinishTime: null,
          drnno: null,
          normt: 'MG',
          materialNo: 'MMSL1D03XCLWSB',
          tps: null,
          vin: 'MK3WS4096TJ002196',
          engineNo: '15S4C2401001',
          checkoutNo14: null,
          checkoutNo15: null,
          checkoutDate: null,
          pn: '53158',
          vehicleStatus: null,
          gaTime: null,
          finishTime: '2026-07-31T17:07:17Z',
          bomversion: '20260130',
          testRepNo: null,
          productCode: null,
          zvrn: null,
          productType: null,
          vsn: null,
          assembleDesc: null,
          reservedField1: 'initial',
          tvv: null,
          vhcModel: 'ZSCC26',
          configs: [
            {
              id: 'xxx0001',
              featureId: '2',
              featureCode: '2025',
              orderNo: null,
              lastUpdateTime: null,
              orderType: null,
            },
            {
              id: 'xxx0001',
              featureId: '3',
              featureCode: '3G16',
              orderNo: null,
              lastUpdateTime: null,
              orderType: null,
            },
          ],
        },
      ],
    },
  },

  'vehicle-passing-point': {
    id: 'vehicle-passing-point',
    name: 'MES_VehiclePassingPoint_Pub',
    title: '3. Vehicle Passing Point',
    description: 'Mengirimkan timestamp handover / penyelesaian akhir mobil ke MuleSoft EAI setelah unit selesai di-scan handover.',
    eaiEndpoint: 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePassingPoint_Pub',
    triggerCondition: 'c.handover_tpoint_date IS NOT NULL AND c.handover_tpoint_date <> ""',
    brandFilter: "c.brand = 'MG' OR c.ExtItem9 = 'MG'",
    tables: [
      { name: '[dbo].[MES_Trace_Cars]', description: 'Tanggal dan jam scan handover (handover_tpoint_date).' },
      { name: '[dbo].[MES_MQ_Plan_GA]', description: 'Informasi nomor Manufacturing Order (moNum).' },
      { name: '[dbo].[MES_EAI_VehiclePassingPoint_Log]', description: 'Tabel log pengiriman passing point.' },
    ],
    sqlQueries: [
      {
        label: 'Fetch Pending / Unsent Passing Point Records',
        query: `SELECT TOP (@limit)
  'ID001'                                                              AS plantNo,
  b.plan_ID                                                            AS moNum,
  b.VIN                                                                AS vin,
  'GA'                                                                 AS ulocNo,
  CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.GAOnline_Tpoint_ExactDate, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                       AS arrivalTime,
  CONVERT(VARCHAR(19), TRY_CAST(SUBSTRING(c.handover_tpoint_date, 1, 19) AS DATETIME), 126) + 'Z' 
                                                                       AS leavingTime,
  '0'                                                                  AS isDeleted,
  c.handover_tpoint_date                                               AS raw_handover_date
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
WHERE (c.ExtItem9 = 'MG' OR m.brand = 'MG')
  AND ISNULL(LTRIM(RTRIM(c.CarVarietyCode)), '') NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND m.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
  AND c.handover_tpoint_date IS NOT NULL 
  AND c.handover_tpoint_date <> ''
  AND TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) >= TRY_CAST(@releaseStartDate AS DATETIME)
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
ORDER BY TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) DESC, c.Auto_ID DESC;`,
      },
    ],
    transformationRules: [
      'plantNo bernilai "ID001" (diubah dari "WH15").',
      'ulocNo bernilai default "GA".',
      'moNum diisi dengan plan_ID dari tabel [dbo].[MES_Plan_BodySequence].',
      'Trigger aktif jika unit telah memiliki nilai handover_tpoint_date (sudah di-scan handover) dan >= RELEASE_START_DATE.',
      'Format tanggal handover dikirimkan sesuai format string ISO 8601 (YYYY-MM-DDTHH:mm:ssZ).',
      'Hanya mengambil kendaraan MG asli (mengecualikan Confero/Cortez/Wuling) dengan urutan terbaru DESC.',
    ],
    payloadSample: {
      records: [
        {
          plantNo: 'ID001',
          moNum: 'MO202410001',
          vin: 'MK3W74099RJ000002',
          ulocNo: 'GA',
          arrivalTime: '2026-10-20T08:00:00Z',
          leavingTime: '2026-10-20T14:30:00Z',
          isDeleted: '0',
        },
      ],
    },
  },

  'vehicle-precise-traceability': {
    id: 'vehicle-precise-traceability',
    name: 'MES_VehiclePreciseTraceability_Pub',
    title: '4. Vehicle Precise Traceability',
    description: 'Mengirimkan seluruh barcode komponen kritis (keyparts) dari tabel penelusuran MES [MES_MQ_RecallItems] ke EAI saat mobil selesai di-scan handover.',
    eaiEndpoint: 'http://10.140.240.6:8888/http2dumpdb/MES_VehiclePreciseTraceability_Pub',
    triggerCondition: 'c.handover_tpoint_date IS NOT NULL (Scan MES Handover selesai)',
    brandFilter: "c.brand = 'MG' OR c.ExtItem9 = 'MG'",
    tables: [
      { name: '[dbo].[MES_MQ_RecallItems]', description: 'Tabel catatan penelusuran barcode komponen (VIN, BarCode, TItem, CreatedTime).' },
      { name: '[dbo].[MES_Trace_Cars]', description: 'Verifikasi status scan handover (handover_tpoint_date) dan brand MG.' },
      { name: '[dbo].[v_RecallItem_TItemMap]', description: 'View mapping relasi TItem (TItem1..TItem16) ke PartIdentifyCode & PartIdentifyName.' },
      { name: '[dbo].[MES_EAI_VehiclePreciseTraceability_Log]', description: 'Tabel log pengiriman penelusuran barcode komponen.' },
    ],
    sqlQueries: [
      {
        label: 'Fetch Pending VINs with Completed Handover Scan',
        query: `SELECT TOP (@limit)
  r.vin,
  c.handover_tpoint_date
FROM [dbo].[MES_MQ_RecallItems] r WITH (NOLOCK)
INNER JOIN [dbo].[MES_Trace_Cars] c WITH (NOLOCK) 
    ON r.VIN = c.vin
LEFT JOIN [dbo].[mg_car_as_data] m WITH (NOLOCK) 
    ON r.VIN = m.vin
LEFT JOIN [dbo].[MES_EAI_VehiclePreciseTraceability_Log] l WITH (NOLOCK) 
    ON r.VIN = l.VIN
WHERE (c.ExtItem9 = 'MG' OR m.brand = 'MG')
  AND ISNULL(LTRIM(RTRIM(c.CarVarietyCode)), '') NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND c.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND (c.handover_tpoint_date IS NOT NULL AND c.handover_tpoint_date <> '')
  AND TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) >= TRY_CAST(@releaseStartDate AS DATETIME)
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
ORDER BY TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) DESC, c.Auto_ID DESC;`,
      },
      {
        label: 'Fetch Collected Recall Part Barcodes by VIN',
        query: `SELECT 
  [BarCode],
  [TItem],
  CONVERT(VARCHAR(19), TRY_CAST([CreatedTime] AS DATETIME), 126) + 'Z' AS ScanTime
FROM [dbo].[MES_MQ_RecallItems] WITH (NOLOCK)
WHERE [VIN] = @vin
  AND [BarCode] IS NOT NULL 
  AND [BarCode] <> '';`,
      },
      {
        label: 'Dynamic TItem Mapping Lookup',
        query: `SELECT PartIdentifyCode, PartIdentifyName, TItem_Field, ItemSeq
FROM [dbo].[v_RecallItem_TItemMap] WITH (NOLOCK);`,
      },
    ],
    transformationRules: [
      'plantNo bernilai "ID001" (diubah dari "WH15").',
      'scanTime diformat otomatis ke standar ISO-8601 UTC (YYYY-MM-DDTHH:mm:ssZ), contoh: 2026-10-20T02:45:49Z.',
      'Trigger: Mengambil seluruh barcode suku cadang (keyparts) saat unit telah memiliki scan MES Handover.',
      'Mapping Part: Kolom TItem (contoh: TItem1) di-resolve via view v_RecallItem_TItemMap menjadi PartIdentifyCode dan PartIdentifyName.',
      'partNo wajib diisi (tidak boleh kosong atau "N/A"), diekstrak dari pola barcode suku cadang (contoh: 54458867).',
      'Jika unit tidak memiliki barcode komponen sama sekali, 1 baris dummy dengan keypartNo string kosong akan dikirimkan.',
    ],
    payloadSample: {
      records: [
        {
          isDeleted: '0',
          plantNo: 'ID001',
          vin: 'MMLEB49A0TG028983',
          keypartNo: '11740966471000000Y01CY5445886724D26616A00010335',
          scanTime: '2026-10-02T06:24:06Z',
          keypartType: '11740966',
          keypartTypeDescC: 'Driver front airbag (Horn)',
          vpps: null,
          partNo: '54458867',
          supplierNo: null,
          orignalLabel: null,
          subKeypartType: null,
          orderType: 'A',
        },
      ],
    },
  },
  'vehicle-offline-bom': {
    id: 'vehicle-offline-bom',
    name: 'MES_VehicleOfflineBOM_Pub',
    title: '5. Vehicle Offline BOM',
    description: 'Mengirimkan data struktur Bill of Materials (BOM) offline per VIN kendaraan dengan menggabungkan Vehicle Basic Info (bomversion, vehiclecode/materialNo, product, modelyear) dan master template ECU/ModuleId/PartNo berdasarkan model mobil.',
    eaiEndpoint: 'http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub',
    triggerCondition: 'Unit MG pada mg_car_as_data / MES_Trace_Cars cocok dengan model pada MES_Vehicle_OfflineBOM_ModelMap',
    brandFilter: 'Brand MG (Model: MGZS HEV COM/LUX, MGS5 EV COM/LUX 49kWh & 62kWh) • Plant ID001',
    tables: [
      { name: '[dbo].[MES_Vehicle_OfflineBOM_ModelMap]', description: 'Mapping model kendaraan (VehicleCodePrefix 11-digit & CarVarietyCode) ke ModelCode master BOM.' },
      { name: '[dbo].[MES_Vehicle_OfflineBOM_Master]', description: 'Master template BOM per model mobil (partno, ecuname, moduleid) dari data Excel.' },
      { name: '[dbo].[MES_Vehicle_OfflineBOM]', description: 'Data BOM hasil materialisasi per VIN + Vehicle Basic Info yang siap dikirim ke EAI.' },
      { name: '[dbo].[MES_EAI_VehicleOfflineBOM_Log]', description: 'Tabel audit log transmisi pengiriman BOM offline ke MuleSoft EAI.' },
    ],
    sqlQueries: [
      {
        label: 'Fetch Pending / Unsent Vehicle Offline BOM Records (Full BOM per VIN)',
        query: `SELECT
  b.Auto_ID AS recordId,
  COALESCE(NULLIF(LTRIM(RTRIM(m.m_bomversion)), ''), NULLIF(LTRIM(RTRIM(vc.vc_bomversion)), ''), NULLIF(LTRIM(RTRIM(b.bomversion)), ''), '') AS bomversion,
  'ID001' AS plantNo,
  ISNULL(NULLIF(LTRIM(RTRIM(b.plantName)), ''), 'PT. SGMW Motor Indonesia') AS plantName,
  ISNULL(NULLIF(LTRIM(RTRIM(b.plantNameC)), ''), 'Cikarang Factory') AS plantNameC,
  COALESCE(NULLIF(LTRIM(RTRIM(m.m_vehiclecode)), ''), NULLIF(LTRIM(RTRIM(vc.vc_vehiclecode)), ''), NULLIF(LTRIM(RTRIM(b.materialNo)), ''), '') AS materialNo,
  b.partno AS partno,
  COALESCE(NULLIF(LTRIM(RTRIM(m.m_noproduct)), ''), NULLIF(LTRIM(RTRIM(vc.vc_noproduct)), ''), NULLIF(LTRIM(RTRIM(b.product)), ''), '') AS product,
  COALESCE(NULLIF(LTRIM(RTRIM(m.m_modelyear)), ''), NULLIF(LTRIM(RTRIM(vc.vc_modelyear)), ''), NULLIF(LTRIM(RTRIM(b.modelyear)), ''), '') AS modelyear,
  b.ecuname AS ecuname,
  b.moduleid AS moduleid,
  b.vin AS vin,
  ISNULL(NULLIF(LTRIM(RTRIM(b.isDeleted)), ''), '0') AS isDeleted
FROM [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
OUTER APPLY (
  SELECT TOP 1 m1.bomversion AS m_bomversion, m1.vehiclecode AS m_vehiclecode, m1.noproduct AS m_noproduct, m1.modelyear AS m_modelyear, m1.vsn_10 AS m_vsn10
  FROM [dbo].[mg_car_as_data] m1 WITH (NOLOCK) WHERE b.vin IS NOT NULL AND m1.vin = b.vin
) m
OUTER APPLY (
  SELECT TOP 1 c1.vsn AS c_vsn
  FROM [dbo].[MES_Trace_Cars] c1 WITH (NOLOCK) WHERE b.vin IS NOT NULL AND c1.vin = b.vin
) c
OUTER APPLY (
  SELECT TOP 1 vc1.bomversion AS vc_bomversion, vc1.vehiclecode AS vc_vehiclecode, vc1.noproduct AS vc_noproduct, vc1.modelyear AS vc_modelyear
  FROM [BaseData].[dbo].[VehicleCode] vc1 WITH (NOLOCK)
  WHERE (b.vin IS NOT NULL AND vc1.vsn = LEFT(COALESCE(NULLIF(LTRIM(RTRIM(m.m_vsn10)), ''), NULLIF(LTRIM(RTRIM(c.c_vsn)), ''), ''), 10))
     OR (b.vin IS NULL AND vc1.vehiclecode = b.materialNo)
) vc
LEFT JOIN [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
  ON b.Auto_ID = l.BOMRecordID
WHERE (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < @maxRetry))
ORDER BY b.Auto_ID ASC;`,
      },
    ],
    transformationRules: [
      'plantNo selalu bernilai "ID001", plantName "PT. SGMW Motor Indonesia", plantNameC "Cikarang Factory".',
      'bomversion, materialNo (kode 14-digit vehiclecode), product, dan modelyear diambil dinamis dari Vehicle Basic Info (mg_car_as_data / MES_Trace_Cars + BaseData.dbo.VehicleCode).',
      'partno, ecuname, dan moduleid diambil dari master BOM (MES_Vehicle_OfflineBOM_Master) berdasarkan model mobil (MGZS HEV COM/LUX, MGS5 EV COM/LUX 49kWh & 62kWh).',
      'Field vin diisi per nomor VIN unit kendaraan hasil materialisasi.',
      'Pengiriman batch dikelompokkan per VIN (seluruh 116-131 baris BOM milik 1 unit mobil dikirim lengkap tanpa terpotong batas 50 baris).',
      'Format JSON root: { records: [...] } sesuai kontrak schema EAI VehicleOfflineBOM_Pub.',
    ],
    payloadSample: {
      records: [
        {
          bomversion: '20260130',
          plantNo: 'ID001',
          plantName: 'PT. SGMW Motor Indonesia',
          plantNameC: 'Cikarang Factory',
          materialNo: 'MMSL1C03VCLDML',
          partno: '12061654',
          product: 'ZS3',
          modelyear: '2025',
          ecuname: 'BMS',
          moduleid: '01',
          vin: 'MK3WS4098TJ000143',
          isDeleted: '0',
        },
      ],
    },
  },
};
