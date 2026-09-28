"""Gereksinim kontrolu motoru (mock yedegi + kural degisikligi tespiti)."""
from app.services.analysis_service import FileBlob, requirement_check, requirements_changed


def test_readme_file_satisfies_readme_rule():
    files = [FileBlob("main.py", "print('merhaba')"), FileBlob("README.md", "# Proje\nAciklama")]
    res = requirement_check(files, ["README dosyası olmalı"])
    assert res["summary"]["met_count"] == 1


def test_turkish_rule_matches_code_synonyms():
    code = 'from fastapi import FastAPI\napp = FastAPI()\n@app.delete("/x/{i}")\ndef remove(i): ...\n'
    res = requirement_check([FileBlob("main.py", code)], ["Kayıt silme endpoint'i olmalı"])
    assert res["summary"]["met_count"] == 1


def test_missing_rule_is_reported_missing():
    res = requirement_check([FileBlob("main.py", "x = 1\n")], ["Veritabanı bağlantısı olmalı"])
    assert res["summary"]["missing_count"] == 1
    assert res["summary"]["coverage"] == 0


def test_every_rule_gets_a_verdict():
    reqs = ["Ekleme olmalı", "Listeleme olmalı", "Bilinmeyen kural xyz olmalı"]
    res = requirement_check([FileBlob("a.py", "def add(): pass\n")], reqs)
    s = res["summary"]
    assert s["met_count"] + s["partial_count"] + s["missing_count"] == len(reqs)


def test_no_code_files_marks_all_missing():
    res = requirement_check([FileBlob("logo.png", "")], ["A olmalı", "B olmalı"])
    assert res["summary"]["missing_count"] == 2


def test_requirements_snapshot_and_change_detection():
    res = requirement_check([FileBlob("a.py", "def add(): pass\n")], ["Ekleme olmalı"])
    d = res["detail"]
    assert d["requirements"] == ["Ekleme olmalı"]
    assert not requirements_changed(d, ["Ekleme olmalı"])
    assert not requirements_changed(d, ["  ekleme OLMALI "])  # bicim farki degisiklik degil
    assert requirements_changed(d, ["Ekleme olmalı", "Silme olmalı"])
    assert requirements_changed(d, [])


def test_change_detection_for_legacy_analysis_without_snapshot():
    legacy = {"met": [{"requirement": "Ekleme olmalı"}], "partial": [], "missing": []}
    assert not requirements_changed(legacy, ["Ekleme olmalı"])
    assert requirements_changed(legacy, ["Ekleme olmalı", "Yeni kural"])
