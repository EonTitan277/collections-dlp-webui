# Use a slim Python base image
FROM python:3.12-slim

# Install system dependencies: ffmpeg, curl (to install uv), and clean up apt cache
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
ADD https://astral.sh/uv/install.sh /tmp/uv-install.sh
RUN chmod +x /tmp/uv-install.sh && \
    /tmp/uv-install.sh && \
    rm /tmp/uv-install.sh

# Add uv to PATH
ENV PATH="/root/.local/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Run uv sync to install all Python dependencies into the environment
RUN uv sync

# Expose the port that Flask runs on (default 5000)
EXPOSE 5555

# Command to run the application using uv (ensures the virtual env is used)
CMD ["uv", "run", "--no-dev", "app.py"]