"""Teslim / on kontrol yuklemesini tek bir ZIP baytina cevirir.

Ogrenci ya tek bir .zip yukler (eskisi gibi) ya da normal dosyalar / bir klasor
secer. Ikinci durumda dosyalar (tarayicinin gonderdigi goreli yollarla) bellekte
ZIP'e paketlenir; ardindan her iki yol da ayni guvenli acma adimindan
(extract_zip: yol, boyut, dosya sayisi korumalari) gecer.
"""
from __future__ import annotations

import io
import posixpath
import zipfile

from fastapi import HTTPException, UploadFile

from app.config import settings


def _clean_name(raw: str | None) -> str:
    name = (raw or "").replace("\\", "/").strip()
    if len(name) >= 2 and name[1] == ":":  # C:/... gibi surucu harfi
        name = name[2:]
    return name.lstrip("/")


def read_upload(file: UploadFile | None, files: list[UploadFile] | None) -> bytes:
    uploads = [u for u in [file, *(files or [])] if u is not None]
    if not uploads:
        raise HTTPException(status_code=400, detail="Dosya seçilmedi.")

    # Tek ZIP: oldugu gibi (acma adimi ayrica dogrular)
    if len(uploads) == 1 and (uploads[0].filename or "").lower().endswith(".zip"):
        data = uploads[0].file.read(settings.max_zip_bytes + 1)
        if not data:
            raise HTTPException(status_code=400, detail="Boş dosya.")
        return data

    if len(uploads) > settings.max_files:
        raise HTTPException(status_code=400, detail=f"Çok fazla dosya. Sınır: {settings.max_files} dosya.")

    limit_mb = settings.max_zip_bytes // (1024 * 1024)
    total = 0
    seen: set[str] = set()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for u in uploads:
            name = _clean_name(u.filename)
            if not name:
                continue
            raw = u.file.read(settings.max_zip_bytes + 1)
            total += len(raw)
            if total > settings.max_zip_bytes:
                raise HTTPException(status_code=400, detail=f"Dosyalar toplamda en fazla {limit_mb} MB olabilir.")
            # Ayni adla iki dosya gelirse ikincisini yeniden adlandir
            base, ext = posixpath.splitext(name)
            unique, n = name, 2
            while unique.lower() in seen:
                unique, n = f"{base} ({n}){ext}", n + 1
            seen.add(unique.lower())
            z.writestr(unique, raw)
    if total == 0:
        raise HTTPException(status_code=400, detail="Boş dosya.")
    return buf.getvalue()
