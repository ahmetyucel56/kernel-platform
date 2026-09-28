"""Guvenli ZIP acma ve dosya agaci cikarma.

Korumalar:
- Path traversal ('..', mutlak yollar) reddedilir.
- Symlink girdileri atlanir.
- Toplam acilmis boyut ve dosya sayisi sinirlandirilir (zip-bomb).
- Buyuk/binary dosyalarin icerigi DB'ye yazilmaz (yalnizca metadata).
- Gurultu dizinleri (node_modules, .git, __pycache__ vb.) atlanir.
"""
from __future__ import annotations

import io
import posixpath
import stat
import zipfile
from dataclasses import dataclass

from app.config import settings
from app.lib import documents

# Icerigi saklanmayacak / atlanacak dizin adlari.
_SKIP_DIRS = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    "__MACOSX",
    ".idea",
    ".vscode",
    "dist",
    "build",
}


class ZipExtractError(ValueError):
    """Yukleme dogrulama/guvenlik hatasi (kullaniciya 400 olarak doner)."""


@dataclass
class ExtractedFile:
    path: str  # POSIX, ornek: "src/app.py"
    content: str | None  # metin ise icerik; binary/cok-buyuk ise None
    size_bytes: int
    is_binary: bool
    extracted_text: str | None = None  # PDF/DOCX metni


def _is_safe_path(name: str) -> bool:
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    # Windows surucu harfi (C:\) vb.
    if len(name) >= 2 and name[1] == ":":
        return False
    normalized = posixpath.normpath(name)
    if normalized.startswith("..") or "/../" in normalized or normalized == "..":
        return False
    return True


def _skip(name: str) -> bool:
    parts = name.split("/")
    return any(p in _SKIP_DIRS for p in parts)


def _detect_and_decode(raw: bytes) -> tuple[str | None, bool]:
    """(content, is_binary) dondurur. Null byte iceren veya cozulemeyen -> binary."""
    if b"\x00" in raw:
        return None, True
    try:
        return raw.decode("utf-8"), False
    except UnicodeDecodeError:
        try:
            return raw.decode("latin-1"), False
        except Exception:
            return None, True


def _build_tree(files: list[ExtractedFile]) -> dict:
    """Duz dosya listesinden ic ice dosya agaci (UI icin) uretir."""
    root: dict = {"name": "", "type": "dir", "children": {}}
    for f in files:
        parts = f.path.split("/")
        node = root
        for i, part in enumerate(parts):
            is_leaf = i == len(parts) - 1
            children = node["children"]
            if is_leaf:
                children[part] = {
                    "name": part,
                    "type": "file",
                    "path": f.path,
                    "size_bytes": f.size_bytes,
                    "is_binary": f.is_binary,
                }
            else:
                if part not in children:
                    children[part] = {"name": part, "type": "dir", "children": {}}
                node = children[part]
    return root


def extract_zip(data: bytes) -> tuple[list[ExtractedFile], dict]:
    """ZIP baytlarini guvenli sekilde acar; (dosyalar, agac) dondurur."""
    if len(data) > settings.max_zip_bytes:
        raise ZipExtractError(
            f"ZIP cok buyuk ({len(data)} bayt). Sinir: {settings.max_zip_bytes} bayt."
        )
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ZipExtractError("Gecerli bir ZIP dosyasi degil.")

    infos = [i for i in zf.infolist() if not i.is_dir()]

    # Zip-bomb: acilmis toplam boyutu ONCEDEN dogrula.
    total_uncompressed = sum(i.file_size for i in infos)
    if total_uncompressed > settings.max_uncompressed_bytes:
        raise ZipExtractError(
            "Acilmis toplam boyut cok buyuk. "
            f"Sinir: {settings.max_uncompressed_bytes} bayt."
        )

    files: list[ExtractedFile] = []
    count = 0
    for info in infos:
        name = info.filename.replace("\\", "/")

        # Symlink girdilerini atla.
        mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            continue

        if not _is_safe_path(name):
            raise ZipExtractError(f"Güvenli olmayan dosya yolu: {info.filename!r}")

        if _skip(name):
            continue

        count += 1
        if count > settings.max_files:
            raise ZipExtractError(
                f"Cok fazla dosya. Sinir: {settings.max_files} dosya."
            )

        path = posixpath.normpath(name)
        raw = zf.read(info)

        if documents.ext_of(path) in documents.DOC_EXT:
            # Belge: ikili saklanır, metni çıkarılır (yapay zekâ kontrolü için)
            files.append(ExtractedFile(path=path, content=None, size_bytes=info.file_size, is_binary=True,
                                       extracted_text=documents.extract_text(path, raw)))
            continue

        if info.file_size > settings.max_text_file_bytes:
            # Cok buyuk: icerik saklama, yalnizca metadata.
            files.append(
                ExtractedFile(path=path, content=None, size_bytes=info.file_size,
                              is_binary=False)
            )
            continue

        content, is_binary = _detect_and_decode(raw)
        files.append(
            ExtractedFile(
                path=path,
                content=None if is_binary else content,
                size_bytes=info.file_size,
                is_binary=is_binary,
            )
        )

    if not files:
        raise ZipExtractError("Yüklenenler arasında işlenebilir dosya bulunamadı.")

    files.sort(key=lambda f: f.path)
    tree = _build_tree(files)
    return files, tree
