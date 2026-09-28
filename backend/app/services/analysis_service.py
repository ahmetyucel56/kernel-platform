"""AI analiz motoru mantigi (Sprint 3).

Tum AI cagrilari ai_service (get_ai_provider) uzerinden gecer. Iki mod:

- AI_PROVIDER=anthropic  -> gercek Claude'a JSON isteyen prompt gonderilir,
  cevap parse edilir. (Ucuz model config'ten; kod degismez.)
- AI_PROVIDER=mock        -> API anahtari gerektirmeyen, GERCEK verilere dayali
  sezgisel (heuristic) analizler uretir. Ozellikle intihal, difflib ile gercek
  bir yapisal benzerlik hesaplar (spec Bolum 7.2 "basit karsilastirma ile basla").

Cikti sozlesmesi: her analiz {"summary": {...}, "detail": {...}} dondurur;
intihal ayrica "matches": [{submission_id, similarity, reason}] ekler.
"""
from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass

from app.config import settings
from app.services.ai_service import get_ai_provider

# Analiz turleri
CLEAN_CODE = "clean_code"
REQUIREMENT_CHECK = "requirement_check"
PLAGIARISM = "plagiarism"
README_DRAFT = "readme_draft"  # kaldirildi; yalnizca eski kayitlari tanimak icin

# Benzerlik uyari esigi (%). Uygulamanin her yerinde bu tek deger kullanilir.
# Demo sinifinda durust ogrenci ciftleri en fazla ~%43, kopya cifti %100.
SIMILARITY_WARN = 70
CLASS_SUMMARY = "class_summary"

_CODE_EXT = {".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".c", ".cpp", ".cs",
             ".go", ".rs", ".rb", ".php", ".kt", ".swift"}


@dataclass
class FileBlob:
    path: str
    content: str


# ---------------------------------------------------------------------------
# Yardimcilar
# ---------------------------------------------------------------------------
def _code_files(files: list[FileBlob]) -> list[FileBlob]:
    return [f for f in files if any(f.path.lower().endswith(e) for e in _CODE_EXT) and f.content]


def _report_files(files: list[FileBlob]) -> list[FileBlob]:
    """Rapor/belge teslimleri: PDF ve DOCX'ten çıkarılmış metin ile düz metin dosyaları."""
    return [f for f in files if f.content and f.path.lower().endswith((".pdf", ".docx", ".txt"))]


def _doc_files(files: list[FileBlob]) -> list[FileBlob]:
    """README ve metin dokumantasyonu (gereksinim kontrolunde 'README olmali' gibi maddeler icin)."""
    return [f for f in files if f.content and (
        f.path.lower().rsplit("/", 1)[-1].startswith("readme")
        or f.path.lower().endswith((".md", ".rst"))
    )]


# Bir dosyanin "imzasi": fonksiyon/sinif tanimlari, dekoratorler, route kayitlari.
_OUTLINE_RE = re.compile(
    r"^\s*("
    r"@[\w.]+.*"                                                   # @app.get("/x"), @dataclass
    r"|(async\s+)?def\s+\w+.*"                                     # python
    r"|class\s+\w+.*"
    r"|(export\s+)?(default\s+)?(async\s+)?function\s*\w*\s*\(.*"  # js/ts
    r"|(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?(\(|function).*"
    r"|(app|router|route|server|api)\.(get|post|put|patch|delete|use|route)\s*\(.*"
    r"|(public|private|protected|internal|static)\s+[\w<>\[\],.?\s]*\w+\s*\(.*"  # java/c#/php
    r"|(func|fn)\s+\w+.*"                                          # go/rust
    r")$"
)
_ENTRY_HINTS = ("main.", "app.", "index.", "server.", "route", "controller", "api", "view",
                "model", "service", "handler", "urls.")


def _outline(f: FileBlob, max_lines: int = 40) -> str:
    lines = [ln.strip()[:160] for ln in (f.content or "").splitlines() if _OUTLINE_RE.match(ln)]
    if not lines:
        return ""
    more = f"\n  … (+{len(lines) - max_lines} satir)" if len(lines) > max_lines else ""
    return f"### {f.path} [yalnizca imzalar]\n" + "\n".join(lines[:max_lines]) + more + "\n"


def _relevance(f: FileBlob, words: list[str]) -> float:
    text = (f.path + "\n" + (f.content or "")).lower()
    score = sum(2.0 for w in words if _term_hits(w, text))
    name = f.path.lower().rsplit("/", 1)[-1]
    if any(h in name for h in _ENTRY_HINTS):
        score += 1.5
    if "test" in f.path.lower():
        score -= 0.5  # test dosyalari genelde kurali "gerceklestiren" yer degil
    sigs = sum(1 for ln in (f.content or "").splitlines() if _OUTLINE_RE.match(ln))
    score += min(sigs, 20) * 0.05  # mantik yogunlugu
    return score


def _req_words(requirements: list[str]) -> list[str]:
    words: set[str] = set()
    for req in requirements:
        for w in re.findall(r"[a-z_]+", req.lower().translate(_TR_ASCII)):
            if len(w) > 3 and w not in _STOP and not _is_generic(w):
                words.add(w)
    return sorted(words)


