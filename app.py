import json
from pathlib import Path
from flask import Flask, jsonify, request, render_template, Response, stream_with_context

from config import config_manager, ConfigError
from collections_manager import (
    add_collection_item,
    get_collection_item,
    get_next_collection_item_id,
    load_collection_file,
    remove_collection_item,
    update_collection_item,
)
from job_manager import job_manager

app = Flask(__name__, template_folder="templates", static_folder="static")


def validate_collection_file_name(file_name: str) -> str:
    if not file_name or Path(file_name).name != file_name or Path(file_name).suffix.lower() != ".json":
        raise ConfigError("Invalid collection file name")
    return file_name


def api_error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/collection-files", methods=["GET"])
def api_collection_files():
    try:
        collection_files = config_manager.scan_collection_files()
    except ConfigError as exc:
        return api_error(str(exc), 500)

    default_file = config_manager.data.get("default_collection_file", "")
    files = [
        {"filename": name, "is_default": name == default_file}
        for name in collection_files
    ]
    return jsonify({"files": files, "default": default_file})


@app.route("/api/collection-files", methods=["POST"])
def api_create_collection_file():
    payload = request.get_json(silent=True) or {}
    file_name = payload.get("filename")
    if not file_name:
        return api_error("filename is required")

    try:
        file_name = validate_collection_file_name(file_name)
        config_manager.create_collection_file(file_name)
        return jsonify({"file": file_name}), 201
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-files/<file_name>/default", methods=["PUT"])
def api_set_default_collection_file(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        collection_files = config_manager.scan_collection_files()
        if file_name not in collection_files:
            return api_error(f"Collection file not found: {file_name}", 404)
        config_manager.set_default_collection_file(file_name)
        return jsonify({"default": file_name})
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-files/<file_name>", methods=["DELETE"])
def api_delete_collection_file(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        if job_manager.is_file_in_use(file_name):
            return api_error("Cannot delete a collection file in use by a running job", 409)
        config_manager.delete_collection_file(file_name)
        return jsonify({"deleted": file_name})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/collection-items", methods=["GET"])
def api_collection_items():
    file_name = request.args.get("file") or config_manager.data.get("default_collection_file")
    if not file_name:
        return api_error("No collection file selected")

    try:
        items = load_collection_file(file_name)
        return jsonify({"file": file_name, "items": items})
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-items", methods=["POST"])
def api_add_collection_item():
    file_name = request.args.get("file") or config_manager.data.get("default_collection_file")
    payload = request.get_json(silent=True) or {}
    if not file_name:
        return api_error("No collection file selected")
    if not payload:
        return api_error("Request body must be JSON")

    payload.setdefault("id", get_next_collection_item_id(file_name))
    try:
        added = add_collection_item(file_name, payload)
        return jsonify(added), 201
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-items/<item_id>", methods=["PUT"])
def api_update_collection_item(item_id: str):
    file_name = request.args.get("file") or config_manager.data.get("default_collection_file")
    payload = request.get_json(silent=True) or {}
    if not file_name:
        return api_error("No collection file selected")
    if not payload:
        return api_error("Request body must be JSON")

    payload["id"] = item_id
    try:
        updated = update_collection_item(file_name, item_id, payload)
        return jsonify(updated)
    except FileNotFoundError:
        return api_error(f"Collection item not found: {item_id}", 404)
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-items/<item_id>", methods=["DELETE"])
def api_remove_collection_item(item_id: str):
    file_name = request.args.get("file") or config_manager.data.get("default_collection_file")
    if not file_name:
        return api_error("No collection file selected")
    try:
        remove_collection_item(file_name, item_id)
        return jsonify({"deleted": item_id})
    except FileNotFoundError:
        return api_error(f"Collection item not found: {item_id}", 404)
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/config", methods=["GET"])
def api_config():
    sanitized = {
        "download_root": config_manager.data.get("download_root"),
        "cookie_files": config_manager.data.get("cookie_files", {}),
        "filename_template": config_manager.data.get("filename_template", "%(title).200B.%(ext)s"),
        "restrict_filenames": config_manager.data.get("restrict_filenames", True),
        "video_codec": config_manager.data.get("video_codec", "h264"),
        "max_concurrent_downloads": config_manager.data.get("max_concurrent_downloads", 2),
        "default_collection_file": config_manager.data.get("default_collection_file", ""),
    }
    return jsonify(sanitized)


@app.route("/api/config", methods=["PUT"])
def api_update_config():
    payload = request.get_json(silent=True) or {}
    try:
        config_manager.update_config(payload)
        return api_config()
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/jobs", methods=["GET"])
def api_list_jobs():
    return jsonify({"jobs": job_manager.list_jobs()})


@app.route("/api/jobs", methods=["POST"])
def api_create_job():
    payload = request.get_json(silent=True) or {}
    file_name = payload.get("file") or config_manager.data.get("default_collection_file")
    item_ids = payload.get("collection_item_ids")
    if not file_name:
        return api_error("No collection file selected")
    if not item_ids or not isinstance(item_ids, list):
        return api_error("collection_item_ids must be a non-empty list")

    try:
        job = job_manager.create_job(file_name, item_ids)
        return jsonify(job), 202
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/jobs/<job_id>/cancel", methods=["POST"])
def api_cancel_job(job_id: str):
    try:
        job = job_manager.cancel_job(job_id)
        return jsonify(job)
    except FileNotFoundError:
        return api_error(f"Job not found: {job_id}", 404)


@app.route("/api/jobs/<job_id>/logs", methods=["GET"])
def api_job_logs(job_id: str):
    try:
        job = job_manager.get_job(job_id)
        log_path = Path(job["log_file"])
        if not log_path.exists():
            return api_error("Job log not found", 404)
        return Response(log_path.read_text(encoding="utf-8"), mimetype="text/plain")
    except FileNotFoundError:
        return api_error(f"Job not found: {job_id}", 404)


@app.route("/api/stream/<job_id>", methods=["GET"])
def api_stream_job(job_id: str):
    try:
        queue = job_manager.get_event_queue(job_id)
    except FileNotFoundError:
        return api_error(f"Job not found: {job_id}", 404)

    def event_generator():
        while True:
            event = queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return Response(stream_with_context(event_generator()), mimetype="text/event-stream")


@app.errorhandler(404)
def not_found(error):
    return render_template("index.html"), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
