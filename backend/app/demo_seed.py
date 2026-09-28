"""Tanitim (demo) sinifi — hocaya gosterilecek gercekci, dolu bir sinif.

Her ogrencinin bir "hikayesi" var (surekli iyi, dogrulamayi hep unutan, gelisen,
dusen, teslim etmeyen, kopya cifti). Projeler farkli uslup/cati ile uretilir ki
durust ogrenciler birbirine benzemesin; kopya cifti ise ad degistirilmis ayni
koddur (intihal motoru yakalasin).

ONEMLI: AI analiz sonuclari burada UYDURULMAZ. Kodlar, notlar, hoca yorumlari ve
topluluk gonderileri seed edilir; analizler canlida gercek AI motoruyla calistirilir.

Idempotent: "Tanitim Sinifi" varsa hicbir sey yapmaz. Pilot oncesi temizlik icin
sinifi (ve 2025003+ demo ogrencileri) silmek yeterlidir.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.lib.ziputil import _build_tree, ExtractedFile
from app.models import (
    Assignment,
    Class,
    Comment,
    Community,
    CommunityPost,
    CommunityReply,
    Enrollment,
    PostVote,
    Score,
    Submission,
    SubmissionFile,
    User,
)

DEMO_CLASS_NAME = "WEB202 - Tanıtım Sınıfı"


# --- Proje ureteci ----------------------------------------------------------
@dataclass
class Res:
    k: str          # note
    p: str          # notes
    K: str          # Note
    app_title: str
    extra: str      # ek alan
    extra_type: str
    extra_default: str


NOTE = Res("note", "notes", "Note", "Not Defteri", "content", "str", '""')
BOOK = Res("book", "books", "Book", "Kütüphane Takip", "author", "str", '""')
TASK = Res("task", "tasks", "Task", "Görev Takip", "done", "bool", "False")


def _ind(block: str, n: int = 4) -> str:
    pad = " " * n
    return "\n".join(pad + ln if ln.strip() else ln for ln in block.splitlines())


def _fastapi_dict(r: Res, f: set[str], helper: bool) -> dict[str, str]:
    """FastAPI + pydantic + sozluk depolama."""
    nf = '        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")'
    chk = f"    if item_id not in {r.p}:\n{nf}\n"
    parts = [
        "from fastapi import FastAPI, HTTPException",
        "from pydantic import BaseModel",
        "",
        f'app = FastAPI(title="{r.app_title}")',
        "",
        "",
        f"class {r.K}In(BaseModel):",
        "    title: str",
        f"    {r.extra}: {r.extra_type} = {r.extra_default}",
        "",
        "",
        f"{r.p}: dict[int, dict] = {{}}",
        "next_id = 1",
        "",
    ]
    if helper:
        parts += ["", f"def _get_or_404(item_id: int) -> dict:",
                  f"    item = {r.p}.get(item_id)",
                  "    if item is None:",
                  '        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")',
                  "    return item", ""]
        chk = f"    _get_or_404(item_id)\n"
    blocks = []
    if "add" in f:
        v = ('    if not item.title.strip():\n'
             '        raise HTTPException(status_code=400, detail="Başlık boş olamaz")\n') if "valid" in f else ""
        blocks.append(
            f'@app.post("/{r.p}", status_code=201)\ndef create_{r.k}(item: {r.K}In):\n'
            f"    global next_id\n{v}"
            f'    {r.p}[next_id] = {{"id": next_id, **item.model_dump()}}\n'
            f"    next_id += 1\n    return {r.p}[next_id - 1]\n")
    if "list" in f:
        if "search" in f:
            blocks.append(
                f'@app.get("/{r.p}")\ndef list_{r.p}(q: str | None = None):\n'
                f"    items = list({r.p}.values())\n    if q:\n"
                f'        items = [i for i in items if q.lower() in i["title"].lower()]\n'
                f"    return items\n")
        else:
            blocks.append(f'@app.get("/{r.p}")\ndef list_{r.p}():\n    return list({r.p}.values())\n')
    if "get404" in f and "borrow" in f:
        blocks.append(f'@app.get("/{r.p}/{{item_id}}")\ndef get_{r.k}(item_id: int):\n'
                      + (f"    return _get_or_404(item_id)\n" if helper else f"{chk}    return {r.p}[item_id]\n"))
    if "update" in f:
        blocks.append(f'@app.patch("/{r.p}/{{item_id}}")\ndef complete_{r.k}(item_id: int):\n'
                      + (chk if "get404" in f else "")
                      + f'    {r.p}[item_id]["done"] = True\n    return {r.p}[item_id]\n')
    if "borrow" in f:
        c = (f'    if not {r.p}[item_id].get("available", True):\n'
             '        raise HTTPException(status_code=409, detail="Kitap zaten ödünçte")\n') if "check" in f else ""
        blocks.append(f'@app.post("/{r.p}/{{item_id}}/borrow")\ndef borrow_{r.k}(item_id: int):\n'
                      + (chk if "get404" in f else "") + c
                      + f'    {r.p}[item_id]["available"] = False\n    return {r.p}[item_id]\n')
    if "delete" in f:
        blocks.append(f'@app.delete("/{r.p}/{{item_id}}")\ndef delete_{r.k}(item_id: int):\n'
                      + (chk if "get404" in f else "")
                      + f"    {r.p}.pop(item_id, None)\n    return {{\"ok\": True}}\n")
    if helper:
        blocks.reverse()  # ayni catida farkli yazim sirasi
    return {"main.py": "\n".join(parts) + "\n\n" + "\n\n".join(blocks)}


def _flask_list(r: Res, f: set[str]) -> dict[str, str]:
    """Flask + liste + elle JSON okuma, dongu ile arama."""
    lines = [
        "from flask import Flask, jsonify, request",
        "",
        "app = Flask(__name__)",
        f"{r.p} = []",
        "",
        "",
        f"def find_{r.k}(item_id):",
        f"    for item in {r.p}:",
        '        if item["id"] == item_id:',
        "            return item",
        "    return None",
        "",
    ]
    out = []
    if "list" in f or "add" in f:
        body = []
        if "list" in f:
            body += ['    if request.method == "GET":']
            if "search" in f:
                body += ['        q = request.args.get("q", "").lower()',
                         f'        return jsonify([b for b in {r.p} if q in b["title"].lower()])']
            else:
                body += [f"        return jsonify({r.p})"]
        if "add" in f:
            body += ["    data = request.get_json() or {}"]
            if "valid" in f:
                body += ['    if not data.get("title"):',
                         '        return jsonify({"hata": "başlık gerekli"}), 400']
            body += [f'    item = {{"id": len({r.p}) + 1, "title": data.get("title"), '
                     f'"{r.extra}": data.get("{r.extra}")}}',
                     f"    {r.p}.append(item)", "    return jsonify(item), 201"]
        methods = ", ".join(m for m, need in (('"GET"', "list"), ('"POST"', "add")) if need in f)
        out.append(f'@app.route("/{r.p}", methods=[{methods}])\ndef {r.p}_view():\n' + "\n".join(body) + "\n")
    nf = (f"    item = find_{r.k}(item_id)\n    if item is None:\n"
          '        return jsonify({"hata": "bulunamadı"}), 404\n')
    if "update" in f:
        out.append(f'@app.route("/{r.p}/<int:item_id>/done", methods=["PUT"])\ndef finish_{r.k}(item_id):\n'
                   + (nf if "get404" in f else f"    item = find_{r.k}(item_id)\n")
                   + '    item["done"] = True\n    return jsonify(item)\n')
    if "borrow" in f:
        c = ('    if item.get("borrowed"):\n        return jsonify({"hata": "zaten ödünçte"}), 409\n'
             if "check" in f else "")
        out.append(f'@app.route("/{r.p}/<int:item_id>/borrow", methods=["POST"])\ndef lend_{r.k}(item_id):\n'
                   + (nf if "get404" in f else f"    item = find_{r.k}(item_id)\n")
                   + c + '    item["borrowed"] = True\n    return jsonify(item)\n')
    if "delete" in f:
        out.append(f'@app.route("/{r.p}/<int:item_id>", methods=["DELETE"])\ndef remove_{r.k}(item_id):\n'
                   + (nf if "get404" in f else f"    item = find_{r.k}(item_id)\n")
                   + f"    {r.p}.remove(item)\n    return \"\", 204\n")
    tail = ['', '', 'if __name__ == "__main__":', "    app.run(debug=True)", ""]
    return {"app.py": "\n".join(lines) + "\n" + "\n\n".join(out) + "\n".join(tail)}


def _fastapi_class(r: Res, f: set[str]) -> dict[str, str]:
    """FastAPI + depo sinifi (Store) — mantik sinifta, route'lar ince."""
    m = [f"class {r.K}Store:",
         '    """Kayitlari bellekte tutar."""', "",
         "    def __init__(self):", "        self._items = []", "        self._seq = 0", "",
         "    def add(self, title, extra=None):",
         "        self._seq += 1",
         f'        item = {{"id": self._seq, "title": title, "{r.extra}": extra}}',
         "        self._items.append(item)", "        return item", "",
         "    def all(self, q=None):",
         "        if not q:", "            return list(self._items)",
         '        return [i for i in self._items if q.lower() in i["title"].lower()]', "",
         "    def get(self, item_id):",
         '        return next((i for i in self._items if i["id"] == item_id), None)', "",
         "    def remove(self, item_id):",
         '        self._items = [i for i in self._items if i["id"] != item_id]', ""]
    routes = ["from fastapi import FastAPI, HTTPException", "", f"store = {r.K}Store()",
              f'app = FastAPI(title="{r.app_title}")', ""]
    if "add" in f:
        v = ('    if not payload.get("title", "").strip():\n'
             '        raise HTTPException(400, "Başlık zorunlu")\n') if "valid" in f else ""
        routes.append(f'@app.post("/{r.p}", status_code=201)\ndef add_{r.k}(payload: dict):\n{v}'
                      f'    return store.add(payload.get("title", ""), payload.get("{r.extra}"))\n')
    if "list" in f:
        routes.append(f'@app.get("/{r.p}")\ndef all_{r.p}('
                      + ("q: str = \"\"" if "search" in f else "") + "):\n"
                      + ("    return store.all(q)\n" if "search" in f else "    return store.all()\n"))
    g = ("    item = store.get(item_id)\n    if item is None:\n"
         '        raise HTTPException(404, "Yok")\n')
    if "update" in f:
        routes.append(f'@app.put("/{r.p}/{{item_id}}/done")\ndef mark_done(item_id: int):\n'
                      + (g if "get404" in f else "    item = store.get(item_id)\n")
                      + '    item["done"] = True\n    return item\n')
    if "borrow" in f:
        c = ('    if item.get("on_loan"):\n        raise HTTPException(409, "Ödünçte")\n' if "check" in f else "")
        routes.append(f'@app.post("/{r.p}/{{item_id}}/loan")\ndef loan(item_id: int):\n'
                      + (g if "get404" in f else "    item = store.get(item_id)\n")
                      + c + '    item["on_loan"] = True\n    return item\n')
    if "delete" in f:
        routes.append(f'@app.delete("/{r.p}/{{item_id}}")\ndef drop(item_id: int):\n'
                      + (g if "get404" in f else "") + "    store.remove(item_id)\n    return {}\n")
    return {"store.py": "\n".join(m),
            "main.py": f"from store import {r.K}Store\n" + "\n".join(routes[:5]) + "\n\n" + "\n\n".join(routes[5:])}


