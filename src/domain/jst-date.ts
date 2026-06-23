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
