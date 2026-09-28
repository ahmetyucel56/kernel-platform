"""Belge ve görsel teslimleri: metin çıkarma, önizleme (PDF sayfası -> PNG, DOCX -> bloklar).

Güvenlik:
- Belgeler hiçbir zaman çalıştırılmaz; PDF yalnızca PDFium ile görüntüye çevrilir.
- DOCX'ten HTML sayfaya ENJEKTE EDİLMEZ: yalnızca başlık/paragraf/liste/tablo/görsel
  bloklarına çevrilip istemcide doğal olarak çizilir (betik, bağlantı vb. taşınmaz).
- Önizlemede yalnızca raster görseller (PNG/JPEG/GIF/WebP); SVG gibi içine kod
  gömülebilen türler gösterilmez.
"""
from __future__ import annotations

import io
import posixpath
from html.parser import HTMLParser

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
DOC_EXT = {".pdf", ".docx"}
# "Rapor / belge" türündeki ödevlerde kabul edilen uzantılar
DOCUMENT_KIND_EXT = DOC_EXT | set(IMAGE_TYPES) | {".txt", ".md"}

MAX_TEXT = 200_000          # bir belgeden çıkarılan en fazla metin (karakter)
MAX_PDF_PAGES = 60          # önizleme ve metin için en fazla sayfa
MAX_INLINE_IMAGE = 1_500_000  # DOCX içindeki tek görsel için en fazla boyut (bayt)


def document_kind_error(paths: list[str]) -> str | None:
    """"Rapor / belge" ödevinde kabul edilmeyen dosya varsa kullanıcıya gösterilecek mesaj."""
    bad = sorted({ext_of(p) or posixpath.basename(p) for p in paths if ext_of(p) not in DOCUMENT_KIND_EXT})
    if not bad:
        return None
    return ("Bu ödev bir rapor/belge ödevi: yalnızca PDF, DOCX, görsel (PNG, JPG, GIF, WebP) ve TXT/MD "
            f"yüklenebilir. Kabul edilmeyen: {', '.join(bad[:6])}")


def ext_of(path: str) -> str:
    return posixpath.splitext(path.lower())[1]


def preview_kind(path: str) -> str:
    e = ext_of(path)
    if e in IMAGE_TYPES:
        return "image"
    if e == ".pdf":
        return "pdf"
    if e == ".docx":
        return "docx"
    return "none"


# ---------------------------------------------------------------- metin çıkarma
def pdf_text(raw: bytes) -> str | None:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(raw)
    except Exception:
        return None
    parts, total = [], 0
    try:
        for i in range(min(len(pdf), MAX_PDF_PAGES)):
            page = pdf[i]
            tp = page.get_textpage()
            text = tp.get_text_range().replace("\r\n", "\n").strip()
            tp.close()
            page.close()
            block = f"[Sayfa {i + 1}]\n{text}\n"
            parts.append(block)
            total += len(block)
            if total > MAX_TEXT:
                break
    finally:
        pdf.close()
    out = "\n".join(parts)[:MAX_TEXT].strip()
    return out or None


def docx_text(raw: bytes) -> str | None:
    import mammoth

    try:
        res = mammoth.extract_raw_text(io.BytesIO(raw))
    except Exception:
        return None
    text = (res.value or "").strip()
    return text[:MAX_TEXT] or None


def extract_text(path: str, raw: bytes) -> str | None:
    e = ext_of(path)
    if e == ".pdf":
        return pdf_text(raw)
    if e == ".docx":
        return docx_text(raw)
    return None


# ---------------------------------------------------------------- önizleme
def pdf_page_count(raw: bytes) -> int:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(raw)
    try:
        return len(pdf)
    finally:
        pdf.close()


