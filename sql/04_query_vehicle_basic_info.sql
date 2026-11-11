-- ============================================================================
-- Description: Query unsent Vehicle Basic Info records
-- Target DB:   PTSGMW_MES
-- Scope:       Brand MG Only (excludes Confero/Cortez/Wuling), >= Release Date, Latest First
-- NOTE:        mg_car_as_data is READ-ONLY. Unsent status is determined 
--              exclusively via [dbo].[MES_EAI_VehicleBasicInfo_Log].
-- ============================================================================

USE [PTSGMW_MES];
GO

SELECT TOP 50
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
  AND LEFT(ISNULL(LTRIM(RTRIM(c.vsn)), ''), 4) NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND ISNULL(c.ProjectName, '') NOT IN ('CN113R', 'CN210MR')
  AND ISNULL(v.ProjectName, '') NOT IN ('CN113R', 'CN210MR')
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Confero%'
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Cortez%'
  AND ISNULL(v.Type, '') NOT LIKE 'Confero%'
  AND ISNULL(v.Type, '') NOT LIKE 'Cortez%'
  AND m.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND COALESCE(
        TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.handover_tpoint_date)), 1, 19) AS DATETIME),
        TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME),
        TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.createtime)), 1, 19) AS DATETIME)
      ) >= '2026-11-10'
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < 3))
  AND EXISTS (
      SELECT 1 
      FROM [dbo].[mg_featureconfig] f WITH (NOLOCK) 
      WHERE f.vehiclecode = m.vehiclecode 
        AND f.featurecode IS NOT NULL 
        AND f.featurecode <> ''
  )
ORDER BY COALESCE(
           TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.handover_tpoint_date)), 1, 19) AS DATETIME),
           TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME),
           TRY_CAST(SUBSTRING(LTRIM(RTRIM(m.createtime)), 1, 19) AS DATETIME)
         ) DESC,
         m.Auto_ID DESC;
GO
