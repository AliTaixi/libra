"""Router for per-user shared file operations.

User-data is now per-user (shared across all threads) and flat
(no workspace/uploads/outputs subdirectories).
"""

import logging
import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel

from app.gateway.authz import require_permission
from app.gateway.deps import get_config
from deerflow.config.app_config import AppConfig
from deerflow.config.paths import get_paths
from deerflow.runtime.user_context import get_effective_user_id
from deerflow.uploads.manager import (
    PathTraversalError,
    delete_file_safe,
    list_files_in_dir,
    normalize_filename,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/user/files", tags=["user-files"])

ACTIVE_CONTENT_MIME_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
}


def _build_content_disposition(disposition_type: str, filename: str) -> str:
    """Build an RFC 5987 encoded Content-Disposition header value."""
    return f"{disposition_type}; filename*=UTF-8''{quote(filename)}"


def is_text_file_by_content(path: Path, sample_size: int = 8192) -> bool:
    """Check if file is text by examining content for null bytes."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(sample_size)
            return b"\x00" not in chunk
    except Exception:
        return False


@router.get("")
@require_permission("threads", "read")
async def list_user_files(request: Request) -> dict:
    """List all files in the current user's shared user-data directory."""
    user_id = get_effective_user_id()
    user_data_dir = get_paths().user_data_dir(user_id)

    if not user_data_dir.is_dir():
        return {"files": [], "count": 0}

    result = list_files_in_dir(user_data_dir)

    # Add download URL for each file (no thread_id needed for user-level API)
    for f in result["files"]:
        filename = f["filename"]
        f["size"] = str(f["size"])
        f["virtual_path"] = f"/mnt/user-data/{filename}"
        f["download_url"] = f"/api/user/files/{quote(filename, safe='')}"

    return result


@router.get("/{filename}")
@require_permission("threads", "read")
async def get_user_file(filename: str, request: Request, download: bool = False) -> Response:
    """View or download a file from the current user's shared user-data."""
    user_id = get_effective_user_id()
    user_data_dir = get_paths().user_data_dir(user_id)
    file_path = (user_data_dir / filename).resolve()

    # Path traversal check
    try:
        file_path.relative_to(user_data_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail=f"Not a file: {filename}")

    mime_type, _ = mimetypes.guess_type(file_path)

    if download:
        return FileResponse(
            path=file_path,
            filename=file_path.name,
            media_type=mime_type,
            headers={"Content-Disposition": _build_content_disposition("attachment", file_path.name)},
        )

    # Force download for active content types
    if mime_type in ACTIVE_CONTENT_MIME_TYPES:
        return FileResponse(
            path=file_path,
            filename=file_path.name,
            media_type=mime_type,
            headers={"Content-Disposition": _build_content_disposition("attachment", file_path.name)},
        )

    if mime_type and mime_type.startswith("text/"):
        return PlainTextResponse(content=file_path.read_text(encoding="utf-8"), media_type=mime_type)

    if is_text_file_by_content(file_path):
        return PlainTextResponse(content=file_path.read_text(encoding="utf-8"), media_type=mime_type)

    return Response(
        content=file_path.read_bytes(),
        media_type=mime_type,
        headers={"Content-Disposition": _build_content_disposition("inline", file_path.name)},
    )


class SaveFileRequest(BaseModel):
    filename: str
    content: str


@router.put("/{filename}")
@require_permission("threads", "write")
async def save_user_file(filename: str, req: SaveFileRequest) -> dict:
    """保存文件到用户数据目录（供 draw.io 等编辑器使用）。"""
    user_id = get_effective_user_id()
    user_data_dir = get_paths().user_data_dir(user_id)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    safe_name = normalize_filename(filename)
    file_path = user_data_dir / safe_name
    try:
        file_path.write_text(req.content, encoding="utf-8")
        logger.info("Saved file %s for user %s", safe_name, user_id)
        return {"success": True, "filename": safe_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")


@router.delete("/{filename}")
@require_permission("threads", "delete")
async def delete_user_file(filename: str, request: Request) -> dict:
    """Delete a file from the current user's shared user-data directory."""
    from deerflow.utils.file_conversion import CONVERTIBLE_EXTENSIONS

    user_id = get_effective_user_id()
    user_data_dir = get_paths().user_data_dir(user_id)

    if not user_data_dir.is_dir():
        raise HTTPException(status_code=404, detail="User data directory not found")

    try:
        return delete_file_safe(user_data_dir, filename, convertible_extensions=CONVERTIBLE_EXTENSIONS)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    except PathTraversalError:
        raise HTTPException(status_code=400, detail="Invalid path")
    except Exception as e:
        logger.error(f"Failed to delete {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete {filename}: {str(e)}")