def pdf_page_png(raw: bytes, index: int, width: int = 1100) -> tuple[bytes, int, int]:
    """PDF'in bir sayfasını PNG'ye çevirir; (png, genişlik, yükseklik)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(raw)
    try:
        page = pdf[index]
        w_pt, _h_pt = page.get_size()
        img = page.render(scale=width / max(w_pt, 1)).to_pil().convert("RGB")
        page.close()
    finally:
        pdf.close()
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue(), img.width, img.height


def pdf_page_sizes(raw: bytes, width: int = 1100) -> list[tuple[int, int]]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(raw)
    try:
        out = []
        for i in range(min(len(pdf), MAX_PDF_PAGES)):
            w, h = pdf.get_page_size(i)
            out.append((width, int(round(h * width / max(w, 1)))))
        return out
    finally:
        pdf.close()


def image_size(raw: bytes) -> tuple[int, int] | None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(raw)) as im:
            return im.width, im.height
    except Exception:
        return None


class _BlockParser(HTMLParser):
    """mammoth HTML çıktısını güvenli bloklara çevirir (yalnızca metin + görsel veri adresi)."""

    HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 3, "h5": 3, "h6": 3}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.cur: dict | None = None
        self.runs: list[dict] = []
        self.bold = self.italic = 0
        self.list_stack: list[str] = []
        self.table: list[list[str]] | None = None
        self.cell: list[str] | None = None

    def _start_block(self, kind: str, **extra):
        self._end_block()
        self.cur = {"t": kind, **extra}
        self.runs = []

    def _end_block(self):
        if self.cur is not None:
            runs = [r for r in self.runs if r["s"]]
            if runs:
                # bitişik aynı biçimli parçaları birleştir
                merged = []
                for r in runs:
                    if merged and merged[-1]["b"] == r["b"] and merged[-1]["i"] == r["i"]:
                        merged[-1]["s"] += r["s"]
                    else:
                        merged.append(dict(r))
                self.cur["runs"] = merged
                self.blocks.append(self.cur)
        self.cur = None
        self.runs = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.HEADINGS:
            self._start_block("h", level=self.HEADINGS[tag])
        elif tag == "p" and self.table is None:
            self._start_block("p")
        elif tag in ("ul", "ol"):
            self._end_block()
            self.list_stack.append(tag)
        elif tag == "li":
            self._start_block("li", ordered=bool(self.list_stack and self.list_stack[-1] == "ol"),
                              depth=max(0, len(self.list_stack) - 1))
        elif tag in ("strong", "b"):
            self.bold += 1
        elif tag in ("em", "i"):
            self.italic += 1
        elif tag == "table":
            self._end_block()
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.table.append([])
        elif tag in ("td", "th") and self.table is not None:
            self.cell = []
        elif tag == "br":
            self._text("\n")
        elif tag == "img":
            src = a.get("src") or ""
            if src.startswith("data:image/") and ";base64," in src and len(src) <= MAX_INLINE_IMAGE * 4 // 3:
                mime = src[5:src.index(";")]
                if mime in ("image/png", "image/jpeg", "image/gif", "image/webp"):
                    self._end_block()
                    self.blocks.append({"t": "img", "src": src})

    def handle_endtag(self, tag):
        if tag in self.HEADINGS or tag in ("p", "li"):
            if self.table is None:
                self._end_block()
        elif tag in ("ul", "ol"):
            self._end_block()
            if self.list_stack:
                self.list_stack.pop()
        elif tag in ("strong", "b"):
            self.bold = max(0, self.bold - 1)
        elif tag in ("em", "i"):
            self.italic = max(0, self.italic - 1)
        elif tag in ("td", "th") and self.table is not None and self.cell is not None:
            if self.table:
                self.table[-1].append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "table" and self.table is not None:
            rows = [r for r in self.table if any(c.strip() for c in r)]
            if rows:
                self.blocks.append({"t": "table", "rows": rows[:200]})
            self.table = None

    def _text(self, data):
        if self.cell is not None:
            self.cell.append(data)
            return
        if self.cur is None:
            if not data.strip():
                return
            self._start_block("p")
        self.runs.append({"s": data, "b": self.bold > 0, "i": self.italic > 0})

    def handle_data(self, data):
        self._text(data)


def docx_blocks(raw: bytes, max_blocks: int = 1500) -> list[dict]:
    import mammoth

    res = mammoth.convert_to_html(io.BytesIO(raw))
    p = _BlockParser()
    p.feed(res.value or "")
    p.close()
    p._end_block()
    return p.blocks[:max_blocks]