def _fastapi_router(r: Res, f: set[str]) -> dict[str, str]:
    """Cok dosyali, katmanli yapi: schemas + repository + routes (APIRouter)."""
    schema = [f'"""{r.app_title} veri semalari."""', "from pydantic import BaseModel, Field", "", "",
              f"class {r.K}Create(BaseModel):",
              "    title: str" + (" = Field(min_length=1, description=\"Boş olamaz\")" if "valid" in f else ""),
              f"    {r.extra}: {r.extra_type} = {r.extra_default}", "", "",
              f"class {r.K}({r.K}Create):", "    id: int", ""]
    repo = [f"from schemas import {r.K}, {r.K}Create", "", f"_db: dict[int, {r.K}] = {{}}", "", "",
            f"def create(data: {r.K}Create) -> {r.K}:",
            "    new_id = max(_db, default=0) + 1",
            f"    _db[new_id] = {r.K}(id=new_id, **data.model_dump())", "    return _db[new_id]", "", "",
            f"def search(text: str | None = None) -> list[{r.K}]:",
            "    rows = list(_db.values())",
            "    return [x for x in rows if not text or text.lower() in x.title.lower()]", "", "",
            f"def find(item_id: int) -> {r.K} | None:", "    return _db.get(item_id)", "", "",
            "def delete(item_id: int) -> bool:", "    return _db.pop(item_id, None) is not None", ""]
    rt = ["from fastapi import APIRouter, HTTPException", "", "import repository as repo",
          f"from schemas import {r.K}, {r.K}Create", "",
          f'router = APIRouter(prefix="/{r.p}", tags=["{r.p}"])', "", ""]
    ep = []
    if "add" in f:
        ep.append(f'@router.post("", response_model={r.K}, status_code=201)\n'
                  f"def create_{r.k}(data: {r.K}Create):\n    return repo.create(data)\n")
    if "list" in f:
        ep.append(f'@router.get("", response_model=list[{r.K}])\ndef list_{r.p}('
                  + ("q: str | None = None):\n    return repo.search(q)\n" if "search" in f
                     else "):\n    return repo.search()\n"))
    nf = ("    item = repo.find(item_id)\n    if item is None:\n"
          f'        raise HTTPException(status_code=404, detail="{r.K} bulunamadı")\n')
    if "get404" in f and "borrow" in f:
        ep.append(f'@router.get("/{{item_id}}", response_model={r.K})\ndef get_{r.k}(item_id: int):\n{nf}    return item\n')
    if "update" in f:
        ep.append(f'@router.patch("/{{item_id}}/done", response_model={r.K})\ndef complete(item_id: int):\n'
                  f"{nf}    item.done = True\n    return item\n")
    if "borrow" in f:
        c = ('    if getattr(item, "borrowed_by", None):\n'
             '        raise HTTPException(status_code=409, detail="Kitap şu an ödünçte")\n') if "check" in f else ""
        ep.append(f'@router.post("/{{item_id}}/borrow")\ndef borrow(item_id: int, student: str):\n{nf}{c}'
                  "    item.borrowed_by = student\n    return {\"ok\": True, \"student\": student}\n")
    if "delete" in f:
        ep.append(f'@router.delete("/{{item_id}}", status_code=204)\ndef delete_{r.k}(item_id: int):\n'
                  f"    if not repo.delete(item_id):\n"
                  f'        raise HTTPException(status_code=404, detail="{r.K} bulunamadı")\n')
    main = ["from fastapi import FastAPI", "", "from routes import router", "",
            f'app = FastAPI(title="{r.app_title}", version="1.0")', "app.include_router(router)", ""]
    return {"schemas.py": "\n".join(schema), "repository.py": "\n".join(repo),
            "routes.py": "\n".join(rt) + "\n\n".join(ep), "main.py": "\n".join(main)}


