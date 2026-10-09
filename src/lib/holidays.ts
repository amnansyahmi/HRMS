import preset from "./data/malaysia-holidays-2026.json";
import { parseCSV } from "./csv-import";
export const holidayPreset = preset;
export type HolidayRow = { title: string; date: string; state: string };
export function holidaysForState(state: string): HolidayRow[] {
  if (!preset.states.includes(state))
    throw new Error("Choose a Malaysian state or federal territory");
  return preset.holidays
    .filter((row) => row.states.includes(state))
    .map((row) => ({ title: row.title, date: row.date, state }));
}
export function parseHolidayCSV(text: string): HolidayRow[] {
  return parseCSV(text, ["title", "date", "state"]).map((row) => ({
    title: String(row.title),
    date: String(row.date),
    state: String(row.state),
  }));
}
