/**
 * Shared SQL filter helpers for MG-only vehicle validation and release-date cutoff.
 */

export interface MgFilterAliases {
  traceAlias?: string;
  mgAlias?: string;
  varietyAlias?: string;
}

const EXCLUDED_VARIETY_CODES = `'C81C', '0000', '0529', '2220', '2221', '2222', '2223'`;
const EXCLUDED_PROJECT_NAMES = `'CN113R', 'CN210MR'`;

/**
 * Membangun klausa WHERE SQL untuk memastikan hanya unit MG asli yang lolos
 * (mengecualikan data uji Wuling Confero/Cortez yang ter-flag ExtItem9/brand='MG').
 */
export function buildStrictMgWhereSql(aliases: MgFilterAliases): string {
  const { traceAlias: c, mgAlias: m, varietyAlias: v } = aliases;
  const parts: string[] = [];

  if (c && m) {
    parts.push(`(${c}.ExtItem9 = 'MG' OR ${m}.brand = 'MG')`);
  } else if (c) {
    parts.push(`${c}.ExtItem9 = 'MG'`);
  } else if (m) {
    parts.push(`${m}.brand = 'MG'`);
  }

  if (c) {
    parts.push(`ISNULL(LTRIM(RTRIM(${c}.CarVarietyCode)), '') NOT IN (${EXCLUDED_VARIETY_CODES})`);
    parts.push(`LEFT(ISNULL(LTRIM(RTRIM(${c}.vsn)), ''), 4) NOT IN (${EXCLUDED_VARIETY_CODES})`);
    parts.push(`ISNULL(${c}.ProjectName, '') NOT IN (${EXCLUDED_PROJECT_NAMES})`);
    parts.push(`ISNULL(${c}.ExtItem6, '') NOT LIKE 'Confero%'`);
    parts.push(`ISNULL(${c}.ExtItem6, '') NOT LIKE 'Cortez%'`);
    parts.push(`${c}.vin NOT LIKE 'MK[3-6][AB]AA%'`);
  }

  if (m) {
    parts.push(`LEFT(ISNULL(LTRIM(RTRIM(${m}.vsn_10)), ''), 4) NOT IN (${EXCLUDED_VARIETY_CODES})`);
    parts.push(`${m}.vin NOT LIKE 'MK[3-6][AB]AA%'`);
  }

  if (v) {
    parts.push(`ISNULL(${v}.ProjectName, '') NOT IN (${EXCLUDED_PROJECT_NAMES})`);
    parts.push(`ISNULL(${v}.Type, '') NOT LIKE 'Confero%'`);
    parts.push(`ISNULL(${v}.Type, '') NOT LIKE 'Cortez%'`);
  }

  return parts.join('\n        AND ');
}

/**
 * Membangun ekspresi SQL DATETIME yang aman dari kolom tanggal bertipe VARCHAR/CHAR.
 */
export function buildReleaseDateExpr(dateColumns: string[]): string {
  const casted = dateColumns.map(
    (col) => `TRY_CAST(SUBSTRING(LTRIM(RTRIM(${col})), 1, 19) AS DATETIME)`
  );
  return casted.length === 1 ? casted[0] : `COALESCE(${casted.join(', ')})`;
}

/**
 * Membangun klausa WHERE SQL agar hanya data terbaru per release (>= @releaseStartDate) yang diproses.
 */
export function buildReleaseDateFilterSql(
  dateColumns: string[],
  paramName: string = 'releaseStartDate'
): string {
  return `${buildReleaseDateExpr(dateColumns)} >= TRY_CAST(@${paramName} AS DATETIME)`;
}