def _flask_class(r: Res, f: set[str]) -> dict[str, str]:
    """Flask Blueprint + dataclass; hata yonetimi errorhandler ile."""
    lines = ["from dataclasses import dataclass, asdict", "",
             "from flask import Blueprint, Flask, abort, jsonify, request", "", "",
             "@dataclass", f"class {r.K}:", "    id: int", "    title: str",
             f"    {r.extra}: {r.extra_type} = {r.extra_default}", "", "",
             f'bp = Blueprint("{r.p}", __name__, url_prefix="/api/{r.p}")',
             f"_rows: list[{r.K}] = []", "", "",
             f"def _row_or_404(item_id: int) -> {r.K}:",
             "    for row in _rows:", "        if row.id == item_id:", "            return row",
             "    abort(404)", ""]
    ep = []
    if "add" in f:
        v = ('    if not str(body.get("title", "")).strip():\n        abort(400)\n') if "valid" in f else ""
        ep.append('@bp.post("")\ndef create():\n    body = request.get_json(force=True)\n' + v
                  + f'    row = {r.K}(id=len(_rows) + 1, title=body.get("title", ""))\n'
                  + "    _rows.append(row)\n    return jsonify(asdict(row)), 201\n")
    if "list" in f:
        ep.append('@bp.get("")\ndef index():\n'
                  + ('    term = request.args.get("q", "").lower()\n'
                     '    return jsonify([asdict(x) for x in _rows if term in x.title.lower()])\n'
                     if "search" in f else "    return jsonify([asdict(x) for x in _rows])\n"))
    if "update" in f:
        ep.append('@bp.put("/<int:item_id>/done")\ndef done(item_id):\n    row = _row_or_404(item_id)\n'
                  "    row.done = True\n    return jsonify(asdict(row))\n")
    if "borrow" in f:
        ep.append('@bp.post("/<int:item_id>/lend")\ndef lend(item_id):\n    row = _row_or_404(item_id)\n'
                  + ("    if getattr(row, \"lent\", False):\n        abort(409)\n" if "check" in f else "")
                  + "    row.lent = True\n    return jsonify({\"id\": row.id, \"lent\": True})\n")
    if "delete" in f:
        ep.append('@bp.delete("/<int:item_id>")\ndef destroy(item_id):\n    _rows.remove(_row_or_404(item_id))\n'
                  '    return "", 204\n')
    app = ["", "", "def create_app() -> Flask:", "    app = Flask(__name__)", "    app.register_blueprint(bp)", "",
           "    @app.errorhandler(404)", "    def not_found(_):", '        return jsonify({"error": "not found"}), 404',
           "", "    return app", ""]
    return {"app.py": "\n".join(lines) + "\n\n" + "\n\n".join(ep) + "\n".join(app)}


