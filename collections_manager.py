import json
import uuid
import tempfile
from pathlib import Path

from config import COLLECTIONS_DIR, config_manager, ConfigError


def collection_file_path(file_name: str) -> Path:
    return COLLECTIONS_DIR / file_name


def load_collection_file(file_name: str) -> dict:
    """Load collection file and return dict with 'cookie_file', 'items', 'sort_by', and 'sort_direction'."""
    path = collection_file_path(file_name)
    if not path.exists():
        raise FileNotFoundError(f"Collection file not found: {file_name}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    
    # Handle migration: convert old list format to new object format
    if isinstance(data, list):
        # Old format: plain array of items
        # Migrate to new format with cookie_file at collection level
        migrated_data = {
            "cookie_file": None,
            "items": data,
            "sort_by": "custom",
            "sort_direction": "asc"
        }
        # Extract cookie_file from first item if present (assume all items use same cookie)
        if data and "cookie_file" in data[0]:
            migrated_data["cookie_file"] = data[0]["cookie_file"]
        # Remove cookie_file from individual items
        for item in migrated_data["items"]:
            if "cookie_file" in item:
                del item["cookie_file"]
        # Save migrated format
        save_collection_file(file_name, migrated_data)
        return migrated_data
    
    if not isinstance(data, dict):
        raise ConfigError(f"Collection file must contain a JSON object: {file_name}")
    
    if "items" not in data or not isinstance(data["items"], list):
        raise ConfigError(f"Collection file must contain 'items' array: {file_name}")
    
    # Apply defaults for sort_by and sort_direction if missing (forward compatibility)
    if "sort_by" not in data:
        data["sort_by"] = "custom"
    if "sort_direction" not in data:
        data["sort_direction"] = "asc"
    
    return data


def save_collection_file(file_name: str, data: dict) -> None:
    """Save collection file in new object format using atomic writes."""
    path = collection_file_path(file_name)
    
    # Write to a temporary file first to ensure atomicity
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
            suffix=".json"
        ) as tmp:
            json.dump(data, tmp, indent=2)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        
        # Atomically replace the original file
        tmp_path.replace(path)
    except Exception:
        # Clean up temp file if replacement failed
        if tmp_path.exists():
            tmp_path.unlink()
        raise


def reorder_collection_items(file_name: str, ordered_ids: list[str]) -> None:
    """Reorder collection items according to the specified ID sequence."""
    data = load_collection_file(file_name)
    items = data.get("items", [])
    
    # Create a mapping of id -> item for quick lookup
    id_to_item = {item.get("id"): item for item in items}
    
    # Rebuild items array in the specified order
    reordered_items = []
    for item_id in ordered_ids:
        if item_id in id_to_item:
            reordered_items.append(id_to_item[item_id])
    
    # Add any items that weren't in ordered_ids (shouldn't happen, but be safe)
    for item in items:
        if item.get("id") not in ordered_ids:
            reordered_items.append(item)
    
    data["items"] = reordered_items
    save_collection_file(file_name, data)


def update_collection_sort_prefs(file_name: str, sort_by: str, sort_direction: str) -> None:
    """Update sorting preferences for a collection file."""
    # Validate inputs
    valid_sort_by = ["id", "name", "folder", "custom"]
    valid_sort_direction = ["asc", "desc"]
    
    if sort_by not in valid_sort_by:
        raise ConfigError(f"Invalid sort_by value: {sort_by}. Must be one of {valid_sort_by}")
    if sort_direction not in valid_sort_direction:
        raise ConfigError(f"Invalid sort_direction value: {sort_direction}. Must be one of {valid_sort_direction}")
    
    data = load_collection_file(file_name)
    data["sort_by"] = sort_by
    data["sort_direction"] = sort_direction
    save_collection_file(file_name, data)


def get_collection_item(file_name: str, item_id: str) -> dict | None:
    data = load_collection_file(file_name)
    items = data.get("items", [])
    return next((item for item in items if item.get("id") == item_id), None)


def add_collection_item(file_name: str, entry: dict) -> dict:
    data = load_collection_file(file_name)
    items = data.get("items", [])
    validate_collection_entry(entry, items)
    items.append(entry)
    data["items"] = items
    save_collection_file(file_name, data)
    return entry


def update_collection_item(file_name: str, item_id: str, entry: dict) -> dict:
    data = load_collection_file(file_name)
    items = data.get("items", [])
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
    data["items"] = updated
    save_collection_file(file_name, data)
    return entry


def remove_collection_item(file_name: str, item_id: str) -> None:
    data = load_collection_file(file_name)
    items = data.get("items", [])
    remaining = [item for item in items if item.get("id") != item_id]
    if len(remaining) == len(items):
        raise FileNotFoundError(f"Collection item not found: {item_id}")
    data["items"] = remaining
    save_collection_file(file_name, data)


def get_next_collection_item_id(file_name: str) -> str:
    return uuid.uuid4().hex[:4]


def validate_collection_entry(entry: dict, existing_items: list[dict] | None = None, allow_existing_id: str | None = None) -> None:
    if not isinstance(entry, dict):
        raise ConfigError("Collection entry must be a JSON object")

    for key in ("id", "url", "folder"):
        if key not in entry or not entry[key]:
            raise ConfigError(f"Collection entry must include '{key}'")

    # cookie_file is no longer allowed at entry level
    if "cookie_file" in entry:
        raise ConfigError("cookie_file must be set at collection level, not on individual items")

    if existing_items is not None:
        for existing in existing_items:
            if existing.get("id") == entry["id"] and entry["id"] != allow_existing_id:
                raise ConfigError(f"Collection item id must be unique: {entry['id']}")


def get_collection_cookie_file(file_name: str) -> str | None:
    """Get the cookie file assigned to this collection."""
    data = load_collection_file(file_name)
    return data.get("cookie_file")


def set_collection_cookie_file(file_name: str, cookie_file: str | None) -> None:
    """Set or clear the cookie file for this collection."""
    data = load_collection_file(file_name)
    if cookie_file is None:
        data["cookie_file"] = None
    else:
        # Validate that the cookie file exists
        try:
            config_manager.get_cookie_path(cookie_file)
        except ConfigError:
            raise ConfigError(f"Unknown cookie file: {cookie_file}")
        data["cookie_file"] = cookie_file
    save_collection_file(file_name, data)
