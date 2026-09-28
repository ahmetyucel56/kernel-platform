"""AI cevap veremediginde: saglam JSON okuma, tek yeniden deneme, sessiz yedek YOK,
hicbir sey kaydedilmez, kullaniciya 503 + 'tekrar dene'."""
import json

import pytest

from app.services import analysis_service as ana
from app.services.analysis_service import FileBlob

from .conftest import zip_bytes

REQ = ["A olmalı"]
GOOD_ITEMS = {"items": [{"requirement": "A olmalı", "status": "met", "evidence": "var", "where": "main.py"}]}


class Scripted:
    """Siradaki cevaplari dondurur; cagrilari kaydeder."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def complete(self, system, prompt, *, max_tokens=1024):
        self.calls.append({"system": system, "prompt": prompt, "max_tokens": max_tokens})
        r = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def real_mode(monkeypatch):
    monkeypatch.setattr(ana, "_use_mock", lambda: False)

    def install(provider):
        monkeypatch.setattr(ana, "get_ai_provider", lambda: provider)
        return provider
    return install


def test_fenced_json_with_surrounding_text_is_parsed(real_mode):
    real_mode(Scripted(["Tabii! ```json\n" + json.dumps({"score": "85", "summary": "iyi"}) + "\n``` Umarım işe yarar."]))
    res = ana.clean_code([FileBlob("main.py", "x = 1\n")])
    assert res["summary"]["score"] == 85  # metin skor tamsayiya cevrildi


def test_truncated_reply_is_retried_with_bigger_budget(real_mode):
    p = real_mode(Scripted(['{"score": 70, "summary": "yarim kal', json.dumps({"score": 70, "summary": "tamam"})]))
    res = ana.clean_code([FileBlob("main.py", "x = 1\n")])
    assert res["summary"]["score"] == 70 and len(p.calls) == 2
    assert p.calls[1]["max_tokens"] > p.calls[0]["max_tokens"]
    assert "GECERLI JSON" in p.calls[1]["system"]


def test_provider_errors_raise_instead_of_heuristic(real_mode):
    real_mode(Scripted([RuntimeError("529 overloaded")]))
    with pytest.raises(ana.AIUnavailable):
        ana.clean_code([FileBlob("main.py", "x = 1\n")])
    with pytest.raises(ana.AIUnavailable):
        ana.mentor_reply([], [FileBlob("main.py", "x = 1\n")], "Neden hata alıyorum?")


def test_single_analysis_returns_503_and_stores_nothing(client, aca, s1, make_assignment, submit, real_mode):
    real_mode(Scripted(["json yok"]))
    aid = make_assignment(REQ)
    sub = submit(s1, aid, {"main.py": "x = 1\n"})
    r = client.post(f"/submissions/{sub['id']}/analyze", headers=aca, json={"analysis_type": "clean_code"})
    assert r.status_code == 503 and "kaydedilmedi" in r.json()["detail"]
    assert client.get(f"/submissions/{sub['id']}/analyses", headers=aca).json() == []


def test_batch_keeps_failed_ones_pending(client, aca, s1, s2, class_id, make_assignment, submit, real_mode):
    class Picky:
        def complete(self, system, prompt, *, max_tokens=1024):
            return "bozuk" if "FAIL_MARK" in prompt else json.dumps(GOOD_ITEMS)

    real_mode(Picky())
    aid = make_assignment(REQ)
    submit(s1, aid, {"main.py": "a = 1\n"})
    submit(s2, aid, {"main.py": "FAIL_MARK = 1\n"})
    o = client.post(f"/classes/{class_id}/ai-overview/analyze", json={"assignment_id": aid}, headers=aca).json()
    assert (o["newly_analyzed"], o["failed"], o["pending_count"]) == (1, 1, 1)

    real_mode(Scripted([json.dumps(GOOD_ITEMS)]))  # AI toparlandi -> tekrar dene
    o = client.post(f"/classes/{class_id}/ai-overview/analyze", json={"assignment_id": aid}, headers=aca).json()
    assert (o["newly_analyzed"], o["failed"], o["pending_count"]) == (1, 0, 0)


def test_failed_precheck_does_not_consume_quota(client, aca, s1, make_assignment, real_mode):
    real_mode(Scripted(["json yok"]))
    aid = make_assignment(REQ)
    client.patch(f"/assignments/{aid}", headers=aca, json={"precheck_enabled": True})
    r = client.post(f"/assignments/{aid}/precheck", headers=s1,
                    files={"file": ("p.zip", zip_bytes({"main.py": "x = 1\n"}), "application/zip")})
    assert r.status_code == 503
    st = client.get(f"/assignments/{aid}/precheck", headers=s1).json()
    assert st["used"] == 0 and st["remaining"] == 3


def test_failed_mentor_reply_stores_no_messages(client, s1, make_assignment, submit, real_mode):
    real_mode(Scripted([RuntimeError("timeout")]))
    aid = make_assignment(REQ)
    sub = submit(s1, aid, {"main.py": "x = 1\n"})
    r = client.post(f"/submissions/{sub['id']}/chat", headers=s1, json={"message": "Yardım?"})
    assert r.status_code == 503
    assert client.get(f"/submissions/{sub['id']}/chat", headers=s1).json() == []


def test_deleting_assignment_removes_its_notifications(client, aca, s1, make_assignment, submit):
    aid = make_assignment(REQ)  # kayitli ogrencilere "yeni odev" bildirimi gider
    sub = submit(s1, aid, {"main.py": "x = 1\n"})
    client.post(f"/submissions/{sub['id']}/score", headers=aca, json={"score": 50})
    mine = lambda: [n for n in client.get("/me/notifications", headers=s1).json()
                    if n["assignment_id"] == aid or n["submission_id"] == sub["id"]]
    assert mine()
    assert client.delete(f"/assignments/{aid}", headers=aca).status_code == 204
    assert mine() == []
