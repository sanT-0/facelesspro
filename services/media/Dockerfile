# FacelessPro Media Service - Production Dockerfile
FROM python:3.12-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY services/media/requirements.txt services/media/requirements-dev.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

# Copy source
COPY services/media/app ./app

# Production stage
FROM python:3.12-slim AS production

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed packages from base
COPY --from=base /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=base /usr/local/bin /usr/local/bin

# Copy source
COPY services/media/app ./app

# Create data directory
RUN mkdir -p /data/media

ENV PYTHONUNBUFFERED=1
ENV MEDIA_DATA_DIR=/data/media
ENV MEDIA_SERVICE_URL=http://0.0.0.0:8000

EXPOSE 8000

COPY services/media/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]