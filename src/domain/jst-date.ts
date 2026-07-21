const JST_TIMEZONE = "Asia/Tokyo";

export const getJstDateParts = (now = new Date()): { day: string; hour: number } => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: JST_TIMEZONE,
      hour: "numeric",
      hour12: false
    }).format(now)
  );
  return { day, hour: Number.isFinite(hour) ? hour : 0 };
};

export const getJstWeekday = (now = new Date()): number => {
  const weekDayName = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIMEZONE,
    weekday: "short"
  }).format(now);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return weekdayMap[weekDayName] ?? 0;
};

export const isWeekdayInJst = (now = new Date()): boolean => {
  const weekday = getJstWeekday(now);
  return weekday !== 0 && weekday !== 6;
};

const EN_CA_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidJstDateString = (value: string): boolean => {
  if (!EN_CA_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const addJstDays = (dateStr: string, days: number): string => {
  if (!isValidJstDateString(dateStr)) return dateStr;
  const [year, month, day] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