def _fastapi_sqlite(r: Res, f: set[str]) -> dict[str, str]:
    """FastAPI + sqlite3 ile kalici saklama, ham SQL."""
    db = ["import sqlite3", "", 'DB_PATH = "data.db"', "", "",
          "def connect():", "    conn = sqlite3.connect(DB_PATH)", "    conn.row_factory = sqlite3.Row",
          "    return conn", "", "",
          "def init():", "    with connect() as conn:",
          f'        conn.execute("CREATE TABLE IF NOT EXISTS {r.p} '
          f'(id INTEGER PRIMARY KEY, title TEXT, {r.extra} TEXT, flag INTEGER DEFAULT 0)")', ""]
    ep = []
    q = "    with connect() as conn:\n"
    nf = (f'        row = conn.execute("SELECT * FROM {r.p} WHERE id = ?", (item_id,)).fetchone()\n'
          '        if row is None:\n            raise HTTPException(404, "Kayıt yok")\n')
    if "add" in f:
        v = ('    if not data.title or not data.title.strip():\n'
             '        raise HTTPException(400, "Başlık boş bırakılamaz")\n') if "valid" in f else ""
        ep.append(f'@app.post("/{r.p}", status_code=201)\ndef insert_{r.k}(data: {r.K}Body):\n{v}{q}'
                  f'        cur = conn.execute("INSERT INTO {r.p} (title, {r.extra}) VALUES (?, ?)", '
                  f"(data.title, str(data.{r.extra})))\n"
                  '        return {"id": cur.lastrowid, "title": data.title}\n')
    if "list" in f:
        if "search" in f:
            ep.append(f'@app.get("/{r.p}")\ndef select_{r.p}(q: str = ""):\n{q}'
                      f'        rows = conn.execute("SELECT * FROM {r.p} WHERE title LIKE ?", (f"%{{q}}%",))\n'
                      "        return [dict(x) for x in rows]\n")
        else:
            ep.append(f'@app.get("/{r.p}")\ndef select_{r.p}():\n{q}'
                      f'        return [dict(x) for x in conn.execute("SELECT * FROM {r.p}")]\n')
    if "update" in f:
        ep.append(f'@app.put("/{r.p}/{{item_id}}")\ndef set_done(item_id: int):\n{q}'
                  + (nf if "get404" in f else "")
                  + f'        conn.execute("UPDATE {r.p} SET flag = 1 WHERE id = ?", (item_id,))\n'
                  '        return {"id": item_id, "done": True}\n')
    if "borrow" in f:
        c = ('        if row["flag"]:\n            raise HTTPException(409, "Zaten verilmiş")\n'
             if "check" in f and "get404" in f else "")
        ep.append(f'@app.put("/{r.p}/{{item_id}}/lend")\ndef lend_{r.k}(item_id: int):\n{q}'
                  + (nf if "get404" in f else "") + c
                  + f'        conn.execute("UPDATE {r.p} SET flag = 1 WHERE id = ?", (item_id,))\n'
                  '        return {"id": item_id, "lent": True}\n')
    if "delete" in f:
        ep.append(f'@app.delete("/{r.p}/{{item_id}}")\ndef remove_{r.k}(item_id: int):\n{q}'
                  + (nf if "get404" in f else "")
                  + f'        conn.execute("DELETE FROM {r.p} WHERE id = ?", (item_id,))\n'
                  '        return {"deleted": item_id}\n')
    main = ["from fastapi import FastAPI, HTTPException", "from pydantic import BaseModel", "",
            "from database import connect, init", "", "init()", f'app = FastAPI(title="{r.app_title}")', "", "",
            f"class {r.K}Body(BaseModel):", "    title: str", f"    {r.extra}: {r.extra_type} = {r.extra_default}", ""]
    return {"database.py": "\n".join(db), "main.py": "\n".join(main) + "\n\n" + "\n\n".join(ep)}


