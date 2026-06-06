import json
import uuid
from pathlib import Path

from config import COLLECTIONS_DIR, config_manager, ConfigError


def collection_file_path(file_name: str) -> Path:
    return COLLECTIONS_DIR / file_name


def load_collection_file(file_name: str) -> list[dict]:
    path = collection_file_path(file_name)
    if not path.exists():
        raise FileNotFoundError(f"Collection file not found: {file_name}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ConfigError(f"Collection file must contain a JSON array: {file_name}")
    return data


def save_collection_file(file_name: str, data: list[dict]) -> None:
    path = collection_file_path(file_name)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def get_collection_item(file_name: str, item_id: str) -> dict | None:
    items = load_collection_file(file_name)
    return next((item for item in items if item.get("id") == item_id), None)


def add_collection_item(file_name: str, entry: dict) -> dict:
    items = load_collection_file(file_name)
    validate_collection_entry(entry, items)
    items.append(entry)
    save_collection_file(file_name, items)
    return entry


def update_collection_item(file_name: str, item_id: str, entry: dict) -> dict:
    items = load_collection_file(file_name)
    existing = get_collection_item(file_name, item_id)
    if existing is None:
        raise FileNotFoundError(f"Collection item not found: {item_id}")
    validate_collection_entry(entry, items, allow_existing_id=item_id)
    updated = []
    for item in items:
        if item.get("id") == item_id:
            updated.append(entry)
        else:
            updated.append(item)
    save_collection_file(file_name, updated)
    return entry


def remove_collection_item(file_name: str, item_id: str) -> None:
    items = load_collection_file(file_name)
    remaining = [item for item in items if item.get("id") != item_id]
    if len(remaining) == len(items):
        raise FileNotFoundError(f"Collection item not found: {item_id}")
    save_collection_file(file_name, remaining)


def get_next_collection_item_id(file_name: str) -> str:
    return uuid.uuid4().hex[:4]


def validate_collection_entry(entry: dict, existing_items: list[dict] | None = None, allow_existing_id: str | None = None) -> None:
    if not isinstance(entry, dict):
        raise ConfigError("Collection entry must be a JSON object")

    for key in ("id", "url", "folder"):
        if key not in entry or not entry[key]:
            raise ConfigError(f"Collection entry must include '{key}'")

    if "cookie_file" in entry and entry["cookie_file"] not in config_manager.data["cookie_files"]:
        raise ConfigError(f"Unknown cookie_file key: {entry['cookie_file']}")

    if existing_items is not None:
        for existing in existing_items:
            if existing.get("id") == entry["id"] and entry["id"] != allow_existing_id:
                raise ConfigError(f"Collection item id must be unique: {entry['id']}")
