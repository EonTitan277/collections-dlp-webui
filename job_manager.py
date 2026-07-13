import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from queue import Queue
from threading import Lock, Thread

from config import CONFIG_PATH, LOGS_DIR, JOBS_DIR, config_manager, ConfigError
from collections_manager import get_collection_item, get_collection_cookie_file, get_collection_ytdlp_args
from yt_dlp_runner import build_command, stream_process_output


class JobManager:
    def __init__(self):
        self.jobs_dir = JOBS_DIR
        self.logs_dir = LOGS_DIR
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, dict] = {}
        self.event_queues: dict[str, Queue] = {}
        self.lock = Lock()

    def create_job(self, file_name: str, collection_item_ids: list[str]) -> dict:
        if not collection_item_ids:
            raise ConfigError("collection_item_ids is required")

        job_id = uuid.uuid4().hex
        log_path = self.logs_dir / f"job_{job_id}.log"
        job = {
            "id": job_id,
            "file": file_name,
            "collection_item_ids": collection_item_ids,
            "status": "queued",
            "started_at": None,
            "completed_at": None,
            "log_file": str(log_path),
            "current_item": None,
            "result": None,
            "cancel_requested": False,
            "completed_items": 0,
            "total_items": len(collection_item_ids),
        }
        with self.lock:
            self.jobs[job_id] = job
            self.event_queues[job_id] = Queue()

        thread = Thread(target=self._run_job, args=(job_id,), daemon=True)
        thread.start()
        return self._job_summary(job)

    def cancel_job(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.jobs:
                raise FileNotFoundError(f"Job not found: {job_id}")
            job = self.jobs[job_id]
            job["cancel_requested"] = True
            for process in job.get("processes", []):
                if process and process.poll() is None:
                    process.terminate()
        return self._job_summary(job)

    def list_jobs(self) -> list[dict]:
        with self.lock:
            return [self._job_summary(job) for job in self.jobs.values()]

    def get_job(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.jobs:
                raise FileNotFoundError(f"Job not found: {job_id}")
            return self._job_summary(self.jobs[job_id])

    def get_event_queue(self, job_id: str) -> Queue:
        with self.lock:
            if job_id not in self.event_queues:
                raise FileNotFoundError(f"Job not found: {job_id}")
            return self.event_queues[job_id]

    def is_file_in_use(self, file_name: str) -> bool:
        with self.lock:
            return any(
                job["file"] == file_name and job["status"] in {"queued", "running"}
                for job in self.jobs.values()
            )

    def _enqueue_event(self, job_id: str, event: dict | None) -> None:
        queue = self.get_event_queue(job_id)
        queue.put(event)

    def _run_job(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs[job_id]
            job["status"] = "running"
            job["started_at"] = datetime.utcnow().isoformat() + "Z"
            job["processes"] = []
        self._enqueue_event(job_id, {"type": "job_started", "job_id": job_id, "started_at": job["started_at"]})

        log_path = Path(job["log_file"])
        with log_path.open("w", encoding="utf-8") as log_handle:
            try:
                for item_id in job["collection_item_ids"]:
                    if job["cancel_requested"]:
                        break

                    item = get_collection_item(job["file"], item_id)
                    if item is None:
                        raise ConfigError(f"Collection item not found: {item_id}")

                    item_name = item.get("name") or item_id

                    with self.lock:
                        job["current_item"] = item_id
                        job["status"] = "running"
                    self._enqueue_event(job_id, {"type": "item_started", "job_id": job_id, "item_id": item_id, "item_name": item_name})

                    # Get collection-level cookie file and custom yt-dlp args
                    cookie_key = get_collection_cookie_file(job["file"])
                    ytdlp_args = get_collection_ytdlp_args(job["file"])
                    command = build_command(
                        item,
                        config_manager.data,
                        cookie_key,
                        collection_custom_args=ytdlp_args["custom_ytdlp_args"],
                        collection_custom_args_mode=ytdlp_args["custom_ytdlp_args_mode"],
                    )
                    process = subprocess.Popen(
                        command,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        bufsize=1,
                    )
                    with self.lock:
                        job["processes"].append(process)

                    for progress_event in stream_process_output(process, item_id, log_handle):
                        if job["cancel_requested"]:
                            break
                        self._enqueue_event(job_id, progress_event)

                    process.wait()
                    if process.returncode != 0 and not job["cancel_requested"]:
                        raise subprocess.CalledProcessError(process.returncode, command)

                    with self.lock:
                        job["completed_items"] += 1
                        completed = job["completed_items"]
                        total = job["total_items"]
                    self._enqueue_event(job_id, {"type": "item_completed", "job_id": job_id, "item_id": item_id, "completed_items": completed, "total_items": total})

                with self.lock:
                    if job["cancel_requested"]:
                        job["status"] = "cancelled"
                        job["result"] = "cancelled"
                    else:
                        job["status"] = "completed"
                        job["result"] = "success"
            except Exception as exc:
                with self.lock:
                    job["status"] = "failed"
                    job["result"] = str(exc)
                self._enqueue_event(job_id, {"type": "job_failed", "job_id": job_id, "error": str(exc)})
            finally:
                with self.lock:
                    job["completed_at"] = datetime.utcnow().isoformat() + "Z"
                self._enqueue_event(job_id, {
                    "type": "job_finished",
                    "job_id": job_id,
                    "status": job["status"],
                    "completed_at": job["completed_at"],
                })
                self._enqueue_event(job_id, None)

    def _job_summary(self, job: dict) -> dict:
        summary = {
            "id": job["id"],
            "file": job["file"],
            "collection_item_ids": job["collection_item_ids"],
            "status": job["status"],
            "started_at": job["started_at"],
            "completed_at": job["completed_at"],
            "log_file": job["log_file"],
            "current_item": job.get("current_item"),
            "result": job.get("result"),
            "completed_items": job.get("completed_items", 0),
            "total_items": job.get("total_items", len(job["collection_item_ids"])),
        }
        # Include current_item_name for running jobs (Option A - always show name)
        if job.get("current_item") and job["status"] == "running":
            item = get_collection_item(job["file"], job["current_item"])
            if item:
                summary["current_item_name"] = item.get("name") or job["current_item"]
        return summary


job_manager = JobManager()
