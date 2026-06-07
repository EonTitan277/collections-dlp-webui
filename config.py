import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config/config.json"
COLLECTIONS_DIR = ROOT / "collections"
LOGS_DIR = ROOT / "logs"
JOBS_DIR = ROOT / "jobs"


class ConfigError(Exception):
    pass


class ConfigManager:
    def __init__(self):
        self.config_path = CONFIG_PATH
        self.collections_dir = COLLECTIONS_DIR
        self.logs_dir = LOGS_DIR
        self.jobs_dir = JOBS_DIR
        self.data = self.load_config()
        self.validate_config()
        self.collections_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    def load_config(self):
        if not self.config_path.exists():
            # Generate a default config.json
            default_config = {
                "download_root": "downloads",
                "filename_template": "%(title).200B.%(ext)s",
                "restrict_filenames": True,
                "video_codec": "h264",
                "max_concurrent_downloads": 2,
                "default_collection_file": "",
            }
            self.data = default_config
            self.save_config()
            return default_config
        with self.config_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def save_config(self):
        with self.config_path.open("w", encoding="utf-8") as handle:
            json.dump(self.data, handle, indent=2)
            handle.write("\n")

    def validate_config(self):
        if not isinstance(self.data, dict):
            raise ConfigError("config.json must contain a JSON object")

        if "download_root" not in self.data:
            raise ConfigError("config.json must include download_root")

        download_root = Path(self.data["download_root"])
        if not download_root.is_absolute():
            download_root = ROOT / download_root
        download_root.mkdir(parents=True, exist_ok=True)
        self.data["download_root"] = str(download_root)

        if "default_collection_file" not in self.data:
            self.data["default_collection_file"] = ""

    def update_config(self, updates: dict) -> None:
        if not isinstance(updates, dict):
            raise ConfigError("Config updates must be a JSON object")

        allowed_keys = {
            "download_root",
            "filename_template",
            "restrict_filenames",
            "video_codec",
            "max_concurrent_downloads",
            "default_collection_file",
        }
        for key in updates:
            if key not in allowed_keys:
                raise ConfigError(f"Unknown config field: {key}")

        if "download_root" in updates:
            download_root = Path(updates["download_root"])
            if not download_root.is_absolute():
                download_root = ROOT / download_root
            download_root.mkdir(parents=True, exist_ok=True)
            self.data["download_root"] = str(download_root)

        if "default_collection_file" in updates:
            self.data["default_collection_file"] = updates["default_collection_file"]

        for key in ["filename_template", "restrict_filenames", "video_codec", "max_concurrent_downloads"]:
            if key in updates:
                self.data[key] = updates[key]

        self.validate_config()
        self.save_config()

    def get_cookie_path(self, filename: str) -> Path:
        """Get the path to a cookie file by filename."""
        cookies_dir = self.get_cookies_dir()
        cookie_path = cookies_dir / filename
        if not cookie_path.exists():
            # Try with .txt extension if not provided
            if not filename.endswith('.txt'):
                cookie_path = cookies_dir / (filename + '.txt')
                if not cookie_path.exists():
                    raise ConfigError(f"Cookie file not found: {filename}")
            else:
                raise ConfigError(f"Cookie file not found: {filename}")
        return cookie_path

    def list_cookie_files(self) -> list[str]:
        """Return list of available cookie files from the cookies directory."""
        cookies_dir = self.get_cookies_dir()
        if not cookies_dir.exists():
            return []
        
        cookie_files = []
        for file_path in cookies_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() == '.txt':
                cookie_files.append(file_path.name)
        
        return cookie_files

    def get_cookies_dir(self) -> Path:
        """Return the cookies directory path."""
        return ROOT / "cookies"

    def get_download_path(self, collection_entry: dict) -> Path:
        folder = collection_entry.get("folder", "")
        if not folder:
            raise ConfigError("Collection entry must include a folder")

        if self.is_absolute_or_traversal(folder):
            raise ConfigError("Collection folder must be a relative path without traversal")

        download_root = Path(self.data["download_root"])
        resolved = download_root.joinpath(folder).resolve()
        if not self.is_within_root(resolved, download_root.resolve()):
            raise ConfigError("Resolved path is outside download_root")

        resolved.mkdir(parents=True, exist_ok=True)
        return resolved

    def is_absolute_or_traversal(self, folder: str) -> bool:
        path = Path(folder)
        return path.is_absolute() or ".." in path.parts

    def is_within_root(self, path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    def scan_collection_files(self) -> list[str]:
        self.collections_dir.mkdir(parents=True, exist_ok=True)
        collection_files = []
        for collection_path in sorted(self.collections_dir.glob("*.json")):
            self.validate_collection_file(collection_path)
            collection_files.append(collection_path.name)
        return collection_files

    def validate_collection_file(self, collection_path: Path) -> bool:
        if not collection_path.exists():
            raise ConfigError(f"Collection file not found: {collection_path}")

        with collection_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)

        # Support both old list format (for migration) and new object format
        items = []
        cookie_file = None
        
        if isinstance(data, list):
            # Old format during migration
            items = data
        elif isinstance(data, dict):
            # New format
            if "items" not in data or not isinstance(data["items"], list):
                raise ConfigError(f"Collection file must contain 'items' array: {collection_path}")
            items = data["items"]
            cookie_file = data.get("cookie_file")
        else:
            raise ConfigError(f"Collection file must be a JSON array or object: {collection_path}")

        # Validate cookie_file at collection level if present
        if cookie_file is not None:
            try:
                self.get_cookie_path(cookie_file)
            except ConfigError:
                raise ConfigError(
                    f"Unknown cookie_file '{cookie_file}' in {collection_path}"
                )

        for item in items:
            if not isinstance(item, dict):
                raise ConfigError(f"Collection entries must be JSON objects: {collection_path}")
            if "id" not in item or "url" not in item or "folder" not in item:
                raise ConfigError(
                    f"Each collection item must include id, url, and folder: {collection_path}"
                )
            # cookie_file should not be at item level in new format
            if "cookie_file" in item:
                raise ConfigError(
                    f"cookie_file must not be in individual items: {collection_path}"
                )
        return True

    def get_default_collection_file(self) -> str:
        return self.data.get("default_collection_file", "")

    def set_default_collection_file(self, file_name: str) -> None:
        self.data["default_collection_file"] = file_name
        self.save_config()

    def create_collection_file(self, file_name: str) -> Path:
        collection_path = self.collections_dir / file_name
        if collection_path.exists():
            raise ConfigError(f"Collection file already exists: {file_name}")
        # Create with new object format
        collection_path.write_text('{"cookie_file": null, "items": []}', encoding="utf-8")
        return collection_path

    def delete_collection_file(self, file_name: str) -> None:
        collection_path = self.collections_dir / file_name
        if not collection_path.exists():
            raise ConfigError(f"Collection file not found: {file_name}")
        collection_path.unlink()
        if self.data.get("default_collection_file") == file_name:
            self.data["default_collection_file"] = ""
            self.save_config()


config_manager = ConfigManager()
