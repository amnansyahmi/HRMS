"use client";
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react";
import { Download, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
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
  async function installApp() {
    if (prompt) {
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        setHelp(true);
      } finally {
        setPrompt(null);
      }
    } else setHelp(true);
  }
  const onInstallRequested = useEffectEvent(installApp);
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
    const requestInstall = () => {
      void onInstallRequested();
    };
    window.addEventListener("nonymauz-install", requestInstall);
    document.addEventListener("gesturestart", gesture, { passive: false });
    document.addEventListener("gesturechange", gesture, { passive: false });
    document.addEventListener("touchmove", touch, { passive: false });
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("nonymauz-install", requestInstall);
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
        <Button variant="ghost" size="sm" onClick={installApp}>
          <Download size={15} />
          Install app
        </Button>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Nonymauz People</DialogTitle>
            <DialogDescription>
              Keep your workspace on your home screen.
            </DialogDescription>
          </DialogHeader>
          <div className="install-instructions">
            <p>
              <strong>iPhone or iPad</strong>Open the browser’s Share menu, then
              choose Add to Home Screen.
            </p>
            <p>
              <strong>Android</strong>Open the browser menu, then choose Install
              app or Add to Home Screen.
            </p>
          </div>
        </DialogContent>
      </Dialog>
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
