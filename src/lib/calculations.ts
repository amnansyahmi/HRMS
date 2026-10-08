export function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}
export function payrollTotals(input: Record<string, unknown>) {
  const sum = (keys: string[]) =>
    keys.reduce((n, key) => n + cents(Number(input[key] || 0)), 0);
  const gross = sum(["base", "allowance", "overtime", "bonus", "commission"]);
  const deductions = sum([
    "epfEmployee",
    "socsoEmployee",
    "eisEmployee",
    "pcb",
    "otherDeduction",
    "unpaidDeduction",
    "zakat",
  ]);
  if (deductions > gross) throw new Error("Deductions cannot exceed gross pay");
  return {
    gross: gross / 100,
    net: (gross - deductions + sum(["reimbursements"])) / 100,
  };
}
export function workingDays(
  start: string,
  end: string,
  workDays: number[],
  holidays: string[],
) {
  const first = new Date(start + "T00:00:00Z"),
    last = new Date(end + "T00:00:00Z");
  if (last < first || last.getTime() - first.getTime() > 365 * 86400000)
    throw new Error("Leave must cover no more than one year");
  let days = 0;
  for (let d = first; d <= last; d = new Date(d.getTime() + 86400000))
    if (
      workDays.includes(d.getUTCDay()) &&
      !holidays.includes(d.toISOString().slice(0, 10))
    )
      days++;
  return days;
}
export function localDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function localMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value)
  );
}
/** Match an occurrence using the company's local calendar, including after midnight. */
export function assignedShift(
  now: Date,
  timezone: string,
  shifts: { id: string; data: Record<string, unknown> }[],
) {
  const date = localDate(now, timezone);
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const minute = localMinutes(now, timezone);
  const previous = new Date(new Date(date + "T00:00:00Z").getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const minutes = (value: unknown) => {
    const [h, m] = String(value).split(":").map(Number);
    return h * 60 + m;
  };
  const occurrences = shifts.flatMap((shift) => {
    const start = minutes(shift.data.start),
      end = minutes(shift.data.end);
    const days = shift.data.days as number[];
    const matches = [];
    if (days.includes(weekday) && shiftOccurs(shift.data, date))
      matches.push({ shift, date, offset: minute - start });
    if (
      end < start &&
      minute <= end &&
      days.includes((weekday + 6) % 7) &&
      shiftOccurs(shift.data, previous)
    )
      matches.push({ shift, date: previous, offset: minute + 1440 - start });
    return matches;
  });
  const match = occurrences.sort(
    (a, b) => Math.abs(a.offset) - Math.abs(b.offset),
  )[0];
  return match
    ? {
        id: match.shift.id,
        workDate: match.date,
        lateMinutes: Math.max(
          0,
          match.offset - Number(match.shift.data.graceMinutes),
        ),
      }
    : null;
}
export function csv(rows: (string | number | null | undefined)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? "");
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}

export function shiftOccurs(data: Record<string, unknown>, date: string) {
  if (data.endDate && date > String(data.endDate)) return false;
  const anchor = data.anchorDate ? String(data.anchorDate) : null;
  if (!anchor) return true;
  if (date < anchor) return false;
  const weeks = Math.floor((Date.parse(date) - Date.parse(anchor)) / 604800000),
    rotation = Number(data.rotationWeeks || 1);
  return ((data.activeWeeks as number[]) || [1]).includes(
    (weeks % rotation) + 1,
  );
}
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (v: number) => (v * Math.PI) / 180,
    lat = rad(b.latitude - a.latitude),
    lon = rad(b.longitude - a.longitude),
    h =
      Math.sin(lat / 2) ** 2 +
      Math.cos(rad(a.latitude)) *
        Math.cos(rad(b.latitude)) *
        Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
