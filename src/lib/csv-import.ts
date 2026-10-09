import type { Data } from "./types";
/** RFC 4180 rows, including quoted commas/newlines and escaped quotes. */
export function parseCSV(input: string): Data[] {
  const text = input.replace(/^\uFEFF/, "");
  if (text.length > 120000) throw new Error("CSV must be smaller than 120 KB");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = rows.shift()?.map((v) => v.trim());
  if (
    !headers ||
    !["name", "email", "title", "startDate"].every((k) => headers.includes(k))
  )
    throw new Error("CSV needs name, email, title and startDate columns");
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV column names must be unique");
  if (rows.length > 100)
    throw new Error("Import up to 100 employees at a time");
  return rows.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of columns`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j].trim()]));
  });
}
