"use client";
import { useEffect } from "react";

export const beforeNavigate = "nonymauz-before-navigate";
export function canLeaveWorkspace() {
  return window.dispatchEvent(new Event(beforeNavigate, { cancelable: true }));
}
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: Event) => {
      if (!window.confirm("Discard your unsaved changes?"))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(beforeNavigate, navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(beforeNavigate, navigate);
    };
  }, [dirty]);
}
