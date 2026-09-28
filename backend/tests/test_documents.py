"""Rapor/belge teslimi: DOCX/PDF/görsel yükleme, tür kontrolü, indirmeden önizleme,
yapay zekânın belge metnini okuması."""
import io
import zipfile
from datetime import datetime, timedelta, timezone

from PIL import Image

from .conftest import STUDENT_1, STUDENT_2

PDF = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 58>>stream
BT /F1 18 Tf 30 120 Td (Proje Ozeti: Kernel) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF"""


def make_docx(paragraphs: list[tuple[str, str]]) -> bytes:
    """En küçük geçerli DOCX: (stil, metin) paragrafları. stil: '' ya da 'Heading1'."""
    body = "".join(
        f'<w:p>{"<w:pPr><w:pStyle w:val=%r/></w:pPr>" % st if st else ""}<w:r><w:t>{tx}</w:t></w:r></w:p>'.replace("'", '"')
        for st, tx in paragraphs)
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f"<w:body>{body}</w:body></w:document>")
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/_rels/document.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", styles)
    return buf.getvalue()


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (216, 178, 115)).save(buf, "PNG")
    return buf.getvalue()


def _doc_assignment(client, aca):
    course = client.get("/courses", headers=aca).json()[0]
    cid = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": "Rapor Sınıfı"}).json()["id"]
    for no in (STUDENT_1, STUDENT_2):
        client.post(f"/classes/{cid}/enroll", headers=aca, json={"student_no": no})
    r = client.post("/assignments", headers=aca, json={
        "class_id": cid, "title": "Proje öneri raporu", "submission_kind": "document",
        "requirements": ["Proje özeti bölümü olmalı", "GitHub depo linki olmalı"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()})
    assert r.status_code == 201, r.text
    assert r.json()["submission_kind"] == "document"
    return cid, r.json()["id"]


def test_document_submission_preview_and_ai(client, aca, s1, s2):
    cid, aid = _doc_assignment(client, aca)
    try:
        # Kod dosyası belge ödevine yüklenemez
        bad = client.post(f"/assignments/{aid}/submissions", headers=s1,
                          files={"files": ("main.py", b"print(1)\n", "text/x-python")})
        assert bad.status_code == 400 and "rapor/belge" in bad.json()["detail"]

        docx = make_docx([("Heading1", "Proje Ozeti"), ("", "Kernel bir odev platformudur."),
                          ("", "Depo: github.com/ornek/kernel")])
        up = client.post(f"/assignments/{aid}/submissions", headers=s1, files=[
            ("files", ("rapor.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("ek.pdf", PDF, "application/pdf")),
            ("files", ("diyagram.png", png_bytes(), "image/png")),
        ])
        assert up.status_code == 201, up.text
        sid = up.json()["id"]

        # Dosya bilgisi: önizleme türü + çıkarılan metin
        f = client.get(f"/submissions/{sid}/file", headers=aca, params={"path": "rapor.docx"}).json()
        assert f["is_binary"] and f["preview"] == "docx" and f["has_text"]

        # DOCX önizleme: güvenli bloklar (HTML değil)
        pv = client.get(f"/submissions/{sid}/preview", headers=aca, params={"path": "rapor.docx"}).json()
        assert pv["kind"] == "docx"
        assert pv["blocks"][0]["t"] == "h" and pv["blocks"][0]["runs"][0]["s"] == "Proje Ozeti"

        # PDF önizleme: sayfa görüntüleri imzalı adresten
        pv = client.get(f"/submissions/{sid}/preview", headers=aca, params={"path": "ek.pdf"}).json()
        assert pv["kind"] == "pdf" and pv["page_count"] == 1 and pv["pages"][0]["width"] == 1100
        page = client.get(pv["pages"][0]["url"])
        assert page.status_code == 200 and page.headers["content-type"] == "image/png"
        assert page.content[:8] == b"\x89PNG\r\n\x1a\n"

        # Görsel
        pv = client.get(f"/submissions/{sid}/preview", headers=s1, params={"path": "diyagram.png"}).json()
        assert pv["kind"] == "image" and (pv["width"], pv["height"]) == (40, 30)
        img = client.get(pv["url"])
        assert img.status_code == 200 and img.headers["content-type"] == "image/png"
        assert img.headers["x-content-type-options"] == "nosniff"

        # Başka öğrenci göremez; imza olmadan / bozuk imzayla ham dosya yok
        assert client.get(f"/submissions/{sid}/preview", headers=s2, params={"path": "ek.pdf"}).status_code == 403
        assert client.get(f"/submissions/{sid}/raw", params={"path": "diyagram.png", "token": "x"}).status_code == 401
        other_url = pv["url"].replace(sid, "00000000-0000-0000-0000-000000000000")
        assert client.get(other_url).status_code == 401

        # Yapay zekâ belgenin metnini okur (sahte sağlayıcı: sezgisel)
        an = client.post(f"/submissions/{sid}/analyze", headers=aca, json={"analysis_type": "requirement_check"})
        assert an.status_code == 201, an.text
        assert "Kod dosyası ya da okunabilir belge yok" not in (an.json()["detail_json"] or {}).get("note", "")
        # Belge ödevinde Clean Code yok
        cc = client.post(f"/submissions/{sid}/analyze", headers=aca, json={"analysis_type": "clean_code"})
        assert cc.status_code == 400
    finally:
        client.delete(f"/assignments/{aid}", headers=aca)
        client.delete(f"/classes/{cid}", headers=aca)
