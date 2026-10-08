"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function PhoneApp() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null),
    [help, setHelp] = useState(false);
  useEffect(() => {
    const install = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const gesture = (event: Event) => event.preventDefault();
    const touch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };

    window.addEventListener("beforeinstallprompt", install);
    document.addEventListener("gesturestart", gesture, { passive: false });
    document.addEventListener("gesturechange", gesture, { passive: false });
    document.addEventListener("touchmove", touch, { passive: false });
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", install);
      document.removeEventListener("gesturestart", gesture);
      document.removeEventListener("gesturechange", gesture);
      document.removeEventListener("touchmove", touch);
    };
  }, []);
  return (
    <>
      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff size={16} />
          Offline. Reconnect before submitting.
        </div>
      )}
      <div className="phone-install">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (prompt) {
              await prompt.prompt();
              await prompt.userChoice;
              setPrompt(null);
            } else setHelp(!help);
          }}
        >
          <Download size={15} />
          Install app
        </Button>
        {help && (
          <p>
            iPhone: Share → Add to Home Screen.
            <br />
            Android: browser menu → Install app.
          </p>
        )}
      </div>
    </>
  );
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
