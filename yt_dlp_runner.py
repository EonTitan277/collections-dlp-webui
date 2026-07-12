import logging
import re
import subprocess
from pathlib import Path
from typing import Generator

from config import config_manager, ConfigError

logger = logging.getLogger(__name__)

DOWNLOAD_PROGRESS_RE = re.compile(
    r"\[download\]\s+(?P<percent>\d+\.\d+)%(?:.*?at\s+(?P<speed>\S+))?(?:.*?ETA\s+(?P<eta>\S+))?"
)


def build_command(collection_item: dict, config_data: dict, cookie_key: str | None = None) -> list[str]:
    output_dir = Path(config_data["download_root"]) / collection_item["folder"]
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine cookie file to use
    if cookie_key is None:
        # Fall back to first available cookie file if none specified
        if config_data["cookie_files"]:
            cookie_key = next(iter(config_data["cookie_files"]))
        else:
            raise ConfigError("No cookie files configured")
    
    cookie_path = config_manager.get_cookie_path(cookie_key)

    cmd = [
        "yt-dlp",
        "--newline",
        "-S",
        f"vcodec:{config_data.get('video_codec', 'h264')}",
        collection_item["url"],
        "--cookies",
        str(cookie_path),
        "-o",
        str(output_dir / config_data.get("filename_template", "%(title).50s.%(ext)s")),
    ]
    if config_data.get("restrict_filenames"):
        cmd.append("--restrict-filenames")
    return cmd


def parse_progress_line(line: str) -> dict | None:
    match = DOWNLOAD_PROGRESS_RE.search(line)
    if not match:
        # Log failed parses of [download] lines to catch future regex drift
        if "[download]" in line:
            logger.debug(f"Failed to parse [download] line: {line}")
        return None

    return {
        "type": "progress",
        "percent": float(match.group("percent")),
        "speed": match.group("speed"),
        "eta": match.group("eta"),
        "raw": line,
    }


def stream_process_output(process: subprocess.Popen, item_id: str, log_handle) -> Generator[dict, None, None]:
    if not process.stdout:
        return

    for raw_line in process.stdout:
        line = raw_line.rstrip("\n")
        log_handle.write(line + "\n")
        progress = parse_progress_line(line)
        if progress:
            progress["item_id"] = item_id
            yield progress
