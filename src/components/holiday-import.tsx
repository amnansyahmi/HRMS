"use client";
import { useState } from "react";
import {
  holidayPreset,
  holidaysForState,
  parseHolidayCSV,
  type HolidayRow,
} from "@/lib/holidays";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useWorkspace } from "./workspace-context";
import { toast } from "sonner";
export function HolidayImport() {
  const { act } = useWorkspace();
  const [open, setOpen] = useState(false),
    [state, setState] = useState("Kuala Lumpur"),
    [rows, setRows] = useState<HolidayRow[]>([]),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  function preview(next: HolidayRow[]) {
    setRows(next);
    setReviewed(false);
    setOpen(true);
  }
  function change(index: number, key: keyof HolidayRow, value: string) {
    setReviewed(false);
    setRows((all) =>
      all.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  return (
    <>
      <div className="toolbar-actions mb-4 flex-wrap">
        <select
          aria-label="Holiday state"
          className="native-select"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          {holidayPreset.states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => preview(holidaysForState(state))}
        >
          Preview 2026 holidays
        </Button>
        <Button variant="outline" asChild>
          <label>
            Import holiday CSV
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  preview(parseHolidayCSV(await file.text()));
                } catch (error) {
                  toast.error((error as Error).message);
                }
                e.target.value = "";
              }}
            />
          </label>
        </Button>
        <a
          className="inline-link"
          download="holiday-template.csv"
          href="data:text/csv;charset=utf-8,title%2Cdate%2Cstate%0ACompany%20holiday%2C2026-12-31%2CNational%0A"
        >
          CSV template
        </a>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="record-dialog">
          <DialogHeader>
            <DialogTitle>Review holidays before importing</DialogTitle>
            <DialogDescription>
              Check the dates and state coverage. Existing matching holidays are
              skipped.
            </DialogDescription>
          </DialogHeader>
          <p className="muted-text">
            The 2026 preset is a snapshot of the published Cabinet schedule.
            Review supplementary gazettes, substitute holidays and your
            company’s rest days. Add or correct those dates below.
          </p>
          <a
            className="inline-link"
            href={holidayPreset.source}
            target="_blank"
            rel="noreferrer"
          >
            Published source schedule
          </a>
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div
                key={i}
                className="rounded-xl border p-3 grid gap-2 sm:grid-cols-2"
              >
                <Input
                  aria-label={`Holiday ${i + 1} title`}
                  value={row.title}
                  onChange={(e) => change(i, "title", e.target.value)}
                />
                <Input
                  aria-label={`Holiday ${i + 1} date`}
                  type="date"
                  value={row.date}
                  onChange={(e) => change(i, "date", e.target.value)}
                />
                <select
                  className="native-select"
                  aria-label={`Holiday ${i + 1} state`}
                  value={row.state}
                  onChange={(e) => change(i, "state", e.target.value)}
                >
                  {["National", ...holidayPreset.states].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReviewed(false);
                    setRows(rows.filter((_, j) => i !== j));
                  }}
                >
                  Remove date
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={rows.length >= 100}
            onClick={() => {
              setReviewed(false);
              setRows([...rows, { title: "", date: "", state }]);
            }}
          >
            Add date
          </Button>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I have reviewed dates, state coverage and applicable substitute
            holidays.
          </label>
          <Button
            disabled={!reviewed || !rows.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = (await act("holidays-import", {
                  data: { rows, reviewed },
                })) as { created: number; skipped: number } | undefined;
                if (result) {
                  toast.success(
                    `${result.created} holidays imported; ${result.skipped} duplicates skipped`,
                  );
                  setOpen(false);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {rows.length} holidays
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
