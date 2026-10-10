"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export function AttendanceCamera({
  action,
  onClose,
  onConfirm,
}: {
  action: "in" | "out";
  onClose: () => void;
  onConfirm: (photo: {
    photoId: string;
    capturedAt: string;
  }) => Promise<unknown>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    cameraStream = useRef<MediaStream | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      stream: MediaStream | undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => {
        if (active)
          setError(
            "This browser does not support camera capture. Use a supported browser over HTTPS.",
          );
      });
      return () => {
        active = false;
      };
    }
    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 800 },
        },
        audio: false,
      })
      .then((value) => {
        if (!active) {
          value.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = value;
        cameraStream.current = value;
        if (video.current) video.current.srcObject = value;
      })
      .catch(() => {
        if (active)
          setError(
            "Camera access is unavailable. Allow camera access in your browser, then retry.",
          );
      });
    return () => {
      active = false;
      stream?.getTracks().forEach((t) => t.stop());
      if (cameraStream.current === stream) cameraStream.current = null;
    };
  }, [retry]);
  async function capture() {
    if (!video.current || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas"),
        source = video.current;
      canvas.width = Math.min(640, source.videoWidth);
      canvas.height = Math.round(
        (source.videoHeight * canvas.width) / source.videoWidth,
      );
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Camera capture failed. Please retry.");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const capturedAt = new Date().toISOString();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Camera capture failed.")),
          "image/jpeg",
          0.65,
        ),
      );
      if (blob.size > 512000)
        throw new Error("Photo is too large. Please retry.");
      const form = new FormData();
      form.append(
        "file",
        new File([blob], "attendance.jpg", { type: "image/jpeg" }),
      );
      const uploaded = await api<{ id: string }>("/api/files", form);
      if (await onConfirm({ photoId: uploaded.id, capturedAt })) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="attendance-camera">
        <DialogHeader>
          <DialogTitle>Clock {action} with a photo</DialogTitle>
          <DialogDescription>
            Frame your face, then capture. Your workplace stores this photo
            privately as attendance evidence. The server records the official
            time.
          </DialogDescription>
        </DialogHeader>
        <video
          ref={(node) => {
            video.current = node;
            if (node && cameraStream.current)
              node.srcObject = cameraStream.current;
          }}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setReady(true)}
          aria-label="Live attendance camera"
        />
        {error ? <p role="alert">{error}</p> : null}
        <div className="attendance-camera-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setReady(false);
              setError("");
              setRetry((v) => v + 1);
            }}
          >
            <RotateCcw size={16} />
            Retry camera
          </Button>
          <Button disabled={!ready || busy} onClick={capture}>
            <Camera size={16} />
            {busy ? "Recording…" : `Capture and clock ${action}`}
          </Button>
        </div>
        <p className="muted">
          Photo evidence is not facial recognition or identity verification.
        </p>
      </DialogContent>
    </Dialog>
  );
}
