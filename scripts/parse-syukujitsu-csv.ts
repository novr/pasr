export type JpHolidaysJson = {
  source: "cao_syukujitsu";
  generatedAt: string;
  coverage: { from: string; to: string };
  dates: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const toIsoDateFromSyukujitsu = (raw: string): string | null => {
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return ISO_DATE.test(iso) ? iso : null;
};

export const decodeSyukujitsuCsv = (buffer: Buffer): string => new TextDecoder("shift_jis").decode(buffer);

export const parseSyukujitsuCsvDates = (csvText: string): string[] => {
  const dates = new Set<string>();
  for (const line of csvText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("国民の祝日")) continue;
    const [dateColumn] = trimmed.split(",");
    if (!dateColumn) continue;
    const iso = toIsoDateFromSyukujitsu(dateColumn);
    if (iso) dates.add(iso);
  }
  return [...dates].sort();
};

const coverageEndYear = (dates: string[], referenceYear: number): number => {
  const targetEndYear = referenceYear + 2;
  const yearsWithDates = new Set(dates.map((date) => Number(date.slice(0, 4))));
  let endYear = targetEndYear;
  while (endYear > referenceYear && !yearsWithDates.has(endYear)) {
    endYear -= 1;
  }
  return endYear;
};

export const buildJpHolidaysJson = (allDates: string[], referenceYear: number): JpHolidaysJson => {
  const from = `${referenceYear}-01-01`;
  const targetTo = `${referenceYear + 2}-12-31`;
  const dates = allDates.filter((date) => date >= from && date <= targetTo).sort();
  const to = `${coverageEndYear(dates, referenceYear)}-12-31`;
  return {
    source: "cao_syukujitsu",
    generatedAt: new Date().toISOString(),
    coverage: { from, to },
    dates
  };
};

export const parseSyukujitsuCsvBuffer = (buffer: Buffer, referenceYear: number): JpHolidaysJson => {
  const csvText = decodeSyukujitsuCsv(buffer);
  const allDates = parseSyukujitsuCsvDates(csvText);
  return buildJpHolidaysJson(allDates, referenceYear);
};
