import logging
import re
import shlex
import subprocess
from pathlib import Path
from typing import Generator

from config import config_manager, ConfigError, find_denied_arg

logger = logging.getLogger(__name__)

DOWNLOAD_PROGRESS_RE = re.compile(
    r"\[download\]\s+(?P<percent>\d+\.\d+)%(?:.*?at\s+(?P<speed>\S+))?(?:.*?ETA\s+(?P<eta>\S+))?"
)


def build_command(
    collection_item: dict,
    config_data: dict,
    cookie_key: str | None = None,
    collection_custom_args: str = "",
    collection_custom_args_mode: str = "join",
) -> list[str]:
    output_dir = Path(config_data["download_root"]) / collection_item["folder"]
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine cookie file to use
    if cookie_key is None:
        # Fall back to first available cookie file if none specified
        cookie_files = config_manager.list_cookie_files()
        if cookie_files:
            cookie_key = cookie_files[0]
        else:
            raise ConfigError("No cookie files configured")
    
    cookie_path = config_manager.get_cookie_path(cookie_key)

    cmd = [
        "yt-dlp",
        "--newline",
        collection_item["url"],
        "--cookies",
        str(cookie_path),
        "-o",
        str(output_dir / config_data.get("filename_template", "%(title).50s.%(ext)s")),
    ]
    if config_data.get("restrict_filenames"):
        cmd.append("--restrict-filenames")

    # Merge global and collection-level custom yt-dlp args.
    global_custom_args = config_data.get("custom_ytdlp_args", "") or ""
    collection_custom_args = collection_custom_args or ""

    if collection_custom_args_mode == "override" and collection_custom_args.strip():
        # Collection args replace the global args entirely, unless the
        # collection has no custom args at all, in which case the global
        # args still apply (an empty override should not silently clear
        # the global config).
        merged_args = collection_custom_args
    else:
        merged_args = " ".join(part for part in (global_custom_args, collection_custom_args) if part.strip())

    if merged_args.strip():
        merged_tokens = shlex.split(merged_args)
        # Defense-in-depth: config.json or a collection file may have been
        # hand-edited after the save-time validations ran. Re-check here so
        # a denied flag fails the job loudly instead of silently breaking
        # the command.
        denied = find_denied_arg(merged_tokens)
        if denied:
            raise ConfigError(
                f"custom_ytdlp_args cannot include '{denied}' — this is managed automatically by the app"
            )
        cmd.extend(merged_tokens)

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
