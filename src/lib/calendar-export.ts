import { addCalendarDays, type CalendarEvent } from "./hr-calendar";
import { fail } from "./errors";

function utc(date: string, time: string, zone: string) {
  if (time === "24:00") {
    date = addCalendarDays(date, 1);
    time = "00:00";
  }
  const local = Date.parse(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = local;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const shown = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    if (shown === local)
      return new Date(instant)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    instant += local - shown;
  }
  fail(
    "A scheduled time does not exist in the company timezone. Review that occurrence before exporting.",
  );
}
function escape(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
function fold(line: string) {
  const segments: string[] = [];
  let part = "",
    bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      segments.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += size;
  }
  segments.push(part);
  return segments.join("\r\n");
}
/** Only approved absences and scheduled shifts/holidays are exported; private request contents are omitted. */
export function exportCalendar(
  events: CalendarEvent[],
  timezone: string,
  now = new Date(),
) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nonymauz//People//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of events.filter((e) => e.status !== "Pending")) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escape(event.id)}@nonymauz-people`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escape(event.title)}`,
      "CLASS:PRIVATE",
      "TRANSP:TRANSPARENT",
    );
    if (event.start && event.end)
      lines.push(
        `DTSTART:${utc(event.date, event.start, timezone)}`,
        `DTEND:${utc(event.overnight ? addCalendarDays(event.date, 1) : event.date, event.end, timezone)}`,
      );
    else
      lines.push(
        `DTSTART;VALUE=DATE:${event.date.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${addCalendarDays(event.date, 1).replaceAll("-", "")}`,
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