def _flask_dict(r: Res, f: set[str]) -> dict[str, str]:
    """Flask + sozluk; dogrulama ayri fonksiyonda, her islem ayri route."""
    lines = ["from flask import Flask, jsonify, request", "", "app = Flask(__name__)", "",
             f"DATA = {{}}", "COUNTER = {\"value\": 0}", "", ""]
    if "valid" in f:
        lines += ["def validate(payload):", '    title = (payload or {}).get("title", "")',
                  "    if not isinstance(title, str) or not title.strip():",
                  '        return "title alanı zorunlu"', "    return None", "", ""]
    ep = []
    if "add" in f:
        ep.append(f'@app.post("/{r.p}")\ndef post_{r.k}():\n    payload = request.json\n'
                  + ('    error = validate(payload)\n    if error:\n        return {"error": error}, 400\n'
                     if "valid" in f else "")
                  + '    COUNTER["value"] += 1\n    new = {"id": COUNTER["value"], **payload}\n'
                  '    DATA[new["id"]] = new\n    return new, 201\n')
    if "list" in f:
        ep.append(f'@app.get("/{r.p}")\ndef get_{r.p}():\n'
                  + ('    word = request.args.get("q")\n    values = list(DATA.values())\n'
                     '    if word:\n        values = [v for v in values if word.lower() in v["title"].lower()]\n'
                     '    return jsonify(values)\n' if "search" in f else "    return jsonify(list(DATA.values()))\n"))
    miss = ('    if item_id not in DATA:\n        return {"error": "not found"}, 404\n')
    if "update" in f:
        ep.append(f'@app.patch("/{r.p}/<int:item_id>")\ndef patch_{r.k}(item_id):\n'
                  + (miss if "get404" in f else "") + '    DATA[item_id]["done"] = True\n    return DATA[item_id]\n')
    if "borrow" in f:
        ep.append(f'@app.post("/{r.p}/<int:item_id>/borrow")\ndef borrow_{r.k}(item_id):\n'
                  + (miss if "get404" in f else "")
                  + ('    if DATA[item_id].get("taken"):\n        return {"error": "busy"}, 409\n' if "check" in f else "")
                  + '    DATA[item_id]["taken"] = True\n    return DATA[item_id]\n')
    if "delete" in f:
        ep.append(f'@app.delete("/{r.p}/<int:item_id>")\ndef delete_{r.k}(item_id):\n'
                  + (miss if "get404" in f else "") + "    DATA.pop(item_id)\n    return {}, 204\n")
    return {"app.py": "\n".join(lines) + "\n\n".join(ep)}


def _fastapi_async(r: Res, f: set[str]) -> dict[str, str]:
    """Async FastAPI + liste + uuid kimlikler."""
    lines = ["import uuid", "", "from fastapi import FastAPI", "from fastapi.responses import JSONResponse", "",
             f'app = FastAPI(title="{r.app_title}")', f"db = []", "", ""]
    ep = []
    if "add" in f:
        ep.append(f'@app.post("/{r.p}")\nasync def new_{r.k}(body: dict):\n'
                  + ('    if not body.get("title"):\n        return JSONResponse({"msg": "başlık?"}, status_code=400)\n'
                     if "valid" in f else "")
                  + '    body["id"] = str(uuid.uuid4())\n    db.append(body)\n'
                  "    return JSONResponse(body, status_code=201)\n")
    if "list" in f:
        ep.append(f'@app.get("/{r.p}")\nasync def fetch_{r.p}():\n    return db\n')
    if "delete" in f:
        ep.append(f'@app.delete("/{r.p}/{{item_id}}")\nasync def kill_{r.k}(item_id: str):\n'
                  "    global db\n    db = [x for x in db if x[\"id\"] != item_id]\n    return {\"ok\": 1}\n")
    return {"main.py": "\n".join(lines) + "\n\n".join(ep)}


def _tests(style: str, r: Res, f: set[str]) -> str:
    imp = "from app import app" if style in ("flask_list", "flask_dict") else (
        "from app import create_app\n\napp = create_app()" if style == "flask_class" else "from main import app")
    if style.startswith("flask"):
        base = "/api/" + r.p if style == "flask_class" else "/" + r.p
        return (f"{imp}\n\nclient = app.test_client()\n\n\n"
                f"def test_create_{r.k}():\n    r = client.post(\"{base}\", json={{\"title\": \"Deneme\"}})\n"
                f"    assert r.status_code == 201\n\n\n"
                f"def test_list_{r.p}():\n    assert client.get(\"{base}\").status_code == 200\n")
    t = (f"from fastapi.testclient import TestClient\n\n{imp}\n\nclient = TestClient(app)\n\n\n"
         f"def test_create_{r.k}():\n    r = client.post(\"/{r.p}\", json={{\"title\": \"Deneme\"}})\n"
         f"    assert r.status_code == 201\n\n\n"
         f"def test_list_{r.p}():\n    assert client.get(\"/{r.p}\").status_code == 200\n")
    if "valid" in f:
        t += (f"\n\ndef test_empty_title_rejected():\n"
              f"    assert client.post(\"/{r.p}\", json={{\"title\": \"\"}}).status_code in (400, 422)\n")
    return t


# Uslup -> (on ek, guncelleme yolu, odunc verme yolu). README gercek koddaki yollari anlatsin.
_ROUTES = {
    "fastapi_dict": ("", "PATCH /{id}", "POST /{id}/borrow"),
    "flask_list": ("", "PUT /{id}/done", "POST /{id}/borrow"),
    "fastapi_class": ("", "PUT /{id}/done", "POST /{id}/loan"),
    "fastapi_router": ("", "PATCH /{id}/done", "POST /{id}/borrow?student=<ad>"),
    "flask_class": ("/api", "PUT /{id}/done", "POST /{id}/lend"),
    "fastapi_sqlite": ("", "PUT /{id}", "PUT /{id}/lend"),
    "flask_dict": ("", "PATCH /{id}", "POST /{id}/borrow"),
    "fastapi_async": ("", "", ""),
}


