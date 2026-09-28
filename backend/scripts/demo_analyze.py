"""Tanitim sinifinin AI analizlerini (backend'in kendi uclariyla) calistirir.

Kullanim (backend/ dizininde): python scripts/demo_analyze.py <BASE_URL>
Canli AI ile calisir (~35 kucuk model cagrisi); tanitim sinifi seed edildikten sonra bir kez.
Idempotent: analizi olan teslimleri tekrar analiz etmez (analyze-pending ve
mevcut analiz kontrolu), boylece tekrar calistirmak bosa AI maliyeti yaratmaz.
"""
import io
import sys
import zipfile

import httpx

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
import os  # noqa: E402

os.environ.setdefault("DATABASE_URL", "sqlite://")
from app import demo_seed as d  # noqa: E402

import time  # noqa: E402

B = sys.argv[1].rstrip("/")
c = httpx.Client(base_url=B, timeout=600)
unfinished: list[str] = []


def post_retry(path, label, **kw):
    """AI 503 donerse (yogunluk / gecersiz cevap) biraz bekleyip en fazla 3 kez dener."""
    for attempt in range(3):
        r = c.post(path, **kw)
        if r.status_code != 503:
            r.raise_for_status()
            return r
        print(f"   ! {label}: AI yanit veremedi, {20 * (attempt + 1)} sn sonra tekrar")
        time.sleep(20 * (attempt + 1))
    unfinished.append(label)
    return None


def login(no):
    r = c.post("/auth/login-school", json={"university": "Demo", "school_no": no, "password": "parola123"})
    r.raise_for_status()
    return {"Authorization": "Bearer " + r.json()["access_token"]}


aca = login("9001")
cls = next(x for x in c.get("/classes", headers=aca).json() if x["name"] == d.DEMO_CLASS_NAME)
asgs = {a["title"]: a for a in c.get(f"/assignments?class_id={cls['id']}", headers=aca).json()}
print("sinif:", cls["name"], "| odevler:", len(asgs))

for key, spec in d.ASSIGNMENTS.items():
    a = asgs[spec["title"]]
    for attempt in range(3):  # basarisizlar "bekliyor" kalir; tekrar cagrinca yalniz onlar denenir
        r = c.post(f"/classes/{cls['id']}/ai-overview/analyze", json={"assignment_id": a["id"]}, headers=aca)
        r.raise_for_status()
        o = r.json()
        print(f"[{key}] gereksinim: yeni={o['newly_analyzed']} basarisiz={o.get('failed', 0)} "
              f"ort=%{o['average_coverage']} risk={o['at_risk_count']}")
        if not o.get("failed"):
            break
        time.sleep(20 * (attempt + 1))
    else:
        unfinished.append(f"{key} gereksinim ({o['failed']} teslim)")

    # Clean Code + intihal: yalnizca en son surumler, analizi yoksa
    for s in o["students"]:
        if not s["submission_id"] or key == "a3":
            continue
        existing = {x["analysis_type"] for x in c.get(f"/submissions/{s['submission_id']}/analyses", headers=aca).json()}
        wanted = ["clean_code"] + (["plagiarism"] if key == "a2" and s["full_name"] in ("Deniz Yıldız", "Can Öztürk") else [])
        for t in wanted:
            if t in existing:
                continue
            rr = post_retry(f"/submissions/{s['submission_id']}/analyze", f"{s['full_name']} {t}",
                            json={"analysis_type": t}, headers=aca)
            if rr is not None:
                print(f"   {s['full_name']:14s} {t}: {rr.json()['summary_json'].get('headline', '')[:70]}")

a2 = asgs[d.ASSIGNMENTS["a2"]["title"]]
r = c.post(f"/classes/{cls['id']}/ai-overview/send-feedback", json={"assignment_id": a2["id"]}, headers=aca)
r.raise_for_status()
print("A2 eksikleri iletildi:", r.json()["feedback_sent"])

# Zeynep'in Odev 3 on kontrolleri (henuz yoksa): once eksik, sonra biraz daha iyi
zey = login("2025002")
a3 = asgs[d.ASSIGNMENTS["a3"]["title"]]
st = c.get(f"/assignments/{a3['id']}/precheck", headers=zey).json()
if not st["history"]:
    spec = next(s for s in d.STUDENTS if s.no == "2025002")
    for ver in spec.work["a3"]:
        files = d.build_project(spec.style, d.TASK, ver[0], ver[1])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for p, t in files.items():
                z.writestr(p, t)
        rr = post_retry(f"/assignments/{a3['id']}/precheck", "Zeynep on kontrol", headers=zey,
                        files={"file": ("proje.zip", buf.getvalue(), "application/zip")})
        if rr is not None:
            print("Zeynep on kontrol:", rr.json()["result"]["headline"])

o = c.get(f"/classes/{cls['id']}/ai-overview", params={"assignment_id": a2["id"]}, headers=aca).json()
print("\nA2 ozeti:", o["headline"])
for t in o["insights"]:
    print(" -", t)
print("\nTAMAMLANAMAYANLAR:", unfinished or "yok")
