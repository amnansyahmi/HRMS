"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  dashboardWidgets,
  parseHiddenWidgets,
  type DashboardWidget,
} from "@/lib/dashboard";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { SlidersHorizontal, RotateCcw } from "lucide-react";

const preferenceEvent = "nonymauz-dashboard-preferences";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(preferenceEvent, callback);
  };
}
const serverSnapshot = () => null;
export function useDashboardWidgets(companyId: string, userId: string) {
  const key = `nonymauz:dashboard:v1:${companyId}:${userId}`;
  const [fallback, setFallback] = useState<DashboardWidget[]>([]);
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const saved = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const hidden = saved === null ? fallback : parseHiddenWidgets(saved);
  const update = (value: DashboardWidget[]) => {
    setFallback(value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new Event(preferenceEvent));
    } catch {
      /* Keep the current session usable when browser storage is disabled. */
    }
  };
  return { hidden, update };
}
export function DashboardPreferences({
  hidden,
  update,
  hasEmployee,
}: {
  hidden: DashboardWidget[];
  update: (hidden: DashboardWidget[]) => void;
  hasEmployee: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal size={16} />
        Widgets
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dashboard-preferences">
          <DialogHeader>
            <DialogTitle>Your dashboard</DialogTitle>
            <DialogDescription>
              Choose the widgets you want to see. Saved for your account on this
              browser.
            </DialogDescription>
          </DialogHeader>
          <div className="widget-options">
            {dashboardWidgets
              .filter((w) => w.id !== "workday" || hasEmployee)
              .map((w) => (
                <label key={w.id}>
                  <Checkbox
                    checked={!hidden.includes(w.id)}
                    onCheckedChange={(checked) =>
                      update(
                        checked
                          ? hidden.filter((id) => id !== w.id)
                          : [...hidden, w.id],
                      )
                    }
                  />
                  <span>
                    <strong>{w.label}</strong>
                    <small>{w.detail}</small>
                  </span>
                </label>
              ))}
          </div>
          <div className="widget-preferences-footer">
            <Button variant="ghost" onClick={() => update([])}>
              <RotateCcw size={16} />
              Reset widgets
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
