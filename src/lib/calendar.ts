import { fail } from "./errors";
/** Import explicit events only. Recurrence needs exported individual occurrences. */
export function parseCalendar(text: string, defaultTimezone: string) {
  if (text.length > 1000000 || !text.includes("BEGIN:VCALENDAR"))
    fail("Choose a calendar ICS export (maximum 1 MB)");
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/),
    events: {
      uid: string;
      title: string;
      start: string;
      end: string | null;
      notes: string;
      attendees: string;
    }[] = [];
  let event: { name: string; params: string; value: string }[] | null = null;
  const unescape = (s: string) =>
    s.replace(/\\[nN]/g, "\n").replace(/\\([,;\\])/g, "$1");
  const date = (value: string, params: string) => {
    if (!/^\d{8}(T\d{6}Z?)?$/.test(value)) fail("Unsupported calendar date");
    const parts = [
      value.slice(0, 4),
      value.slice(4, 6),
      value.slice(6, 8),
      value.slice(9, 11) || "00",
      value.slice(11, 13) || "00",
      value.slice(13, 15) || "00",
    ].map(Number);
    const at = Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
    );
    if (value.endsWith("Z") || value.length === 8)
      return new Date(at).toISOString();
    const zone =
      /TZID=([^;:]+)/.exec(params)?.[1].replace(/^"|"$/g, "") ||
      defaultTimezone;
    let instant = at;
    try {
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
      for (let i = 0; i < 3; i++) {
        const p = Object.fromEntries(
          fmt.formatToParts(new Date(instant)).map((v) => [v.type, v.value]),
        );
        const shown = Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour),
          Number(p.minute),
          Number(p.second),
        );
        if (shown === at) return new Date(instant).toISOString();
        instant += at - shown;
      }
    } catch {
      fail("Unsupported calendar timezone");
    }
    fail("Calendar time does not exist in this timezone; export UTC times");
  };
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      if (event) fail("Invalid calendar event");
      event = [];
      continue;
    }
    if (line === "END:VEVENT" && event) {
      const first = (name: string) => event!.find((p) => p.name === name);
      if (first("RRULE") || first("RECURRENCE-ID"))
        fail(
          "Export individual occurrences before importing a recurring calendar",
        );
      const start = first("DTSTART");
      if (!start) fail("Calendar event is missing its start");
      const end = first("DTEND"),
        startsAt = date(start.value, start.params),
        endsAt = end ? date(end.value, end.params) : null;
      if (endsAt && endsAt <= startsAt)
        fail("Calendar event must end after its start");
      events.push({
        uid:
          first("UID")?.value ||
          startsAt + ":" + (first("SUMMARY")?.value || "Meeting"),
        title: unescape(first("SUMMARY")?.value || "Meeting"),
        start: startsAt,
        end: endsAt,
        notes: unescape(first("DESCRIPTION")?.value || ""),
        attendees: event
          .filter((p) => p.name === "ATTENDEE")
          .map((p) => p.value.replace(/^mailto:/i, ""))
          .join(", "),
      });
      event = null;
      continue;
    }
    if (event) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      event.push({
        name,
        params: params.join(";"),
        value: line.slice(colon + 1),
      });
    }
  }
  if (event || !events.length || events.length > 100)
    fail("Import 1–100 complete calendar events at a time");
  return events;
}
