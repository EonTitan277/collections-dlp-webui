import json
import os
from pathlib import Path
from flask import Flask, jsonify, request, render_template, Response, stream_with_context

from config import config_manager, ConfigError
from collections_manager import (
    add_collection_item,
    get_collection_item,
    get_next_collection_item_id,
    get_collection_cookie_file,
    set_collection_cookie_file,
    get_collection_ytdlp_args,
    set_collection_ytdlp_args,
    load_collection_file,
    remove_collection_item,
    reorder_collection_items,
    update_collection_sort_prefs,
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
        data = load_collection_file(file_name)
        items = data.get("items", [])
        cookie_file = data.get("cookie_file")
        sort_by = data.get("sort_by", "custom")
        sort_direction = data.get("sort_direction", "asc")
        custom_ytdlp_args = data.get("custom_ytdlp_args", "")
        custom_ytdlp_args_mode = data.get("custom_ytdlp_args_mode", "join")
        return jsonify({
            "file": file_name,
            "items": items,
            "cookie_file": cookie_file,
            "sort_by": sort_by,
            "sort_direction": sort_direction,
            "custom_ytdlp_args": custom_ytdlp_args,
            "custom_ytdlp_args_mode": custom_ytdlp_args_mode,
        })
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


@app.route("/api/collection-items/reorder", methods=["PUT"])
def api_reorder_collection_items():
    file_name = request.args.get("file") or config_manager.data.get("default_collection_file")
    if not file_name:
        return api_error("No collection file selected")
    
    payload = request.get_json(silent=True) or {}
    ordered_ids = payload.get("ordered_ids", [])
    
    if not isinstance(ordered_ids, list):
        return api_error("ordered_ids must be an array")
    
    try:
        reorder_collection_items(file_name, ordered_ids)
        return jsonify({"reordered": True})
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)
    except ConfigError as exc:
        return api_error(str(exc), 400)


@app.route("/api/collection-files/<file_name>/sort", methods=["PUT"])
def api_update_collection_sort_prefs(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        payload = request.get_json(silent=True) or {}
        sort_by = payload.get("sort_by", "custom")
        sort_direction = payload.get("sort_direction", "asc")
        
        update_collection_sort_prefs(file_name, sort_by, sort_direction)
        return jsonify({"sort_by": sort_by, "sort_direction": sort_direction})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


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


@app.route("/api/collection-files/<file_name>/cookie", methods=["GET"])
def api_get_collection_cookie(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        cookie_file = get_collection_cookie_file(file_name)
        return jsonify({"cookie_file": cookie_file})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/collection-files/<file_name>/cookie", methods=["PUT"])
def api_set_collection_cookie(file_name: str):
    payload = request.get_json(silent=True) or {}
    cookie_file = payload.get("cookie_file")  # Can be None to clear
    
    try:
        file_name = validate_collection_file_name(file_name)
        # Verify collection file exists
        load_collection_file(file_name)
        set_collection_cookie_file(file_name, cookie_file)
        return jsonify({"cookie_file": cookie_file})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/collection-files/<file_name>/ytdlp-args", methods=["GET"])
def api_get_collection_ytdlp_args(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        args_data = get_collection_ytdlp_args(file_name)
        return jsonify(args_data)
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/collection-files/<file_name>/ytdlp-args", methods=["PUT"])
def api_set_collection_ytdlp_args(file_name: str):
    payload = request.get_json(silent=True) or {}
    custom_args = payload.get("custom_ytdlp_args", "")
    mode = payload.get("custom_ytdlp_args_mode", "join")

    try:
        file_name = validate_collection_file_name(file_name)
        # Verify collection file exists
        load_collection_file(file_name)
        set_collection_ytdlp_args(file_name, custom_args, mode)
        return jsonify({"custom_ytdlp_args": custom_args, "custom_ytdlp_args_mode": mode})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/collection-files/<file_name>/cookie/upload", methods=["POST"])
def api_upload_cookie_file(file_name: str):
    try:
        file_name = validate_collection_file_name(file_name)
        # Verify collection file exists
        load_collection_file(file_name)
        
        if 'file' not in request.files:
            return api_error("No file provided")
        
        uploaded_file = request.files['file']
        if uploaded_file.filename == '':
            return api_error("No file selected")
        
        # Validate filename
        cookie_filename = Path(uploaded_file.filename).name if uploaded_file.filename else ''
        if not cookie_filename or not cookie_filename.endswith('.txt'):
            return api_error("Cookie file must be a .txt file")
        
        # Save to cookies directory
        cookies_dir = config_manager.get_cookies_dir()
        cookies_dir.mkdir(parents=True, exist_ok=True)
        cookie_path = cookies_dir / cookie_filename
        
        # Save the uploaded file
        uploaded_file.save(str(cookie_path))
        
        # Set this cookie as the collection's cookie
        set_collection_cookie_file(file_name, cookie_filename)
        
        return jsonify({"cookie_file": cookie_filename}), 201
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except FileNotFoundError:
        return api_error(f"Collection file not found: {file_name}", 404)


@app.route("/api/cookie-files", methods=["GET"])
def api_list_cookie_files():
    try:
        cookie_files = config_manager.list_cookie_files()
        return jsonify({"cookie_files": cookie_files})
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/cookie-files/<file_name>", methods=["DELETE"])
def api_delete_cookie_file(file_name: str):
    try:
        # Validate file name (no path traversal, must be .txt)
        if not file_name or Path(file_name).name != file_name or Path(file_name).suffix.lower() != ".txt":
            return api_error("Invalid cookie file name", 400)
        
        # Get the cookies directory and resolve the file path
        cookies_dir = config_manager.get_cookies_dir()
        cookie_path = cookies_dir / file_name
        
        # Check if file exists
        if not cookie_path.exists():
            return api_error(f"Cookie file not found: {file_name}", 404)
        
        # Get the current collection's cookie file
        current_file = config_manager.data.get("default_collection_file")
        current_cookie = None
        if current_file:
            current_cookie = get_collection_cookie_file(current_file)
        
        # Delete the cookie file
        cookie_path.unlink()
        
        # If the deleted cookie is assigned to the current collection, clear it
        if current_file and current_cookie == file_name:
            set_collection_cookie_file(current_file, None)
        
        return jsonify({"deleted": file_name})
    except ConfigError as exc:
        return api_error(str(exc), 400)
    except Exception as exc:
        return api_error(f"Unable to delete cookie file: {str(exc)}", 500)


@app.route("/api/config", methods=["GET"])
def api_config():
    sanitized = {
        "download_root": config_manager.data.get("download_root"),
        "filename_template": config_manager.data.get("filename_template", "%(title).50s.%(ext)s"),
        "restrict_filenames": config_manager.data.get("restrict_filenames", True),
        "max_concurrent_downloads": config_manager.data.get("max_concurrent_downloads", 2),
        "default_collection_file": config_manager.data.get("default_collection_file", ""),
        "custom_ytdlp_args": config_manager.data.get("custom_ytdlp_args", ""),
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
    app.run(host="0.0.0.0", port=5555, debug=True)
