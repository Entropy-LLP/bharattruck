# Dockerfile
# Multi-stage production-ready Dockerfile for Python 3.12 and FastAPI.
# - Stage 1 (builder): Installs compiling utilities and builds Python dependencies inside a virtualenv.
# - Stage 2 (runner): Copies virtualenv, source files, and runs under a non-root system user.

# ==========================================
# Builder Stage
# ==========================================
FROM python:3.12-slim AS builder

WORKDIR /build

# Install system compilation packages required for wheel builds (like psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Establish a virtual environment for isolated package builds
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip and install standard requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ==========================================
# Runner Stage
# ==========================================
FROM python:3.12-slim AS runner

WORKDIR /app

# Install runtime library dependencies only (no compiler overhead)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy migration configuration and source files
COPY alembic.ini .
COPY alembic/ ./alembic
COPY app/ ./app

# Add a dedicated system group and user to avoid running the container as root
RUN groupadd -r -g 10001 appgroup && \
    useradd -r -u 10001 -g appgroup -s /bin/bash appuser && \
    chown -R appuser:appgroup /app

# Switch to the secure non-root user
USER appuser

# Expose microservice port
EXPOSE 8000

# Run Uvicorn server in production mode
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