def _endpoint_docs(style: str, r: Res, f: set[str]) -> list[str]:
    """Ogrencinin GERCEKTEN yazdigi uclar ve davranislar (kodda olmayani iddia etmez)."""
    pre, upd, bor = _ROUTES[style]
    base = f"{pre}/{r.p}"
    nf = " (kayıt yoksa 404)" if "get404" in f else ""
    docs = []
    if "add" in f:
        docs.append(f"`POST {base}` — yeni kayıt ekler" + (" (boş başlık reddedilir)" if "valid" in f else ""))
    if "list" in f:
        docs.append(f"`GET {base}` — kayıtları listeler" + (" (`?q=` ile başlığa göre arama)" if "search" in f else ""))
    if "get404" in f and "borrow" in f and style in ("fastapi_dict", "fastapi_router"):
        docs.append(f"`GET {base}/{{id}}` — tek kaydı getirir (yoksa 404)")
    if "update" in f and upd:
        m, path = upd.split(" ", 1)
        docs.append(f"`{m} {base}{path}` — görevi tamamlandı olarak işaretler{nf}")
    if "borrow" in f and bor:
        m, path = bor.split(" ", 1)
        docs.append(f"`{m} {base}{path}` — kitabı ödünç verir{nf}"
                    + ("; zaten ödünçteyse 409" if "check" in f else ""))
    if "delete" in f:
        docs.append(f"`DELETE {base}/{{id}}` — kaydı siler{nf}")
    return docs


def _readme(style: str, r: Res, f: set[str], kind: str | None, run: str) -> str | None:
    if kind == "full":
        lines = "\n".join(f"- {d}" for d in _endpoint_docs(style, r, f))
        tests = "\n\n## Testler\n\n```bash\npytest\n```\n" if "tests" in f else "\n"
        return (f"# {r.app_title}\n\nBasit bir {r.app_title.lower()} REST API'si.\n\n## Kurulum\n\n"
                f"```bash\npip install -r requirements.txt\n{run}\n```\n\n## Uç noktalar\n\n{lines}{tests}")
    if kind == "thin":
        return f"# {r.app_title}\n\nÖdev projesi.\n"
    return None


def build_project(style: str, r: Res, f: set[str], readme: str | None = None,
                  helper: bool = False) -> dict[str, str]:
    if style == "fastapi_dict":
        files = _fastapi_dict(r, f, helper)
    elif style == "flask_list":
        files = _flask_list(r, f)
    elif style == "fastapi_class":
        files = _fastapi_class(r, f)
    elif style == "fastapi_router":
        files = _fastapi_router(r, f)
    elif style == "flask_class":
        files = _flask_class(r, f)
    elif style == "fastapi_sqlite":
        files = _fastapi_sqlite(r, f)
    elif style == "flask_dict":
        files = _flask_dict(r, f)
    elif style == "fastapi_async":
        files = _fastapi_async(r, f)
    else:  # pragma: no cover
        raise ValueError(style)
    run = "flask run" if style.startswith("flask") else "uvicorn main:app --reload"
    reqs = "flask\npytest\n" if style.startswith("flask") else "fastapi\nuvicorn\npytest\nhttpx\n"
    files["requirements.txt"] = reqs
    if "tests" in f:
        files["test_app.py"] = _tests(style, r, f)
    rd = _readme(style, r, f, readme, run)
    if rd:
        files["README.md"] = rd
    return files


# Kopya cifti: ayni kod, degisken/fonksiyon adlari ve metinler degistirilmis.
_RENAMES = {
    "books": "kitaplar", "book": "kitap", "Book": "Kitap", "item_id": "kid", "item": "kayit",
    "next_id": "sayac", "create_": "ekle_", "list_": "listele_", "borrow_": "odunc_",
    "delete_": "sil_", "get_": "getir_", "items": "sonuclar", "Kayıt bulunamadı": "Böyle bir kitap yok",
    "Kitap zaten ödünçte": "Bu kitap başkasında", "Kütüphane Takip": "Kitaplik",
}


def disguise(files: dict[str, str]) -> dict[str, str]:
    out = {}
    for path, text in files.items():
        for a, b in _RENAMES.items():
            text = re.sub(re.escape(a), b, text)
        out[path] = text
    return out


# --- Senaryo ----------------------------------------------------------------
@dataclass
class StudentSpec:
    no: str
    name: str
    email: str
    style: str
    helper: bool = False
    # odev anahtari -> surumler listesi [(ozellikler, readme)]
    work: dict[str, list[tuple[set[str], str | None]]] = field(default_factory=dict)


A1_FULL = {"add", "list", "delete", "get404", "valid"}
A2_FULL = {"add", "list", "search", "borrow", "check", "get404", "valid"}
A3_FULL = {"add", "list", "update", "delete", "get404", "valid", "tests"}