def _requirement_context(code: list[FileBlob], requirements: list[str],
                         budget: int = 16000, outline_budget: int = 6000) -> tuple[str, int]:
    """Kurallarla en ilgili dosyalar TAM icerikle, sigmayanlar IMZA olarak verilir.

    Buyuk projelerde dosyalari siraya gore kesmek, ilgili kodun AI'ya hic
    ulasmamasina (ve yanlislikla 'eksik' denmesine) yol acar. Doner: (metin,
    yalnizca imzasi verilen dosya sayisi)."""
    words = _req_words(requirements)
    ranked = sorted(code, key=lambda f: -_relevance(f, words))
    parts, used, rest = [], 0, []
    for f in ranked:
        block = f"### {f.path}\n{f.content}\n"
        room = budget - used
        if len(block) <= room:
            parts.append(block)
            used += len(block)
        elif room >= 3000:
            # Buyuk ve ilgili dosya: basi tam, geri kalani imza olarak
            parts.append(block[:room - 200] + "\n… [dosya kesildi; devami imzalarda]\n")
            used = budget
            rest.append(f)
        else:
            rest.append(f)
    outlined, oused = 0, 0
    for f in rest:
        o = _outline(f)
        if not o or oused + len(o) > outline_budget:
            continue
        parts.append(o)
        oused += len(o)
        outlined += 1
    return "\n".join(parts), outlined


def _context(files: list[FileBlob], budget: int = 12000) -> str:
    """Prompt icin dosya iceriklerini butcelenmis sekilde birlestirir."""
    parts, total = [], 0
    for f in files:
        if not f.content:
            continue
        block = f"### {f.path}\n{f.content}\n"
        if total + len(block) > budget:
            block = block[: max(0, budget - total)]
        parts.append(block)
        total += len(block)
        if total >= budget:
            break
    return "\n".join(parts)


