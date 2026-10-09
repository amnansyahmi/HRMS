FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements*.txt ./
ARG DIARIZATION=false
RUN pip install --no-cache-dir -r requirements.txt && if [ "$DIARIZATION" = "true" ]; then pip install --no-cache-dir -r requirements-diarization.txt; fi
COPY worker.py .
RUN useradd --create-home worker && mkdir /models && chown worker:worker /models
USER worker
EXPOSE 8080
CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8080"]