STUDENTS = [
    # Surekli guclu, katmanli mimari
    StudentSpec("2025001", "Mehmet Demir", "ogrenci1@kernel.dev", "fastapi_router", work={
        "a1": [(A1_FULL, "full")],
        "a2": [(A2_FULL - {"search"}, "full"), (A2_FULL, "full")],
        "a3": [(A3_FULL, "full")]}),
    # Girdi dogrulamasini hep unutuyor (tekrar eden zayiflik)
    StudentSpec("2025002", "Zeynep Kaya", "ogrenci2@kernel.dev", "flask_list", work={
        "a1": [({"add", "list", "delete", "get404"}, "full")],
        "a2": [({"add", "list", "search", "borrow", "check", "get404"}, "full")],
        "a3": [({"add", "list", "update"}, None), ({"add", "list", "update", "delete", "get404"}, "thin")]}),
    # Gelisiyor: zayif baslangic -> tam puan
    StudentSpec("2025003", "Emre Şahin", "ogrenci3@kernel.dev", "fastapi_class", work={
        "a1": [({"add"}, None), ({"add", "list"}, None)],
        "a2": [({"add", "list", "search", "borrow", "get404"}, "thin")],
        "a3": [(A3_FULL, "full")]}),
    # Dusuyor: iyi basladi, sonra geriledi, son odevi teslim etmedi
    StudentSpec("2025004", "Elif Çelik", "ogrenci4@kernel.dev", "fastapi_dict", work={
        "a1": [(A1_FULL, "full")],
        "a2": [({"add", "list"}, None)]}),
    # Teslim aliskanligi zayif: A2'yi hic teslim etmedi (suresi gecti)
    StudentSpec("2025005", "Burak Aydın", "ogrenci5@kernel.dev", "flask_class", work={
        "a1": [({"add", "list", "delete"}, None)]}),
    # Iyi, son odevde testleri eksik
    StudentSpec("2025006", "Selin Arslan", "ogrenci6@kernel.dev", "fastapi_sqlite", work={
        "a1": [(A1_FULL, "thin")],
        "a2": [(A2_FULL, "full")],
        "a3": [(A3_FULL - {"tests"}, "full")]}),
    # Kopya ciftinin "kaynagi"
    StudentSpec("2025007", "Can Öztürk", "ogrenci7@kernel.dev", "flask_dict", work={
        "a1": [({"add", "list", "delete", "get404"}, "full")],
        "a2": [({"add", "list", "search", "borrow", "check", "get404"}, "full")]}),
    # A2'de Can'in kodunu ad degistirerek kopyaliyor
    StudentSpec("2025008", "Deniz Yıldız", "ogrenci8@kernel.dev", "fastapi_async", work={
        "a1": [({"add", "list"}, "thin")],
        "a2": [("COPY:2025007", None)]}),
]

ASSIGNMENTS = {
    "a1": dict(res=NOTE, days=-21, title="Ödev 1: Not Defteri API",
               description="Notların eklenip listelenip silinebildiği bir REST API yazın.",
               requirements=["Not ekleme endpoint'i olmalı (POST)",
                             "Notları listeleme endpoint'i olmalı (GET)",
                             "Not silme endpoint'i olmalı; olmayan not için 404 dönmeli",
                             "Başlığı boş not eklenirse hata dönmeli (girdi doğrulama)",
                             "README dosyası kurulum ve kullanımı anlatmalı"]),
    "a2": dict(res=BOOK, days=-7, title="Ödev 2: Kütüphane Takip Sistemi",
               description="Kitap ekleme, arama ve ödünç verme işlemlerini yapan bir API.",
               requirements=["Kitap ekleme endpoint'i olmalı",
                             "Kitapları listeleme ve başlığa göre arama olmalı",
                             "Kitap ödünç verme endpoint'i olmalı; ödünçteki kitap tekrar verilememeli",
                             "Olmayan kitap ID'sinde 404 dönmeli (hata yönetimi)",
                             "Başlığı boş kitap eklenmesi engellenmeli (girdi doğrulama)",
                             "README dosyası olmalı"]),
    "a3": dict(res=TASK, days=6, title="Ödev 3: Görev Takip API", precheck=True,
               description="Görevlerin eklenip tamamlandı olarak işaretlenebildiği bir API. Testlerini de yazın.",
               requirements=["Görev ekleme endpoint'i olmalı",
                             "Görevleri listeleme endpoint'i olmalı",
                             "Görevi tamamlandı olarak işaretleme (güncelleme) endpoint'i olmalı",
                             "Görev silme endpoint'i olmalı",
                             "Başlığı boş görev reddedilmeli (girdi doğrulama)",
                             "En az 2 birim testi olmalı (pytest)"]),
}

# Hocanin notlari ve yorumlari (AI degil, akademisyenin kendi degerlendirmesi)
SCORES = {("a1", "2025001"): 95, ("a1", "2025002"): 72, ("a1", "2025003"): 45, ("a1", "2025004"): 90,
          ("a1", "2025005"): 55, ("a1", "2025006"): 85, ("a1", "2025007"): 80, ("a1", "2025008"): 40,
          ("a2", "2025001"): 98, ("a2", "2025006"): 92}
COMMENTS = {
    ("a1", "2025002"): [("Başlık boş gelirse ne oluyor? Girdi doğrulaması eksik, bir sonraki ödevde dikkat et.", True),
                        ("Genel yapı temiz, README güzel olmuş.", False)],
    ("a1", "2025003"): [("Listeleme eklenmiş ama silme ve README yok. Ödevin tamamını okumayı unutma.", False)],
    ("a1", "2025005"): [("README ve girdi doğrulaması eksik.", False)],
    ("a2", "2025001"): [("Katmanlı yapı çok iyi; repository ayrımı yerinde. Ellerine sağlık.", False)],
}
POSTS = [
    ("2025002", "Pydantic ile boş string nasıl engellenir?",
     "Başlık boş gelince hata dönmem gerekiyor ama Pydantic boş string'i kabul ediyor. Nasıl yapabilirim?",
     [("2025001", "Field(min_length=1) kullanabilirsin: `title: str = Field(min_length=1)`. Boş gelirse 422 döner."),
      ("9001", "Güzel soru. Alternatif olarak endpoint içinde `if not title.strip()` ile 400 de dönebilirsin; ikisi de kabul.")],
     ["2025001", "2025003", "2025006", "9001"]),
    ("2025003", "FastAPI'de pytest ile endpoint nasıl test edilir?",
     "Ödev 3'te test istiyor, TestClient'ı nasıl kuruyoruz?",
     [("2025006", "`from fastapi.testclient import TestClient` ve `client = TestClient(app)`; sonra `client.get(...)` ile istek atıyorsun.")],
     ["2025002", "2025006"]),
    ("2025007", "Ödünç verme için hangi HTTP kodu doğru?",
     "Kitap zaten ödünçteyse 400 mü dönmeli 409 mu?",
     [("9001", "Kaynağın mevcut durumuyla çakışma olduğu için 409 Conflict daha doğru.")],
     ["2025001"]),
]


