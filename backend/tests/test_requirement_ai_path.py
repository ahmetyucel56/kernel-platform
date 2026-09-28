"""Gercek AI yolu (sahte saglayici ile) ve buyuk projelerde baglam secimi."""
import json

import pytest

from app.services import analysis_service as ana
from app.services.analysis_service import FileBlob


class FakeProvider:
    def __init__(self, reply: dict):
        self.reply = reply
        self.prompts: list[str] = []

    def complete(self, system: str, prompt: str, *, max_tokens: int = 1024) -> str:
        self.prompts.append(prompt)
        return "Iste sonuc:\n" + json.dumps(self.reply, ensure_ascii=False)


@pytest.fixture
def fake_ai(monkeypatch):
    def _install(reply: dict) -> FakeProvider:
        fake = FakeProvider(reply)
        monkeypatch.setattr(ana, "_use_mock", lambda: False)
        monkeypatch.setattr(ana, "get_ai_provider", lambda: fake)
        return fake
    return _install


def test_ai_items_are_bucketed_with_evidence(fake_ai):
    reqs = ["Not ekleme endpoint'i olmalı", "README olmalı", "Silme olmalı"]
    fake = fake_ai({"items": [
        {"requirement": "Not ekleme endpoint'i olmalı", "status": "met",
         "evidence": "@app.post('/notes') var", "where": "main.py"},
        {"requirement": "readme olmalı", "status": "missing", "evidence": "README yok", "where": ""},
        # "Silme olmalı" AI tarafindan atlandi -> guvenli tarafta 'eksik' sayilmali
    ]})
    res = ana.requirement_check([FileBlob("main.py", "@app.post('/notes')\ndef add(): ...\n")], reqs)

    s, d = res["summary"], res["detail"]
    assert (s["met_count"], s["partial_count"], s["missing_count"]) == (1, 0, 2)
    assert d["met"][0]["where"] == "main.py" and "post" in d["met"][0]["evidence"]
    # Kucuk/buyuk harf farkiyla donen madde orijinal metne eslenir
    assert any(m["requirement"] == "README olmalı" for m in d["missing"])
    skipped = next(m for m in d["missing"] if m["requirement"] == "Silme olmalı")
    assert "elle kontrol" in skipped["note"]
    assert d["requirements"] == reqs
    # Prompt: numarali kurallar + dosya listesi + kod
    p = fake.prompts[0]
    assert "1. Not ekleme endpoint'i olmalı" in p and "PROJEDEKI DOSYALAR" in p and "main.py" in p


def test_invalid_ai_reply_is_not_silently_replaced(monkeypatch):
    """Gercek AI modunda gecersiz cevap sezgisel sonuca DONUSMEZ; acik hata verir."""
    class Broken:
        def complete(self, *a, **k):
            return "uzgunum, json veremem"
    monkeypatch.setattr(ana, "_use_mock", lambda: False)
    monkeypatch.setattr(ana, "get_ai_provider", lambda: Broken())
    with pytest.raises(ana.AIUnavailable):
        ana.requirement_check([FileBlob("a.py", "def delete_item(): ...\n")], ["Silme olmalı"])


def _filler(i: int) -> FileBlob:
    body = "\n".join(f"def helper_{i}_{j}(x):\n    return x * {j}\n" for j in range(60))
    return FileBlob(f"a_util_{i:02d}.py", body)  # alfabetik olarak once gelir


def test_relevant_file_reaches_ai_in_big_project(fake_ai):
    fillers = [_filler(i) for i in range(25)]  # ~25 x 2.4k karakter >> 16k butce
    routes = FileBlob("z_routes.py",
                      '@app.put("/notes/{nid}")\ndef update_note(nid: int, title: str):\n    notes[nid] = title\n')
    fake = fake_ai({"items": [{"requirement": "Not güncelleme endpoint'i olmalı",
                               "status": "met", "evidence": "update_note", "where": "z_routes.py"}]})
    res = ana.requirement_check(fillers + [routes], ["Not güncelleme endpoint'i olmalı"])

    prompt = fake.prompts[0]
    code_part = prompt.split("OGRENCI KODU")[1]
    # Ilgili dosya TAM icerikle ve en basta
    assert code_part.index("### z_routes.py") < code_part.index("### a_util_")
    assert "notes[nid] = title" in prompt
    # Sigmayan dosyalar tamamen kaybolmaz, imzalariyla gelir
    assert "[yalnizca imzalar]" in prompt
    assert "imzalarıyla" in res["detail"]["note"]


def test_context_budget_is_respected():
    files = [_filler(i) for i in range(40)]
    ctx, outlined = ana._requirement_context(files, ["Yardımcı fonksiyon olmalı"])
    assert len(ctx) <= 16000 + 6000 + 200
    assert outlined > 0


def test_single_huge_relevant_file_is_truncated_not_dropped():
    big = FileBlob("main.py", "@app.delete('/x')\ndef remove():\n    pass\n" + "# dolgu\n" * 5000)
    ctx, _ = ana._requirement_context([big], ["Silme endpoint'i olmalı"])
    assert "def remove()" in ctx and "dosya kesildi" in ctx


def test_outline_extracts_routes_and_signatures():
    f = FileBlob("server.js", "const x = 1;\napp.get('/users', list);\nfunction listUsers(req, res) {\n  return 1;\n}\n")
    o = ana._outline(f)
    assert "app.get('/users', list);" in o and "function listUsers(req, res) {" in o
    assert "return 1" not in o
