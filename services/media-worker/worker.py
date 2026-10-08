"""Optional CPU transcription worker. No HR database or AI API key is needed here."""
import hmac
import os
import tempfile
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore, Lock
from urllib.parse import urlsplit
import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from faster_whisper import WhisperModel

app = FastAPI(title="Nonymauz media worker")
executor = ThreadPoolExecutor(max_workers=1)
capacity = BoundedSemaphore(10)
model_lock = Lock()
model = None
diarizer = None
MAX_BYTES = 100 * 1024 * 1024

class Track(BaseModel):
    url: str

class Job(BaseModel):
    jobId: str
    callbackToken: str = Field(min_length=64, max_length=64)
    callbackUrl: str
    tracks: list[Track] = Field(min_length=1, max_length=10)
    language: str = "auto"

def checked_url(url):
    origin = os.environ.get("MEDIA_HR_ORIGIN", "").rstrip("/")
    parsed = urlsplit(url)
    if not origin or f"{parsed.scheme}://{parsed.netloc}" != origin or parsed.username:
        raise ValueError("HR origin does not match configured MEDIA_HR_ORIGIN")
    if not parsed.path.startswith("/api/media/jobs/"):
        raise ValueError("Unsupported HR endpoint")
    return url

def run(command, timeout=180):
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=True)

def process(job):
    global model, diarizer
    auth = {"Authorization": f"Bearer {job.callbackToken}"}
    try:
        with tempfile.TemporaryDirectory(prefix="nonymauz-media-") as folder:
            root = Path(folder)
            normalized = []
            duration = 0
            total_bytes = 0
            with httpx.Client(timeout=90, follow_redirects=False) as client:
                for index, track in enumerate(job.tracks):
                    source, wav = root / f"input-{index}", root / f"audio-{index}.wav"
                    with client.stream("GET", checked_url(track.url), headers=auth) as response:
                        response.raise_for_status()
                        with source.open("wb") as output:
                            for chunk in response.iter_bytes():
                                total_bytes += len(chunk)
                                if total_bytes > MAX_BYTES:
                                    raise ValueError("Audio exceeds maximum size")
                                output.write(chunk)
                    run(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(source), "-t", "10800.01", "-vn", "-ac", "1", "-ar", "16000", "-y", str(wav)])
                    seconds = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(wav)]).stdout.strip())
                    duration += seconds
                    if not 0 < seconds <= 10800 or duration > 10800:
                        raise ValueError("Meeting exceeds three hours")
                    normalized.append(wav)
                concat = root / "tracks.txt"
                concat.write_text("\n".join(f"file '{path.name}'" for path in normalized))
                merged = root / "meeting.wav"
                run(["ffmpeg", "-nostdin", "-v", "error", "-f", "concat", "-safe", "1", "-i", str(concat), "-c", "copy", "-y", str(merged)])
                with model_lock:
                    if model is None:
                        model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8", download_root=os.environ.get("WHISPER_CACHE", "/models"))
                    segments, _ = model.transcribe(str(merged), language=None if job.language == "auto" else job.language, vad_filter=True, beam_size=5)
                    result = [{"start": round(s.start, 2), "end": round(min(s.end,10800), 2), "speaker": "Unlabelled", "text": s.text.strip()} for s in segments]
                if os.environ.get("DIARIZATION_ENABLED") == "true":
                    # Community model requires accepted model conditions and a private HF_TOKEN.
                    from pyannote.audio import Pipeline
                    if not os.environ.get("HF_TOKEN"):
                        raise ValueError("Diarization token is missing")
                    with model_lock:
                        if diarizer is None:
                            diarizer = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=os.environ["HF_TOKEN"])
                        speakers = [(turn.start, turn.end, speaker) for turn, speaker in diarizer(str(merged)).speaker_diarization]
                    for segment in result:
                        match = max(speakers, key=lambda s: max(0, min(segment["end"], s[1])-max(segment["start"], s[0])), default=None)
                        if match and min(segment["end"],match[1]) > max(segment["start"],match[0]):
                            segment["speaker"] = match[2]
                client.post(checked_url(job.callbackUrl), headers=auth, json={"status": "Complete", "segments": result}).raise_for_status()
    except Exception:
        # Never copy provider errors or private transcript contents into an HTTP error.
        try:
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                client.post(checked_url(job.callbackUrl), headers=auth, json={"status": "Failed"}).raise_for_status()
        except Exception:
            print("Media callback failed; inspect job state and retry from HR", flush=True)
    finally:
        capacity.release()

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/transcribe", status_code=202)
def transcribe(job: Job, authorization: str = Header(default="")):
    key = os.environ.get("MEDIA_WORKER_API_KEY", "")
    if not key or not hmac.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Worker access denied")
    if job.language not in ("auto", "ms", "en"):
        raise HTTPException(400, "Unsupported language")
    try:
        checked_url(job.callbackUrl)
        for track in job.tracks:
            checked_url(track.url)
    except ValueError:
        raise HTTPException(400, "Invalid HR callback origin")
    if not capacity.acquire(blocking=False):
        raise HTTPException(503, "Worker queue is full")
    executor.submit(process, job)
    return {"accepted": True, "jobId": job.jobId}

from fastapi import Request
@app.post("/ocr")
async def ocr(request: Request, authorization: str = Header(default="")):
    key = os.environ.get("MEDIA_WORKER_API_KEY", "")
    if not key or not hmac.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Worker access denied")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 2097152:
            raise HTTPException(413, "Receipt too large")
    if not (data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff"):
        raise HTTPException(400, "Receipt must be PNG or JPG")
    with tempfile.TemporaryDirectory(prefix="nonymauz-ocr-") as folder:
        source = Path(folder) / "receipt"
        source.write_bytes(data)
        try:
            text = run(["tesseract", str(source), "stdout", "-l", "eng", "--psm", "6"], timeout=30).stdout[:24000]
        except Exception:
            raise HTTPException(422, "Cannot read this receipt")
    return {"text": text}