def _files_for(spec: StudentSpec, key: str, version: tuple, by_no: dict[str, StudentSpec]) -> dict[str, str]:
    feats, readme = version
    res = ASSIGNMENTS[key]["res"]
    if isinstance(feats, str) and feats.startswith("COPY:"):
        src = by_no[feats.split(":")[1]]
        s_feats, s_readme = src.work[key][-1]
        return disguise(build_project(src.style, res, s_feats, s_readme, src.helper))
    return build_project(spec.style, res, feats, readme, spec.helper)


def seed_demo(db: Session, academician: User, course_id, department_id, make_user) -> Class | None:
    """Tanitim sinifini olusturur. Sinif varsa ve odevi de varsa dokunmaz; sinif var ama
    odevsizse (odevler silinmis / yarim kalmis) yeniden doldurur. make_user: seed'deki
    get_or_create."""
    cls = db.scalar(select(Class).where(Class.name == DEMO_CLASS_NAME))
    if cls and db.scalar(select(Assignment).where(Assignment.class_id == cls.id)):
        return None
    now = datetime.now(timezone.utc)
    if cls is None:
        cls = Class(course_id=course_id, academician_id=academician.id,
                    name=DEMO_CLASS_NAME, term="2025-Güz")
        db.add(cls)
        db.flush()
    comm = db.scalar(select(Community).where(Community.scope_ref_id == cls.id))
    if comm is None:
        comm = Community(name=f"{cls.name} — Sınıf", scope="class", scope_ref_id=cls.id,
                         created_by=academician.id)
        db.add(comm)
        db.flush()
    else:  # onceki tanitimdan kalan gonderiler tekrar eklenmesin
        # Acik sirali toplu silme: iliski tanimi olmadigi icin ORM silme sirasini
        # bilemez (yanittan once gonderiyi silip yabanci anahtar hatasi verir).
        post_ids = select(CommunityPost.id).where(CommunityPost.community_id == comm.id)
        db.execute(delete(PostVote).where(PostVote.post_id.in_(post_ids)))
        db.execute(delete(CommunityReply).where(CommunityReply.post_id.in_(post_ids)))
        db.execute(delete(CommunityPost).where(CommunityPost.community_id == comm.id))

    users = {}
    for s in STUDENTS:
        u = make_user(db, s.email, s.name, "student", department_id, school_no=s.no)
        users[s.no] = u
        if not db.scalar(select(Enrollment).where(Enrollment.class_id == cls.id,
                                                  Enrollment.student_id == u.id)):
            db.add(Enrollment(class_id=cls.id, student_id=u.id))
    users["9001"] = academician
    by_no = {s.no: s for s in STUDENTS}

    asg: dict[str, Assignment] = {}
    for key, a in ASSIGNMENTS.items():
        deadline = now + timedelta(days=a["days"])
        obj = Assignment(class_id=cls.id, title=a["title"], description=a["description"],
                         requirements_json=a["requirements"], deadline_at=deadline,
                         created_by=academician.id, created_at=deadline - timedelta(days=10),
                         precheck_enabled=bool(a.get("precheck")), precheck_limit=3)
        db.add(obj)
        db.flush()
        asg[key] = obj

    subs: dict[tuple[str, str], Submission] = {}
    for s in STUDENTS:
        for key, versions in s.work.items():
            deadline = asg[key].deadline_at
            for i, ver in enumerate(versions):
                # son surum teslimden ~1 gun once; onceki surumler daha erken
                at = min(deadline, now) - timedelta(hours=30 + 20 * (len(versions) - 1 - i))
                files = _files_for(s, key, ver, by_no)
                extracted = [ExtractedFile(path=p, content=c, size_bytes=len(c.encode()), is_binary=False)
                             for p, c in sorted(files.items())]
                sub = Submission(assignment_id=asg[key].id, student_id=users[s.no].id,
                                 version_number=i + 1, zip_storage_path="",
                                 file_tree_json=_build_tree(extracted), submitted_at=at)
                db.add(sub)
                db.flush()
                for e in extracted:
                    db.add(SubmissionFile(submission_id=sub.id, path=e.path, content=e.content,
                                          size_bytes=e.size_bytes, is_binary=False))
                subs[(key, s.no)] = sub  # en son surum kalir

    for (key, no), score in SCORES.items():
        db.add(Score(submission_id=subs[(key, no)].id, score=score, graded_by=academician.id,
                     graded_at=asg[key].deadline_at + timedelta(days=2)))
    for (key, no), items in COMMENTS.items():
        sub = subs[(key, no)]
        main = next((p for p in ("main.py", "app.py", "routes.py") if db.scalar(
            select(SubmissionFile).where(SubmissionFile.submission_id == sub.id, SubmissionFile.path == p))), None)
        for body, on_line in items:
            db.add(Comment(submission_id=sub.id, author_id=academician.id, author_type="academician",
                           file_path=main if on_line else None, line_number=1 if on_line else None,
                           body=body, created_at=asg[key].deadline_at + timedelta(days=2)))

    for i, (author, title, body, replies, voters) in enumerate(POSTS):
        at = now - timedelta(days=12 - 4 * i)
        post = CommunityPost(community_id=comm.id, author_id=users[author].id, title=title,
                             body=body, created_at=at)
        db.add(post)
        db.flush()
        for j, (who, text) in enumerate(replies):
            db.add(CommunityReply(post_id=post.id, author_id=users[who].id, body=text,
                                  created_at=at + timedelta(hours=3 + j)))
        for v in voters:
            db.add(PostVote(post_id=post.id, user_id=users[v].id))
    db.flush()
    return cls
