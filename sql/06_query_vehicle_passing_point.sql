-- ============================================================================
-- Description: Query unsent Vehicle Passing Point records
-- Target DB:   PTSGMW_MES
-- Scope:       Brand MG Only (excludes Confero/Cortez/Wuling), >= Release Date, Latest First
-- ============================================================================

USE [PTSGMW_MES];
GO

SELECT TOP 50
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
WHERE (c.ExtItem9 = 'MG' OR m.brand = 'MG')
  AND ISNULL(LTRIM(RTRIM(c.CarVarietyCode)), '') NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND LEFT(ISNULL(LTRIM(RTRIM(m.vsn_10)), ''), 4) NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND LEFT(ISNULL(LTRIM(RTRIM(c.vsn)), ''), 4) NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND ISNULL(c.ProjectName, '') NOT IN ('CN113R', 'CN210MR')
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Confero%'
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Cortez%'
  AND m.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
  AND c.handover_tpoint_date IS NOT NULL 
  AND c.handover_tpoint_date <> ''
  AND TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) >= '2026-11-10'
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < 3))
ORDER BY TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.handover_tpoint_date)), 1, 19) AS DATETIME) DESC, c.Auto_ID DESC;
GO
