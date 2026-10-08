# Private media worker

Optional FastAPI service for CPU Whisper transcription and Tesseract receipt OCR. It holds no HR database connection or ai-nonymauz-cloud key. Do not deploy it inside the frontend's short-lived request runtime.

```bash
docker build -t nonymauz-media services/media-worker
docker run --rm -p 8080:8080 \
  -e MEDIA_WORKER_API_KEY=your-worker-secret \
  -e MEDIA_HR_ORIGIN=https://hr.example.com \
  -e WHISPER_MODEL=small \
  -v nonymauz-whisper:/models nonymauz-media
```

Set `MEDIA_WORKER_URL=https://your-worker-origin` and the matching `MEDIA_WORKER_API_KEY` on the HR app. Set its `APP_URL` to `MEDIA_HR_ORIGIN`. The worker must be able to reach that origin; HTTPS is required for production. Store these values as deployment secrets rather than committing a configured command.

`POST /transcribe` uses the worker bearer key. Downloads and callbacks use a different short-lived token scoped to one persisted HR job. The worker validates the configured HR origin, refuses redirects, limits media bytes/decoded duration, and uses ffmpeg with local-file protocols. Each meeting can contain up to three hours total, with automatic, Malay or English language selection. Model files download on the first job; persistent `/models` avoids repeat downloads.

One CPU job runs at a time, with a bounded in-process queue. The HR database retains job state and fails abandoned jobs after six hours when cron runs. Restarting the worker loses its in-memory queue; retry timed-out work from the HR screen. This is not a durable external queue. Size CPU/memory/disk for real recording lengths and monitor throughput. Speech accuracy, language mixing and talk-time labels need human review.

For automatic speaker separation, build with `--build-arg DIARIZATION=true`, accept the [Community-1 model conditions](https://huggingface.co/pyannote/speaker-diarization-community-1), and set `DIARIZATION_ENABLED=true` and a private `HF_TOKEN` on the worker. This installs pyannote.audio and additional model dependencies. Without it, segments are unlabelled and the app provides manual speaker labels. The optional model path requires a separate live validation after deployment.

`POST /ocr` accepts authenticated PNG/JPG receipt bytes, bounded to 2 MB, and returns extracted text. The HR server proposes total/date/merchant fields, which the person checks before submitting. No OCR suggestion directly approves or pays a claim.

Primary libraries: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [FastAPI](https://fastapi.tiangolo.com/), [pyannote.audio](https://github.com/pyannote/pyannote-audio). The container runs as an unprivileged worker user. `/health` reports service availability; it does not certify model downloads or an end-to-end transcription.
