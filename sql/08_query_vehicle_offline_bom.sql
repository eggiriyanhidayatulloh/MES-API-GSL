-- ============================================================================
-- Description: Query unsent Vehicle Offline BOM records for MuleSoft EAI
-- Target DB:   PTSGMW_MES
-- Interface:   MES_VehicleOfflineBOM_Pub
-- Endpoint:    http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub
-- Notes:       bomversion, materialNo (14-digit vehiclecode), product, and modelyear
--              are resolved dynamically from Vehicle Basic Info (mg_car_as_data /
--              MES_Trace_Cars + BaseData.dbo.VehicleCode), factory code = 'ID001',
--              while partno, ecuname, and moduleid come from the model BOM master.
--              Batching runs per VIN (up to 50 VINs per cycle) sending ALL BOM rows
--              belonging to each unit without truncating at 50 rows.
-- ============================================================================

USE [PTSGMW_MES];
GO

SELECT
    b.Auto_ID AS recordId,
    COALESCE(
        NULLIF(LTRIM(RTRIM(m.m_bomversion)), ''),
        NULLIF(LTRIM(RTRIM(vc.vc_bomversion)), ''),
        NULLIF(LTRIM(RTRIM(b.bomversion)), ''),
        ''
    ) AS bomversion,
    'ID001' AS plantNo,
    ISNULL(NULLIF(LTRIM(RTRIM(b.plantName)), ''), 'PT. SGMW Motor Indonesia') AS plantName,
    ISNULL(NULLIF(LTRIM(RTRIM(b.plantNameC)), ''), 'Cikarang Factory') AS plantNameC,
    COALESCE(
        NULLIF(LTRIM(RTRIM(m.m_vehiclecode)), ''),
        NULLIF(LTRIM(RTRIM(vc.vc_vehiclecode)), ''),
        NULLIF(LTRIM(RTRIM(b.materialNo)), ''),
        ''
    ) AS materialNo,
    b.partno AS partno,
    COALESCE(
        NULLIF(LTRIM(RTRIM(m.m_noproduct)), ''),
        NULLIF(LTRIM(RTRIM(vc.vc_noproduct)), ''),
        NULLIF(LTRIM(RTRIM(b.product)), ''),
        ''
    ) AS product,
    COALESCE(
        NULLIF(LTRIM(RTRIM(m.m_modelyear)), ''),
        NULLIF(LTRIM(RTRIM(vc.vc_modelyear)), ''),
        NULLIF(LTRIM(RTRIM(b.modelyear)), ''),
        ''
    ) AS modelyear,
    b.ecuname AS ecuname,
    b.moduleid AS moduleid,
    b.vin AS vin,
    ISNULL(NULLIF(LTRIM(RTRIM(b.isDeleted)), ''), '0') AS isDeleted
FROM [dbo].[MES_Vehicle_OfflineBOM] b WITH (NOLOCK)
OUTER APPLY (
    SELECT TOP 1
        m1.bomversion AS m_bomversion,
        m1.vehiclecode AS m_vehiclecode,
        m1.noproduct AS m_noproduct,
        m1.modelyear AS m_modelyear,
        m1.vsn_10 AS m_vsn10
    FROM [dbo].[mg_car_as_data] m1 WITH (NOLOCK)
    WHERE b.vin IS NOT NULL AND m1.vin = b.vin
) m
OUTER APPLY (
    SELECT TOP 1 c1.vsn AS c_vsn
    FROM [dbo].[MES_Trace_Cars] c1 WITH (NOLOCK)
    WHERE b.vin IS NOT NULL AND c1.vin = b.vin
) c
OUTER APPLY (
    SELECT TOP 1
        vc1.bomversion AS vc_bomversion,
        vc1.vehiclecode AS vc_vehiclecode,
        vc1.noproduct AS vc_noproduct,
        vc1.modelyear AS vc_modelyear
    FROM [BaseData].[dbo].[VehicleCode] vc1 WITH (NOLOCK)
    WHERE (
        b.vin IS NOT NULL
        AND vc1.vsn = LEFT(COALESCE(NULLIF(LTRIM(RTRIM(m.m_vsn10)), ''), NULLIF(LTRIM(RTRIM(c.c_vsn)), ''), ''), 10)
    ) OR (
        b.vin IS NULL
        AND vc1.vehiclecode = b.materialNo
    )
) vc
LEFT JOIN [dbo].[MES_EAI_VehicleOfflineBOM_Log] l WITH (NOLOCK)
    ON b.Auto_ID = l.BOMRecordID
WHERE (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < 3))
ORDER BY b.Auto_ID ASC;
GO
