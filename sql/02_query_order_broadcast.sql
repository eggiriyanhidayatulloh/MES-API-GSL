-- ============================================================================
-- Description: Query unsent / failed order broadcast records for EAI push
-- Target DB:   PTSGMW_MES
-- Scope:       Brand MG Only (excludes Confero/Cortez/Wuling), >= Release Date, Latest First
-- ============================================================================

USE [PTSGMW_MES];
GO

SELECT TOP 50
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
  AND LEFT(ISNULL(LTRIM(RTRIM(c.vsn)), ''), 4) NOT IN ('C81C', '0000', '0529', '2220', '2221', '2222', '2223')
  AND ISNULL(c.ProjectName, '') NOT IN ('CN113R', 'CN210MR')
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Confero%'
  AND ISNULL(c.ExtItem6, '') NOT LIKE 'Cortez%'
  AND c.vin NOT LIKE 'MK[3-6][AB]AA%'
  AND c.GAOnline_Tpoint_ExactDate IS NOT NULL 
  AND c.GAOnline_Tpoint_ExactDate <> ''
  AND TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.GAOnline_Tpoint_ExactDate)), 1, 19) AS DATETIME) >= '2026-11-10'
  AND (l.Status IS NULL OR (l.Status = 'FAILED' AND l.RetryCount < 3))
ORDER BY TRY_CAST(SUBSTRING(LTRIM(RTRIM(c.GAOnline_Tpoint_ExactDate)), 1, 19) AS DATETIME) DESC, c.Auto_ID DESC;
GO
