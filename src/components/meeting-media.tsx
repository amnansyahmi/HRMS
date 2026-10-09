"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Flag, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useWorkspace } from "./workspace-context";
import { api } from "@/lib/client";
import { toast } from "sonner";
export function MeetingMedia({ id }: { id: string }) {
  const { workspace, refresh, act } = useWorkspace(),
    meeting = workspace.records.find((r) => r.id === id)!,
    editable =
      meeting.data.createdBy === workspace.actor.userId ||
      workspace.actor.role === "owner";
  const [recording, setRecording] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [language, setLanguage] = useState("auto"),
    [flagLabel, setFlagLabel] = useState(""),
    [flags, setFlags] = useState<{ seconds: number; label: string }[]>([]),
    [jobs, setJobs] = useState<
      { id: string; status: string; error: string | null }[]
    >([]);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    started = useRef(0),
    chunks = useRef<Blob[]>([]),
    audio = useRef<HTMLAudioElement | null>(null),
    players = useRef<Record<string, HTMLAudioElement | null>>({}),
    activeTrack = useRef<string>(""),
    completedJob = useRef<string>("");
  useEffect(() => {
    return () => {
      if (recorder.current?.state === "recording")
        recorder.current.onstop = null;
      if (recorder.current?.state && recorder.current.state !== "inactive")
        recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const seconds = Math.floor((performance.now() - started.current) / 1000);
      setElapsed(seconds);
      if (seconds >= 10800) recorder.current?.stop();
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<typeof jobs>("/api/media/status/" + id)
        .then((value) => {
          if (active) {
            setJobs(value);
            if (
              value[0]?.status === "Complete" &&
              completedJob.current !== value[0].id
            ) {
              completedJob.current = value[0].id;
              void refresh();
            }
          }
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, refresh]);
  async function upload(blob: Blob, filename: string, duration: number) {
    if (blob.size > 100 * 1024 * 1024)
      return toast.error("Audio must be smaller than 100 MB");
    setBusy(true);
    setProgress(0);
    try {
      let uploadId: string | undefined;
      const size = 2097152,
        total = Math.ceil(blob.size / size);
      for (let part = 0; part < total; part++) {
        const form = new FormData();
        form.set("meetingId", id);
        if (uploadId) form.set("uploadId", uploadId);
        form.set("filename", filename);
        form.set("part", String(part));
        form.set("total", String(total));
        form.set("duration", String(duration));
        form.set(
          "chunk",
          blob.slice(part * size, (part + 1) * size),
          "chunk.bin",
        );
        const result = await api<{ uploadId: string }>(
          "/api/media/upload",
          form,
        );
        uploadId = result.uploadId;
        setProgress(Math.round(((part + 1) / total) * 100));
      }
      await refresh();
      toast.success("Audio saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder)
        return toast.error(
          "Audio recording needs a supported browser and HTTPS",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      recorder.current = new MediaRecorder(stream.current, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32000,
      });
      chunks.current = [];
      recorder.current.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.current.onstop = () => {
        const seconds = Math.min(
          10800,
          Math.max(1, (performance.now() - started.current) / 1000),
        );
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const type = recorder.current!.mimeType,
          extension = type.includes("mp4")
            ? "m4a"
            : type.includes("ogg")
              ? "ogg"
              : "webm";
        void upload(
          new Blob(chunks.current, { type }),
          `meeting-${new Date().toISOString().slice(0, 10)}.${extension}`,
          seconds,
        );
      };
      started.current = performance.now();
      setElapsed(0);
      setRecording(true);
      recorder.current.start(30000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function uploadFile(file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = new Audio(url);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        probe.onloadedmetadata = () => resolve(probe.duration);
        probe.onerror = () => reject(new Error("Cannot read this audio file"));
        setTimeout(() => reject(new Error("Audio metadata timed out")), 10000);
      });
      if (!Number.isFinite(duration) || duration <= 0 || duration > 10800)
        return toast.error("Upload an audio file up to three hours long");
      await upload(file, file.name, duration);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function saveFlags() {
    try {
      await api(
        "/api/records/meeting/" + id,
        {
          updatedAt: meeting.updated_at,
          data: {
            flags: [...((meeting.data.flags as typeof flags) || []), ...flags],
          },
        },
        "PATCH",
      );
      await refresh();
      setFlags([]);
      toast.success("Flags saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const tracks =
      (meeting.data.audioTracks as {
        id: string;
        filename: string;
        duration: number;
      }[]) || [],
    segments =
      (meeting.data.segments as {
        start: number;
        end: number;
        speaker: string;
        text: string;
      }[]) || [],
    talkTime = segments.reduce(
      (counts, s) => ({
        ...counts,
        [s.speaker]: (counts[s.speaker] || 0) + Math.max(0, s.end - s.start),
      }),
      {} as Record<string, number>,
    ),
    total = Object.values(talkTime).reduce((n, v) => n + v, 0),
    format = (seconds: number) =>
      `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  function currentSeconds() {
    let offset = 0;
    for (const track of tracks) {
      if (track.id === (activeTrack.current || tracks[0]?.id))
        return offset + (players.current[track.id]?.currentTime || 0);
      offset += track.duration;
    }
    return 0;
  }
  function seek(seconds: number) {
    let offset = 0;
    for (const track of tracks) {
      if (seconds < offset + track.duration) {
        const player = players.current[track.id];
        if (player) {
          player.currentTime = seconds - offset;
          void player.play();
        }
        return;
      }
      offset += track.duration;
    }
  }
  return (
    <section className="meeting-media">
      <div className="toolbar-actions">
        {editable ? (
          <>
            <Button
              size="sm"
              variant={recording ? "destructive" : "outline"}
              disabled={busy}
              onClick={() =>
                recording ? recorder.current?.stop() : void start()
              }
            >
              {recording ? <Square size={14} /> : <Mic size={14} />}{" "}
              {recording ? `Stop · ${format(elapsed)}` : "Record audio"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={recording || busy}
              asChild
            >
              <label>
                <Upload size={14} />
                Upload audio
                <input
                  className="sr-only"
                  type="file"
                  accept=".webm,.ogg,.wav,.mp3,.m4a,.mp4"
                  onChange={(e) => void uploadFile(e.target.files?.[0])}
                />
              </label>
            </Button>
          </>
        ) : null}
        {busy ? <span role="status">Saving audio · {progress}%</span> : null}
      </div>
      {recording ? (
        <p className="muted-text">
          Keep this page open while recording. Maximum three hours.
        </p>
      ) : null}
      {editable && (recording || tracks.length) ? (
        <div className="toolbar-actions">
          <Input
            aria-label="Flag note"
            placeholder="Flag a decision or follow-up"
            value={flagLabel}
            onChange={(e) => setFlagLabel(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!flagLabel.trim()}
            onClick={() => {
              setFlags((f) => [
                ...f,
                {
                  seconds: recording
                    ? tracks.reduce((n, t) => n + t.duration, 0) + elapsed
                    : currentSeconds(),
                  label: flagLabel,
                },
              ]);
              setFlagLabel("");
            }}
          >
            <Flag size={14} />
            Flag
          </Button>
          {flags.length ? (
            <Button size="sm" onClick={() => void saveFlags()}>
              Save {flags.length} flags
            </Button>
          ) : null}
        </div>
      ) : null}
      {tracks.map((track, i) => (
        <div className="audio-track" key={track.id}>
          <small>
            {track.filename} · {format(track.duration)}
          </small>
          <audio
            ref={(el) => {
              players.current[track.id] = el;
              if (i === 0) audio.current = el;
            }}
            onPlay={() => {
              activeTrack.current = track.id;
              for (const [trackId, player] of Object.entries(players.current))
                if (trackId !== track.id) player?.pause();
            }}
            controls
            preload="metadata"
            src={"/api/media/audio/" + track.id}
          />
        </div>
      ))}
      {((meeting.data.flags as typeof flags) || []).map((flag, i) => (
        <button
          className="transcript-segment"
          key={i}
          onClick={() => {
            seek(flag.seconds);
          }}
        >
          <strong>{format(flag.seconds)}</strong>
          <span>{flag.label}</span>
        </button>
      ))}
      {editable && tracks.length ? (
        <div className="toolbar-actions">
          <select
            className="native-select"
            aria-label="Transcription language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="auto">Detect BM / English</option>
            <option value="ms">Bahasa Melayu</option>
            <option value="en">English</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={jobs.some(
              (j) => j.status === "Running" || j.status === "Pending",
            )}
            onClick={() =>
              void act(
                "meeting-transcribe",
                { id, language },
                "Transcription started",
              )
            }
          >
            Transcribe audio
          </Button>
          <small>
            {jobs[0]?.status}
            {jobs[0]?.error ? " · " + jobs[0].error : ""}
          </small>
        </div>
      ) : null}
      {segments.length ? (
        <>
          <details>
            <summary>Transcript with timestamps</summary>
            {segments.map((s, i) => (
              <div key={i} className="transcript-segment">
                <button
                  onClick={() => {
                    seek(s.start);
                  }}
                >
                  {format(s.start)}
                </button>
                {editable ? (
                  <Input
                    aria-label={`Speaker at ${format(s.start)}`}
                    defaultValue={s.speaker}
                    onBlur={async (e) => {
                      if (e.target.value === s.speaker) return;
                      try {
                        const updated = segments.map((v, j) =>
                          j === i
                            ? { ...v, speaker: e.target.value || "Unlabelled" }
                            : v,
                        );
                        await api(
                          "/api/records/meeting/" + id,
                          {
                            updatedAt: meeting.updated_at,
                            data: { segments: updated },
                          },
                          "PATCH",
                        );
                        await refresh();
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  />
                ) : (
                  <strong>{s.speaker}</strong>
                )}
                <p>{s.text}</p>
              </div>
            ))}
          </details>
          <div className="talk-time">
            <strong>Talk time from labelled transcript segments</strong>
            {Object.entries(talkTime)
              .filter(([speaker]) => speaker !== "Unlabelled")
              .map(([speaker, seconds]) => (
                <span key={speaker}>
                  {speaker} · {format(seconds)} ·{" "}
                  {total ? Math.round((seconds / total) * 100) : 0}%
                </span>
              ))}
            {talkTime.Unlabelled ? (
              <small>
                Unlabelled: {format(talkTime.Unlabelled)}. Add speaker labels to
                show individual talk time.
              </small>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