def _normalize_code(text: str) -> list[str]:
    """Intihal icin kaba yapisal normalizasyon: yorumlar/stringler/degisken
    adlari elenir, anahtar yapi korunur. difflib ile karsilastirilir."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        # tek satir yorumlar
        s = re.sub(r"(#|//).*$", "", s).strip()
        if not s:
            continue
        # string literaller -> STR
        s = re.sub(r"(\"[^\"]*\"|'[^']*')", "STR", s)
        # sayilar -> NUM
        s = re.sub(r"\b\d+(\.\d+)?\b", "NUM", s)
        # tanimlayicilar -> ID (anahtar kelimeler haric)
        keywords = {
            "def", "class", "return", "if", "else", "elif", "for", "while", "import",
            "from", "try", "except", "finally", "with", "as", "in", "and", "or", "not",
            "function", "const", "let", "var", "new", "public", "private", "static",
            "void", "int", "str", "float", "bool", "true", "false", "null", "None",
        }
        def repl(m):
            w = m.group(0)
            return w if w in keywords else "ID"
        s = re.sub(r"[A-Za-z_]\w*", repl, s)
        s = re.sub(r"\s+", " ", s).strip()
        out.append(s)
    return out


class AIUnavailable(RuntimeError):
    """Gercek AI modunda gecerli bir cevap alinamadi.

    Sezgisel (mock) sonuc AI sonucu gibi KAYDEDILMEZ; cagiran taraf kullaniciya
    "tekrar dene" der ve hicbir sey saklamaz.
    """


_JSON_RETRY_HINT = (
    "\n\nONEMLI: Yalnizca tek bir GECERLI JSON nesnesi dondur. Metin alanlarinda kod "
    "blogu, ters tirnak veya satir sonu kullanma; cift tirnaklari kacir. Kisa yaz."
)


def _extract_json(raw: str) -> dict | None:
    """Cevaptaki ilk TAM JSON nesnesini okur (```json cit'leri ve oncesi/sonrasi metin tolere edilir)."""
    text = re.sub(r"```(?:json)?", "", raw or "")
    decoder = json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[m.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def _ask_json(system: str, prompt: str, max_tokens: int = 1500, required: str | None = None) -> dict:
    """Gercek saglayicidan JSON ister; gecersiz/eksikse bir kez daha genis butce ve
    'yalnizca gecerli JSON' uyarisiyla dener. Yine olmazsa AIUnavailable (sessiz yedek YOK)."""
    last = "bilinmeyen hata"
    for attempt in range(2):
        try:
            raw = get_ai_provider().complete(
                system + (_JSON_RETRY_HINT if attempt else ""), prompt,
                max_tokens=int(max_tokens * (1.6 if attempt else 1)),
            )
        except Exception as exc:  # ag / oran siniri (SDK zaten geri cekilerek dener) / yetki
            last = repr(exc)
            print(f"[ai] cagri hatasi ({attempt + 1}. deneme): {last}")
            continue
        data = _extract_json(raw)
        if data is not None and (required is None or required in data):
            return data
        last = f"gecersiz veya eksik JSON ({len(raw or '')} karakter)"
        print(f"[ai] {last} ({attempt + 1}. deneme)")
    raise AIUnavailable(last)


def _use_mock() -> bool:
    return settings.ai_provider == "mock"


# ---------------------------------------------------------------------------
# 7.1 Clean Code skoru
# ---------------------------------------------------------------------------
def clean_code(files: list[FileBlob]) -> dict:
    code = _code_files(files)
    if _use_mock():
        return _clean_code_heuristic(code)

    system = (
        "Sen kidemli bir yazilim gelistiricisin. Ogrenci kodunu SOLID, modularite "
        "ve isimlendirme acisindan degerlendir. YALNIZCA su JSON semasiyla yanit ver: "
        '{"score": <0-100>, "summary": "<kisa>", "strengths": ["..."], '
        '"issues": [{"title":"...","detail":"...","severity":"low|med|high"}]}. '
        "Metinlerde kod blogu kullanma; en fazla 6 issue yaz."
    )
    data = _ask_json(system, _context(code), max_tokens=2500, required="score")
    return _wrap_clean(data)


def _clean_code_heuristic(code: list[FileBlob]) -> dict:
    if not code:
        detail = {"score": 0, "summary": "Analiz edilecek kod dosyası bulunamadı.",
                  "strengths": [], "issues": []}
        return _wrap_clean(detail)

    full = "\n".join(f.content for f in code)
    total_lines = sum(len(f.content.splitlines()) for f in code)
    comment_lines = sum(
        1 for f in code for ln in f.content.splitlines() if ln.strip().startswith(("#", "//"))
    )
    long_lines = sum(1 for f in code for ln in f.content.splitlines() if len(ln) > 100)
    comment_ratio = comment_lines / total_lines if total_lines else 0

    score = 100
    issues = []
    strengths = []

    # --- Yorum / okunabilirlik ---
    if comment_ratio < 0.03:
        score -= 10
        issues.append({"title": "Yetersiz açıklama", "severity": "med",
                       "detail": "Kodda çok az yorum var; kritik bölümlere açıklama ekleyin."})
    else:
        strengths.append("Kod makul ölçüde yorumlanmış.")

    if long_lines > 0:
        score -= min(15, long_lines * 3)
        issues.append({"title": f"{long_lines} uzun satır (>100 karakter)", "severity": "low",
                       "detail": "Uzun satırları bölerek okunabilirliği artırın."})

    # --- Modülerlik ---
    if len(code) == 1 and total_lines > 60:
        score -= 12
        issues.append({"title": "Modülerlik düşük", "severity": "med",
                       "detail": "Her şey tek dosyada; sorumlulukları ayrı modüllere bölün (SOLID)."})
    elif len(code) > 1:
        strengths.append(f"Kod {len(code)} dosyaya modülerleştirilmiş.")

    # --- Fonksiyon tanımları: isim + tip ipucu ---
    func_defs = re.findall(r"(?m)^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(->[^:]+)?:", full)
    short_named = [name for name, _params, _ret in func_defs if len(name) <= 2]
    if short_named:
        score -= min(14, len(short_named) * 7)
        issues.append({"title": "Açıklayıcı olmayan fonksiyon adları", "severity": "med",
                       "detail": f"Tek/iki harfli isimler ({', '.join(short_named[:4])}) yerine "
                                 "ne yaptığını anlatan isimler kullanın."})

    py_funcs = [(n, p, r) for n, p, r in func_defs]
    if py_funcs:
        typed = sum(1 for _n, p, r in py_funcs if (":" in p) or r)
        if typed == 0:
            score -= 12
            issues.append({"title": "Tip ipuçları yok", "severity": "med",
                           "detail": "Fonksiyon parametre ve dönüş tiplerini belirtin "
                                     "(def f(x: int) -> str)."})
        elif typed == len(py_funcs):
            strengths.append("Fonksiyonlar tip ipuçlarıyla yazılmış.")

    # --- Global durum (yan etki) ---
    global_count = len(re.findall(r"(?m)^\s*global\s+\w+", full))
    if global_count:
        score -= min(14, global_count * 8)
        issues.append({"title": "Global durum kullanımı", "severity": "high",
                       "detail": "`global` ile paylaşılan durum yan etki ve test zorluğu üretir; "
                                 "değeri parametre/return ile taşıyın."})

    # --- Anlamsız / gereksiz koşullar ---
    redundant = len(re.findall(r"\b(and\s+True|or\s+False|==\s*True|==\s*False|!=\s*True)\b", full))
    if redundant:
        score -= min(10, redundant * 5)
        issues.append({"title": "Gereksiz mantıksal ifadeler", "severity": "low",
                       "detail": "`and True`, `== True` gibi gereksiz ifadeleri sadeleştirin."})

    # --- print ile hata ayıklama izleri ---
    if len(re.findall(r"\bprint\s*\(", full)) >= 3:
        score -= 5
        issues.append({"title": "Çok sayıda print", "severity": "low",
                       "detail": "Hata ayıklama print'leri yerine loglama kullanın veya temizleyin."})

    score = max(15, min(100, round(score)))
    summary = f"{len(code)} kod dosyası, ~{total_lines} satır incelendi. Genel Clean Code skoru: {score}/100."
    detail = {"score": score, "summary": summary,
              "strengths": strengths or ["Temel yapı anlaşılır."], "issues": issues}
    return _wrap_clean(detail)


def _wrap_clean(detail: dict) -> dict:
    try:  # AI bazen "85" ya da 85.0 doner; 0-100 tamsayiya sabitle
        detail["score"] = max(0, min(100, round(float(detail.get("score", 0)))))
    except (TypeError, ValueError):
        detail["score"] = 0
    detail.setdefault("strengths", [])
    detail.setdefault("issues", [])
    detail.setdefault("summary", "")
    return {
        "summary": {
            "score": detail["score"],
            "headline": detail.get("summary", ""),
            "strengths_count": len(detail["strengths"]),
            "issues_count": len(detail["issues"]),
        },
        "detail": detail,
    }


# ---------------------------------------------------------------------------
# Serbest metinden gereksinim maddeleri cikarma (akademisyen kolayligi)
# ---------------------------------------------------------------------------
_REQ_SKIP = {
    "programda", "kullanilmasi gerekenler", "kullanilacaklar", "not", "notlar",
    "ekstra", "cikti", "ornek cikti", "gereksinimler", "aciklama", "beklenenler",
    "istenenler",
}
# Turkce karakterleri ASCII'ye indir (baslik eslestirmesi icin)
_TR_ASCII = str.maketrans("çşığüöâî", "csiguoai")


def parse_requirements(text: str) -> list[str]:
    """Serbest odev metnini, kodla tek tek kontrol edilebilir atomik maddelere ceverir."""
    if _use_mock():
        return _parse_req_heuristic(text)
    system = (
        "Verilen Turkce odev metninden, ogrencinin koduyla TEK TEK kontrol "
        "edilebilecek ATOMIK gereksinimleri cikar. Basliklari, ornek ciktiyi ve "
        "bicimlendirmeyi yok say; her maddeyi kisa ve net yaz. YALNIZCA su JSON: "
        '{"requirements": ["madde 1", "madde 2", ...]}'
    )
    try:
        data = _ask_json(system, text, required="requirements")
    except AIUnavailable:
        # Yardimci arac: sonuc hocanin duzenleyecegi metin kutusuna gider, kaydedilmez.
        return _parse_req_heuristic(text)
    reqs = data.get("requirements")
    if isinstance(reqs, list):
        cleaned = [str(r).strip() for r in reqs if str(r).strip()]
        if cleaned:
            return cleaned
    return _parse_req_heuristic(text)


def _parse_req_heuristic(text: str) -> list[str]:
    out: list[str] = []
    in_fence = False
    for raw in text.splitlines():
        s = raw.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or not s:
            continue
        # bas taraftaki numara/madde imlerini temizle
        s = re.sub(r"^\s*(\d+[\.\)]|[-*•·])\s*", "", s).strip()
        if not s:
            continue
        low = s.lower().rstrip(":").strip().translate(_TR_ASCII)
        if low in _REQ_SKIP:
            continue
        if s.startswith("=") or "=====" in s:
            continue
        # baslik gibi kisa "X:" satirlari
        if s.endswith(":") and len(s.split()) <= 3:
            continue
        # ornek cikti "Etiket: deger(sayi)" satirlari (or. "Ortalama: 73.33")
        if ":" in s:
            after = s.split(":", 1)[1].strip()
            if after and re.fullmatch(r"[\d.,\s/AA-FF]+", after) and re.search(r"\d", after):
                continue
        if len(s) < 5:
            continue
        out.append(s)
    return out


# ---------------------------------------------------------------------------
# 7.3 Gereksinim uygunluk kontrolu
# ---------------------------------------------------------------------------
def requirement_check(files: list[FileBlob], requirements: list[str]) -> dict:
    """Gereksinim kontrolu + analiz anindaki kural listesinin kaydi.

    detail.requirements: kurallar sonradan degisirse bu analizin eskidigini
    anlamak icin saklanir (bkz. requirements_changed)."""
    result = _requirement_check(files, requirements)
    result["detail"]["requirements"] = list(requirements)
    return result


def requirements_changed(detail: dict | None, current: list[str]) -> bool:
    """Analiz, su anki kural listesinden farkli kurallarla mi yapilmis?"""
    detail = detail or {}
    cur = {_norm_req(r) for r in current}
    snap = detail.get("requirements")
    if isinstance(snap, list):
        return {_norm_req(r) for r in snap} != cur
    # Eski kayitlar (snapshot yok): her guncel kural analizde yer almali
    seen = {
        _norm_req(it.get("requirement", ""))
        for k in ("met", "partial", "missing")
        for it in (detail.get(k) or [])
        if isinstance(it, dict)
    }
    return not cur.issubset(seen)


def _requirement_check(files: list[FileBlob], requirements: list[str]) -> dict:
    """Akademisyenin koydugu HER gereksinimi ogrencinin kodunda tek tek dogrular.

    Her madde icin durum: met (tam) / partial (kismen/eksik-hatali) / missing (yok),
    ilgili dosya ve kisa kanit ile. Boylece "projeyi yanlis/eksik yapma" tespiti
    madde bazinda ve kanita dayali yapilir.
    """
    code = _code_files(files)
    docs = _doc_files(files)
    reports = _report_files(files)
    if not requirements:
        return _wrap_req({"met": [], "partial": [], "missing": [],
                          "note": "Bu ödev için tanımlanmış gereksinim yok."})
    if not code and not docs and not reports:
        return _wrap_req({
            "met": [], "partial": [],
            "missing": [{"requirement": r, "note": "Analiz edilecek kod dosyası ya da okunabilir belge bulunamadı."}
                        for r in requirements],
            "note": "Kod dosyası ya da okunabilir belge yok; hiçbir gereksinim doğrulanamadı.",
        })
    if _use_mock():
        return _requirement_heuristic(code + docs + reports, requirements)
    if not code and reports:
        return _requirement_check_document(files, reports + docs, requirements)

    numbered = "\n".join(f"{i+1}. {r}" for i, r in enumerate(requirements))
    system = (
        "Sen titiz ve nesnel bir kod denetleyicisisin. Sana bir odevin GEREKSINIMLERI ve "
        "ogrencinin GERCEK kodu verilecek. Her gereksinimi kodun icinde TEK TEK ara ve "
        "kanita dayali karar ver. KURALLAR: "
        "(1) Kanit yoksa asla 'met' deme. "
        "(2) status: 'met'=gereksinim kodda tam ve dogru sekilde karsilaniyor; "
        "'partial'=baslanmis ama eksik, yarim veya hatali; 'missing'=kodda yok. "
        "(3) evidence: kararini destekleyen KISA kanit (ilgili fonksiyon/mantik ya da neden eksik oldugu). "
        "(4) where: kanitin gectigi dosya adi (yoksa bos). "
        "(5) Verilen HER gereksinim icin tam bir madde dondur, atlama. "
        "(6) README/dokumantasyon veya belirli bir dosyanin varligiyla ilgili maddelerde "
        "DOSYA LISTESI ve DOKUMANTASYON bolumune bak. "
        "(7) '[yalnizca imzalar]' ile isaretli dosyalarin sadece fonksiyon/sinif/route "
        "satirlari verildi: imzada acikca gorunen bir sey icin kaniti imza satiri olarak goster; "
        "icerigini gormeden 'tam dogru' diyemiyorsan 'partial' de, ama imzada varsa 'missing' DEME. "
        "(8) Her kurali YAZILDIGI KADAR degerlendir: kuralda istenmeyen ek beklentiler "
        "(daha iyi dokumantasyon, ek ozellik, stil) yuzunden 'partial' verme; bunlari "
        "evidence'ta not olarak belirtebilirsin. Ornek: 'README dosyasi olmali' kurali icin "
        "projeyi anlatan anlamli bir README varsa 'met'; yalnizca baslik iceren bos bir "
        "README 'partial'. "
        "(9) Her gereksinim BAGIMSIZDIR: bir eksik yalnizca ilgili oldugu gereksinimde sayilir, "
        "baska bir maddede ikinci kez ceza verme. Ornek: ayri bir 'girdi dogrulama' maddesi "
        "varken, dogrulama eksikligi yuzunden 'ekleme endpoint'i olmali' maddesini 'partial' "
        "yapma; endpoint varsa ve ekleme yapiyorsa o madde 'met', eksik yalnizca dogrulama "
        "maddesinde gorunur. "
        "(10) Turkce yaz. YALNIZCA su JSON semasiyla yanit ver: "
        '{"items":[{"requirement":"<madde metni>","status":"met|partial|missing",'
        '"evidence":"<kisa kanit>","where":"<dosya>"}]}'
    )
    paths = [f.path for f in files][:200]
    code_ctx, outlined = _requirement_context(code, requirements)
    prompt = (
        "ODEV GEREKSINIMLERI (her birini kodda kontrol et):\n" + numbered
        + "\n\nPROJEDEKI DOSYALAR:\n" + "\n".join(paths)
        + "\n\nOGRENCI KODU (kurallarla en ilgili dosyalar once):\n" + (code_ctx or "(kod dosyasi yok)")
        + "\n\nDOKUMANTASYON:\n" + (_context(docs + reports, budget=6000 if reports else 3000) or "(yok)")
    )
    data = _ask_json(system, prompt, max_tokens=2600, required="items")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise AIUnavailable("AI gereksinim maddesi dondurmedi")
    buckets = _bucket_items(items, requirements)
    buckets["note"] = "Yapay zeka her gereksinimi kodda tek tek denetledi (kanıta dayalı)."
    if outlined:
        buckets["note"] += (f" Proje büyük olduğu için {outlined} dosya yalnızca imzalarıyla "
                            "(fonksiyon/route satırları) incelendi.")
    return _wrap_req(buckets)


def _requirement_check_document(files: list[FileBlob], docs: list[FileBlob], requirements: list[str]) -> dict:
    """Rapor/belge teslimi: her gereksinimi belgenin METNİNDE tek tek arar (kanıt = kısa alıntı)."""
    numbered = "\n".join(f"{i+1}. {r}" for i, r in enumerate(requirements))
    system = (
        "Sen titiz ve nesnel bir değerlendiricisin. Sana bir ödevin GEREKSİNİMLERİ ve öğrencinin teslim "
        "ettiği BELGE(LER)İN metni verilecek (PDF/DOCX'ten çıkarılmıştır; biçim ve görseller yoktur). "
        "Her gereksinimi belgede TEK TEK ara ve kanıta dayalı karar ver. KURALLAR: "
        "(1) Kanıt yoksa asla 'met' deme. "
        "(2) status: 'met'=belgede tam ve istenen biçimde var; 'partial'=var ama eksik, yüzeysel ya da "
        "istenen biçimde değil; 'missing'=belgede yok. "
        "(3) evidence: belgeden KISA bir alıntı (en fazla ~20 kelime, tırnak içinde) ya da neden eksik olduğu. "
        "(4) where: dosya adı ve varsa sayfa (ör. 'rapor.pdf s.2'). "
        "(5) Verilen HER gereksinim için bir madde döndür, atlama. "
        "(6) Her kuralı YAZILDIĞI KADAR değerlendir; kuralda istenmeyen beklentiler yüzünden 'partial' verme. "
        "(7) Her gereksinim BAĞIMSIZDIR: bir eksik yalnızca ilgili maddede sayılır. "
        "(8) Görsel, tablo biçimi, yazı tipi gibi metinden anlaşılamayan konularda karar veremiyorsan "
        "'partial' de ve evidence'ta bunun metinden doğrulanamadığını yaz. "
        "(9) Türkçe yaz. YALNIZCA şu JSON şemasıyla yanıt ver: "
        '{"items":[{"requirement":"<madde metni>","status":"met|partial|missing",'
        '"evidence":"<kısa alıntı ya da açıklama>","where":"<dosya s.X>"}]}'
    )
    paths = [f.path for f in files][:200]
    prompt = (
        "ÖDEV GEREKSİNİMLERİ (her birini belgede kontrol et):\n" + numbered
        + "\n\nTESLİM EDİLEN DOSYALAR:\n" + "\n".join(paths)
        + "\n\nBELGE METNİ:\n" + _context(docs, budget=24000)
    )
    data = _ask_json(system, prompt, max_tokens=2600, required="items")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise AIUnavailable("AI gereksinim maddesi dondurmedi")
    buckets = _bucket_items(items, requirements)
    buckets["note"] = ("Yapay zeka her gereksinimi belgenin metninde tek tek denetledi (kanıt: belgeden alıntı). "
                       "Görseller ve biçimlendirme metinden değerlendirilemez.")
    return _wrap_req(buckets)


# Kural -> konu. Odevler farkli kurallar icerir; "ayni zayiflik tekrar ediyor mu"
# sorusu ancak konu duzeyinde sorulabilir. Sira onemli: ilk eslesen kazanir
# ("bos baslikta hata donmeli (dogrulama)" -> Girdi dogrulama, Hata yonetimi degil).
_TOPICS: list[tuple[str, tuple[str, ...]]] = [
    ("Girdi doğrulama", ("dogrula", "validasyon", "validation", "gecersiz", "bos birak",
                          "bos gir", "bos bas", "girdi kontrol", "zorunlu alan")),
    ("Kimlik doğrulama", ("giris yap", "login", "sifre", "parola", "oturum", "yetki", "token", "auth")),
    ("Hata yönetimi", ("hata", "exception", "istisna", "try", "except")),
    ("Dokümantasyon", ("readme", "dokuman", "belgele", "yorum satir", "aciklama satir")),
    ("Test", ("test",)),
    ("Veritabanı", ("veritaban", "database", "sql", "tablo", "orm")),
    ("Dosya işlemleri", ("dosyaya", "dosyadan", "dosya oku", "dosya yaz", "csv", "json dosya")),
    ("CRUD / endpoint", ("ekle", "listele", "sil", "guncelle", "olustur", "crud", "endpoint",
                         "goruntule", "detay")),
    ("Arayüz", ("arayuz", "sayfa", "form", "buton", "ekran")),
]


def requirement_topic(requirement: str) -> str:
    text = _norm_req(requirement)
    for topic, keys in _TOPICS:
        if any(k in text for k in keys):
            return topic
    return "Diğer"


def _norm_req(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).lower().translate(_TR_ASCII)).strip()


def _bucket_items(items: list, requirements: list[str]) -> dict:
    """AI'nin {requirement,status,evidence,where} listesini met/partial/missing'e ayirir;
    atlanmis gereksinimleri guvenli tarafta 'missing' sayar."""
    met, partial, missing = [], [], []
    matched: set[str] = set()
    norm_reqs = {_norm_req(r): r for r in requirements}
    for it in items:
        if not isinstance(it, dict):
            continue
        req = str(it.get("requirement", "")).strip()
        status = str(it.get("status", "")).lower()
        ev = str(it.get("evidence", "")).strip()
        where = str(it.get("where", "")).strip()
        if not req:
            continue
        # AI'nin dondurdugu maddeyi orijinal gereksinime esle (varsa)
        nr = _norm_req(req)
        for k in norm_reqs:
            if k and (k in nr or nr in k):
                matched.add(k)
                req = norm_reqs[k]
                break
        entry = {"requirement": req, "evidence": ev, "where": where, "note": ev}
        if status == "met":
            met.append(entry)
        elif status == "partial":
            partial.append(entry)
        else:
            missing.append(entry)
    # AI bir gereksinimi hic degerlendirmediyse: eksik say (elle kontrol notuyla)
    for k, orig in norm_reqs.items():
        if k not in matched:
            missing.append({"requirement": orig, "evidence": "",
                            "where": "", "note": "Değerlendirilemedi; elle kontrol edin."})
    return {"met": met, "partial": partial, "missing": missing}


_STOP = {"en", "az", "olmali", "olmalidir", "bir", "ve", "ile", "icin", "gerekli",
         "yapilmali", "bulunmali", "kullanilmali", "olacak", "gereken", "gerekir",
         "the", "a", "an", "must", "should", "adet", "tane", "sekilde", "programda"}

# Turkce gereksinim kelimesi -> kodda karsiligi olabilecek terimler (mock yedegi icin).
# Kok eslesmesi: kelime bu kokle basliyorsa esanlamlilar da aranir.
_SYNONYMS: dict[str, tuple[str, ...]] = {
    "ekle": ("post", "create", "add", "insert", "append", "save"),
    "olustur": ("post", "create", "new", "insert"),
    "kaydet": ("save", "insert", "commit", "write", "post"),
    "listele": ("get", "list", "all", "fetch", "select", "find"),
    "goruntule": ("get", "show", "detail", "read", "find"),
    "getir": ("get", "fetch", "find", "read"),
    "ara": ("search", "find", "filter", "query"),
    "sil": ("delete", "remove", "pop", "destroy"),
    "guncelle": ("put", "patch", "update", "edit"),
    "odunc": ("borrow", "lend", "loan"),
    "tamamla": ("done", "complete", "finish"),
    "isaretle": ("done", "mark", "complete", "flag"),
    "duzenle": ("put", "patch", "update", "edit"),
    "endpoint": ("@app.", "@router.", "route", "app.get", "app.post", "router"),
    "dogrula": ("validat", "raise", "if not", "min_length", "httpexception", "error", "valueerror"),
    "validasyon": ("validat", "raise", "if not", "min_length", "httpexception"),
    "kontrol": ("if ", "check", "validat", "raise"),
    "hata": ("except", "raise", "error", "try", "exception"),
    "giris": ("login", "input", "auth", "signin"),
    "kullanici": ("user", "input"),
    "sifre": ("password", "hash"),
    "veritaban": ("sql", "database", "db", "session", "sqlite", "model"),
    "tablo": ("table", "model", "create table"),
    "fonksiyon": ("def ", "function", "=>"),
    "sinif": ("class ",),
    "dongu": ("for ", "while "),
    "dosya": ("open(", "file", "read", "write"),
    "test": ("test", "assert", "pytest", "unittest"),
    "ortalama": ("avg", "average", "mean", "sum(", "/ len"),
    "toplam": ("sum", "total", "+="),
    "readme": ("readme",),
}


# Neredeyse her kodda gecen genel kelimeler: tek basina "kismen" kazandirmaz;
# kuralin asil belirleyicisi eylem/ozel kelimedir ("ekleme", "silme"...).
_GENERIC_ROOTS = ("endpoint", "fonksiyon", "metod", "metot", "method", "dosya", "kod",
                  "program", "proje", "uygulama", "sayfa")


def _is_generic(word: str) -> bool:
    return word.startswith(_GENERIC_ROOTS)


def _term_hits(word: str, text: str) -> bool:
    if word in text:
        return True
    for root, alts in _SYNONYMS.items():
        if word.startswith(root):
            return any(a in text for a in alts)
    return False


def _requirement_heuristic(code: list[FileBlob], requirements: list[str]) -> dict:
    """API anahtarsiz (mock) yedek: anahtar-kelime + dosya izine dayali kaba tahmin.

    LLM kadar iyi degildir; met/partial/missing uc kovaya ayirir ve hangi dosyada
    iz bulundugunu belirtir. Gercek analiz icin AI_PROVIDER=anthropic onerilir."""
    per_file = [(f.path, (f.path + "\n" + (f.content or "")).lower()) for f in code]
    met, partial, missing = [], [], []
    for req in requirements:
        words = [w for w in re.findall(r"[a-z_]+", req.lower().translate(_TR_ASCII))
                 if len(w) > 3 and w not in _STOP]
        if not words:
            partial.append({"requirement": req, "where": "",
                            "note": "Otomatik doğrulanamadı; elle kontrol edin."})
            continue
        words = [w for w in words if not _is_generic(w)] or words
        # Eylem kelimeleri ("silme", "listeleme", "dogrulama") kodda karsiligi aranabilen
        # asil belirleyicidir; Turkce isimler ("kayit", "notlari") Ingilizce kodda
        # dogal olarak gecmez. Eylem varsa karar ona gore verilir.
        actions = [w for w in words if any(w.startswith(r) for r in _SYNONYMS)]
        words = actions or words
        # her kelimenin (veya kod karsiliginin) hangi dosyada gectigini bul
        best_file, best_hits = "", 0
        for path, text in per_file:
            hits = sum(1 for w in words if _term_hits(w, text))
            if hits > best_hits:
                best_hits, best_file = hits, path
        hit_words = [w for w in words if any(_term_hits(w, t) for _, t in per_file)]
        ratio = len(set(hit_words)) / len(words)
        where = best_file
        if ratio >= 0.6:
            met.append({"requirement": req, "where": where,
                        "note": f"İlgili terimler bulundu ({', '.join(hit_words[:4])})."})
        elif ratio >= 0.3:
            partial.append({"requirement": req, "where": where,
                            "note": f"Kısmi iz var ({', '.join(hit_words[:4])}); tam karşılandığı belirsiz."})
        else:
            missing.append({"requirement": req, "where": "",
                            "note": "Kodda bu gereksinime dair yeterli iz yok."})
    detail = {"met": met, "partial": partial, "missing": missing,
              "note": "Sezgisel (anahtar kelime) analiz; kesin değildir — gerçek analiz için AI önerilir."}
    return _wrap_req(detail)


def _wrap_req(detail: dict) -> dict:
    detail.setdefault("met", [])
    detail.setdefault("partial", [])
    detail.setdefault("missing", [])
    met, partial, missing = detail["met"], detail["partial"], detail["missing"]
    total = len(met) + len(partial) + len(missing)
    coverage = round(100 * (len(met) + 0.5 * len(partial)) / total) if total else 0
    detail["coverage"] = coverage
    headline = (
        f"%{coverage} kapsam — {len(met)} tam"
        + (f", {len(partial)} kısmen" if partial else "")
        + f", {len(missing)} eksik."
    )
    return {
        "summary": {
            "coverage": coverage,
            "met_count": len(met),
            "partial_count": len(partial),
            "missing_count": len(missing),
            "headline": headline,
        },
        "detail": detail,
    }


# ---------------------------------------------------------------------------
# 7.2 Intihal / mantik benzerligi
# ---------------------------------------------------------------------------
def plagiarism(
    target_files: list[FileBlob],
    others: list[dict],  # [{"submission_id":..., "student_name":..., "files":[FileBlob]}]
) -> dict:
    """Hedef gonderimi diger ogrencilerle karsilastirir.

    Mock modda gercek bir difflib-tabanli yapisal benzerlik hesaplar (degisken
    adlari degismis ama mantik ayni kodu yakalamak icin normalize edilmis token
    dizileri karsilastirilir)."""
    target_norm = _normalize_code("\n".join(f.content for f in _code_files(target_files)))
    matches = []
    for other in others:
        other_norm = _normalize_code("\n".join(f.content for f in _code_files(other["files"])))
        if not target_norm or not other_norm:
            continue
        ratio = difflib.SequenceMatcher(a=target_norm, b=other_norm, autojunk=False).ratio()
        sim = round(ratio * 100, 1)
        if sim >= 40:  # esik: raporlanmaya deger benzerlik
            matches.append({
                "submission_id": other["submission_id"],
                "student_name": other["student_name"],
                "similarity": sim,
                "reason": "Normalize edilmiş kod yapısı (değişken/string/sayılar elenmiş) "
                          "yüksek oranda örtüşüyor.",
            })
    matches.sort(key=lambda m: m["similarity"], reverse=True)
    top = matches[0]["similarity"] if matches else 0.0
    # Tek esik (panolar, teslim tablosu, not onerisi ve Excel ayni degeri kullanir)
    verdict = "yuksek" if top >= SIMILARITY_WARN else "temiz"
    has_others = any(_code_files(o["files"]) for o in others)
    if not has_others:
        headline = "Karşılaştırılacak başka öğrenci teslimi yok."
    elif matches:
        headline = f"En yüksek benzerlik %{top} — {matches[0]['student_name']}."
    else:
        headline = "Kayda değer benzerlik bulunamadı."
    detail = {"verdict": verdict, "matches": matches,
              "note": "Yapısal benzerlik (difflib) ile hesaplandı; kesin kanıt değildir."}
    return {
        "summary": {
            "verdict": verdict,
            "top_similarity": top,
            "match_count": len(matches),
            "headline": headline,
        },
        "detail": detail,
        "matches": matches,
    }


# ---------------------------------------------------------------------------
# 7.4 Sinif geneli ozet rapor (scope: class)
# ---------------------------------------------------------------------------
def class_summary(students: list[dict]) -> dict:
    """Sinifin tum ogrencilerinin (en son gonderimleri) uzerinden ozet uretir.

    students: [{"student_name": str, "files": list[FileBlob]}]
    Ortalama Clean Code, en sik yapilan hatalar ve tekrar anlatilmasi gereken
    konular. Her ogrenci icin clean_code sonucunu toplulastirir.
    """
    per_student = []
    issue_counter: dict[str, int] = {}
    for s in students:
        cc = clean_code(s["files"])
        score = cc["summary"].get("score", 0)
        per_student.append({"student_name": s["student_name"], "score": score})
        for iss in cc["detail"].get("issues", []):
            title = iss.get("title", "").strip()
            if title:
                issue_counter[title] = issue_counter.get(title, 0) + 1

    scores = [p["score"] for p in per_student]
    avg = round(sum(scores) / len(scores), 1) if scores else 0
    common = sorted(issue_counter.items(), key=lambda x: -x[1])
    per_student.sort(key=lambda p: p["score"])  # dusukten yuksege (once desteklenecekler)

    detail = {
        "average": avg,
        "student_count": len(per_student),
        "per_student": per_student,
        "common_issues": [{"title": t, "count": c} for t, c in common],
        "topics": [t for t, _ in common[:3]],  # tekrar anlatilacak konular
        "note": "Sezgisel toplulaştırma; öncelikli olarak düşük skorlu öğrencilere "
                "ve en sık hatalara odaklanın.",
    }
    top_issue = common[0][0] if common else None
    summary = {
        "average": avg,
        "student_count": len(per_student),
        "top_issue": top_issue,
        "headline": (
            f"{len(per_student)} öğrenci · ortalama Clean Code {avg}/100"
            + (f" · en sık: {top_issue}" if top_issue else "")
        ),
    }
    return {"summary": summary, "detail": detail}


# ---------------------------------------------------------------------------
# 7.7 Ogrenci-AI mentor sohbeti (Faz 2)
# ---------------------------------------------------------------------------
def mentor_reply(history: list[dict], files: list[FileBlob], message: str) -> str:
    """Ogrencinin sorusuna, kodunu bilen bir mentor gibi yanit verir.

    history: [{"role": "user"|"assistant", "content": str}] (son mesajlar)
    Mentor DOGRUDAN tam cozumu vermez; yol gosterir, ipucu verir.
    """
    if _use_mock():
        return _mentor_mock(files, message)

    system = (
        "Sen sabirli bir yazilim mentorusun. Ogrencinin koduna bakarak Turkce yol "
        "goster. DOGRUDAN tam cozumu YAZMA; ipuclari, sorular ve kucuk orneklerle "
        "ogrencinin kendisinin cozmesini sagla. Kisa ve net ol."
    )
    convo = "\n".join(f"{m['role']}: {m['content']}" for m in history[-8:])
    prompt = (
        f"ÖĞRENCİNİN KODU:\n{_context(_code_files(files), budget=8000)}\n\n"
        f"SOHBET:\n{convo}\n\nÖĞRENCİ: {message}\nMENTOR:"
    )
    try:
        reply = get_ai_provider().complete(system, prompt, max_tokens=700).strip()
    except Exception as exc:
        print(f"[ai] mentor cagri hatasi: {exc!r}")
        raise AIUnavailable(repr(exc)) from exc
    if not reply:
        raise AIUnavailable("mentor bos cevap dondu")
    return reply


def _mentor_mock(files: list[FileBlob], message: str) -> str:
    code = _code_files(files)
    fname = code[0].path if code else "kodun"
    msg = message.lower()
    tips: list[str] = []
    if any(k in msg for k in ("hata", "error", "çalışmıyor", "calismiyor", "exception")):
        tips.append("Önce hata mesajını dikkatle oku — genelde hangi dosyanın hangi "
                    "satırında olduğunu söyler. O satıra ve bir üstündeki değişkenlere bak.")
    if any(k in msg for k in ("neden", "niye", "niçin", "why")):
        tips.append("Sorunu küçük parçalara böl: çalışan en küçük hali nedir? Adım adım "
                    "ekleyip nerede bozulduğunu bul.")
    if any(k in msg for k in ("nasıl", "nasil", "how", "yap")):
        tips.append("İlgili fonksiyonu tek başına, birkaç örnek girdiyle test et; "
                    "beklediğin çıktıyla karşılaştır.")
    if not tips:
        tips.append("Sorunu biraz daha somutlaştırır mısın? Hangi dosya, hangi satır, "
                    "ne bekliyorsun ve ne oluyor?")
    return (
        f"Sorunu anladım. `{fname}` dosyandan yola çıkarak birkaç ipucu:\n\n"
        + "\n".join(f"• {t}" for t in tips)
        + "\n\nTakılırsan ilgili kod parçasını buraya yapıştır, birlikte bakalım."
    )
