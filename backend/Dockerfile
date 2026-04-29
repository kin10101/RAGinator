FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install build tools and small native deps some packages may need
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/

# Install Python deps (uses PEP517 - will build wheels as needed)
RUN pip install --upgrade pip setuptools wheel
RUN pip install .

# Copy source
COPY . /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
