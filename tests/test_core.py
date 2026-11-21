import subprocess

import pytest

from backend import checkpoints, permissions, router


# ---- izinler ----
@pytest.mark.parametrize("text,skill,exp", [
    ("eski klasörü sil", None, "risky"),
    ("git push --force", None, "risky"),
    ("pcb kodu yaz", None, "write"),
    ("x", "surgical-patch", "write"),
    ("bunu açıkla", None, "safe"),
])
def test_classify(text, skill, exp):
    assert permissions.classify(text, skill) == exp


@pytest.mark.parametrize("mode,risk,exp", [
    ("g", "safe", False), ("g", "write", True), ("g", "risky", True),
    ("y", "safe", False), ("y", "write", False), ("y", "risky", True),
    ("r", "risky", False),
])
def test_needs_approval(mode, risk, exp):
    assert permissions.needs_approval(mode, risk) is exp


def test_allow_overrides():
    assert permissions.needs_approval("y", "risky", {"risky": True}) is False


# ---- yönlendirici ----
low = lambda p: 10
full = lambda p: 90


def test_route_light_local():
    assert router.route("dersi özetle", None, low).provider == "local"


def test_route_math_opus():
    assert router.route("bu integrali ispat et", None, low).provider == "claude-opus"


def test_route_code_sonnet():
    assert router.route("backend api yaz", None, low).provider == "claude-sonnet"


def test_route_chat_gemini():
    assert router.route("merhaba nasılsın", None, low).provider == "gemini-hydrogen"


def test_route_fallback_when_quota_high():
    d = router.route("backend api yaz", None, full)
    assert d.provider == "local" and d.fallback


def test_route_skill_mapping():
    assert router.route("x", "llm-council", low).provider == "claude-opus"
    assert router.route("x", "ozet", low).provider == "local"


# ---- kota (geçici veritabanı) ----
def test_quota_counts(tmp_path, monkeypatch):
    from backend import config, store
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    for _ in range(20):
        store.record_usage("claude-opus", 100, False)
    q = {x["id"]: x for x in store.quota_status()}
    assert q["claude-opus"]["count"] == 20
    assert q["claude-opus"]["used_pct"] == round(20 / config.PROVIDERS["claude-opus"]["limit"] * 100)
    assert q["local"]["used_pct"] is None


# ---- checkpoint (geçici git deposu) ----
def _g(ws, *a):
    subprocess.run(["git", *a], cwd=ws, check=True, capture_output=True)


def test_checkpoint_snapshot_restore(tmp_path):
    _g(tmp_path, "init")
    _g(tmp_path, "config", "user.email", "t@t")
    _g(tmp_path, "config", "user.name", "t")
    f = tmp_path / "a.txt"
    f.write_text("v1")
    _g(tmp_path, "add", "-A")
    _g(tmp_path, "commit", "-m", "init")
    f.write_text("v2-kaydedilmemis")
    ref = checkpoints.snapshot(tmp_path)
    assert ref
    assert f.read_text() == "v2-kaydedilmemis"  # snapshot ağacı değiştirmez
    f.write_text("v3-bozuk")
    checkpoints.restore(tmp_path, ref)
    assert f.read_text() == "v2-kaydedilmemis"


def test_checkpoint_unavailable_without_git(tmp_path):
    assert checkpoints.snapshot(tmp_path) is None


# ---- agy CLI entegrasyonu ----
def test_route_argon():
    assert router.route("bode diyagramı ve transfer fonksiyonu analizi", None, low).provider == "gemini-argon"


def test_agy_mode_flags():
    from backend import providers
    assert providers._mode_flags("r") == ["--dangerously-skip-permissions"]
    assert providers._mode_flags("y") == ["--dangerously-skip-permissions"]
    assert providers._mode_flags("g") == ["--mode", "accept-edits"]


def test_obsidian_prompt_routes_to_hydrogen():
    msg = "Bu uygulamayı test ediyorum. Obsidian için hazırladığın notları burda açar mısın?"
    assert router.route(msg, None, low).provider == "gemini-hydrogen"


def test_cloud_failover_when_sonnet_exhausted():
    pct = lambda p: 100 if p == "claude-sonnet" else 5
    d = router.route("backend api yaz", None, pct)
    assert d.provider == "gemini-hydrogen" and d.fallback


def test_vault_scan_and_chat_persistence(tmp_path, monkeypatch):
    from backend import store, vault
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "c.db")
    store.init()
    store.add_chat_msg("ai1", "me", "selam")
    store.add_chat_msg("ai1", "a", "merhaba")
    assert len(store.get_chat_msgs()["ai1"]) == 2
    v = vault.scan_vault()
    assert "tree" in v and "pages" in v


def test_session_conv_persistence(tmp_path, monkeypatch):
    from backend import store
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "s.db")
    store.init()
    assert store.get_conv_id("ai1") is None
    store.set_conv_id("ai1", "conv-123")
    assert store.get_conv_id("ai1") == "conv-123"
    store.set_conv_id("ai1", None)
    assert store.get_conv_id("ai1") is None


def test_kasa_crud_and_context(tmp_path, monkeypatch):
    from backend import store, vault
    monkeypatch.setattr(vault, "VAULT_DIR", tmp_path / "vault")
    monkeypatch.setattr(vault, "ROOT", tmp_path / "root")
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "k.db")
    store.init()
    k = vault.create_kasa("Güç Elektroniği", "EEM", "Anahtarlamalı güç kaynakları", "⚡")
    assert k["key"] == "Guc_Elektronigi"
    n = vault.create_note(k["key"], "Buck Dönüştürücü", "# Buck Dönüştürücü\nDuty cycle $D = V_o / V_i$")
    assert n["rel"].startswith("Guc_Elektronigi/")
    scan = vault.scan_vault()
    assert any(x["key"] == "Guc_Elektronigi" for x in scan["kasalar"])
    ctx = vault.build_context_from_sources([n["rel"]])
    assert "Buck Dönüştürücü" in ctx
    vault.delete_note(n["rel"])
    ev = store.add_cal_event(15, "Güç Elektroniği Quiz", "exam", k["key"])
    assert any(e["id"] == ev["id"] for e in store.get_cal_events())
    store.del_cal_event(ev["id"])


def test_model_effort_resolution():
    from backend import config
    assert config.model_for("gemini-hydrogen", "low") == "gemini-4-hydrogen-low"
    assert config.model_for("gemini-hydrogen", "medium") == "gemini-4-hydrogen-medium"
    assert config.model_for("gemini-hydrogen", "high") == "gemini-4-hydrogen-high"
    assert config.model_for("gemini-hydrogen", "xhigh") == "gemini-4-hydrogen-xhigh"
    assert config.model_for("gemini-hydrogen", "invalid") == "gemini-4-hydrogen-low"
    assert config.model_for("gemini-argon", "xhigh") == "gemini-4-argon-high"
    assert config.model_for("claude-sonnet", "xhigh") == "claude-sonnet-5-5-high"
    assert config.model_for("claude-opus", "medium") == "claude-opus-5-5-medium"


def test_legacy_flash_usage_migrates_to_hydrogen(tmp_path, monkeypatch):
    from backend import store
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "m.db")
    store.init()
    store.record_usage("gemini-flash", 100, True)
    store.init()
    q = {x["id"]: x for x in store.quota_status()}
    assert q["gemini-hydrogen"]["count"] == 1


def test_chat_image_upload_resolve_and_route(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main as bmain, store, vault

    monkeypatch.setattr(vault, "VAULT_DIR", tmp_path / "vault")
    monkeypatch.setattr(vault, "ROOT", tmp_path / "root")
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "chat_img.db")
    store.init()

    saved = vault.save_asset(".chat_images", "devre_semasi.png", b"\x89PNG\r\n\x1a\nfake")
    assert saved["rel"].startswith(".chat_images/")
    assert (tmp_path / "vault" / saved["rel"]).exists()
    assert vault.scan_vault()["tree"] == []

    with pytest.raises(ValueError):
        vault.save_asset(".chat_images", "not.md", b"# bad")

    resolved = vault.resolve_chat_images([saved["rel"], "../escape.png", "nonexistent.png"])
    assert len(resolved) == 1
    assert resolved[0].name == saved["name"]
    block = vault.build_image_prompt_block(resolved)
    assert "read_file" in block and str(resolved[0]) in block

    assert router.route("bu görseli özetle", None, low, has_images=True).provider == "gemini-hydrogen"
    assert router.route("bu görseli özetle", None, low, has_images=False).provider == "local"

    monkeypatch.setattr(bmain.providers, "agy_available", lambda: False)
    async def _fake_ollama():
        return False
    monkeypatch.setattr(bmain.providers, "ollama_alive", _fake_ollama)

    client = TestClient(bmain.app)
    r_empty = client.post("/api/run", json={"session": "ai1", "text": "   ", "images": []})
    assert r_empty.status_code == 400

    up = client.post("/api/upload?name=ekran.png&note=.chat_images", content=b"\x89PNG\r\n\x1a\n123")
    assert up.status_code == 200
    rel = up.json()["rel"]

    r_img = client.post("/api/run", json={"session": "ai_test_img", "text": "", "images": [rel]})
    assert r_img.status_code == 200
    assert r_img.json()["status"] == "started"
    assert r_img.json()["route"]["provider"] == "gemini-hydrogen"


def test_media_endpoints_and_validation(monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main as bmain, media

    captured = []

    def fake_rpc(payload):
        captured.append(payload)
        if payload.get("op") == "status":
            return {"ok": True, "active": {"app": payload.get("app") or "Spotify", "platform": "spotify", "title": "Test", "artist": "Sanatci", "playing": True}, "sessions": []}
        return {"ok": True, "handled": True, "app": payload.get("app", "")}

    monkeypatch.setattr(media, "_rpc", fake_rpc)

    client = TestClient(bmain.app)
    rs = client.get("/api/media/status?app=Chrome")
    assert rs.status_code == 200
    assert rs.json()["active"]["app"] == "Chrome"
    assert captured[-1]["app"] == "Chrome"

    rc = client.post("/api/media/cmd", json={"action": "playpause", "app": "Spotify"})
    assert rc.status_code == 200
    assert rc.json()["handled"] is True

    bad = client.post("/api/media/cmd", json={"action": "invalid"})
    assert bad.status_code == 400


def test_pptx_to_slides_endpoint(tmp_path, monkeypatch):
    import zipfile
    from fastapi.testclient import TestClient
    from backend import main, vault

    monkeypatch.setattr(vault, "VAULT_DIR", tmp_path)
    monkeypatch.setattr(main, "VAULT_DIR", tmp_path)
    pptx_path = tmp_path / "sunum.pptx"
    slide_xml = (
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        "<p:cSld><p:spTree>"
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
        "<p:txBody><a:p><a:r><a:t>Test Slayt</a:t></a:r></a:p></p:txBody></p:sp>"
        "<p:sp><p:txBody><a:p><a:r><a:t>Madde 1</a:t></a:r></a:p></p:txBody></p:sp>"
        "</p:spTree></p:cSld></p:sld>"
    )
    with zipfile.ZipFile(pptx_path, "w") as z:
        z.writestr("ppt/slides/slide1.xml", slide_xml)

    client = TestClient(main.app)
    r = client.get("/api/pptx", params={"rel": "sunum.pptx"})
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 1
    assert data["slides"][0]["title"] == "Test Slayt"
    assert data["slides"][0]["lines"] == ["Madde 1"]


def test_folder_creation_and_recursive_vault_scan(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main, vault

    vault_dir = tmp_path / "notes"
    vault_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(vault, "ROOT", tmp_path)
    monkeypatch.setattr(vault, "VAULT_DIR", vault_dir)
    monkeypatch.setattr(main, "VAULT_DIR", vault_dir)

    kasa_dir = vault_dir / "Difransiyel_Denklemler"
    kasa_dir.mkdir(parents=True, exist_ok=True)

    client = TestClient(main.app)

    rf = client.post("/api/folder", json={"parent": "Difransiyel_Denklemler", "name": "Çalışma Kağıtları"})
    assert rf.status_code == 200
    folder_rel = rf.json()["rel"]
    assert folder_rel == "Difransiyel_Denklemler/Calisma_Kagitlari"
    assert rf.json()["kasa"] == "Difransiyel_Denklemler"
    assert (vault_dir / folder_rel).is_dir()

    # Empty subfolder must appear in tree
    v1 = client.get("/api/vault").json()
    kasa_node = next(n for n in v1["tree"] if n["kasa"] == "Difransiyel_Denklemler")
    sub_node = next((c for c in kasa_node["k"] if c.get("rel") == folder_rel), None)
    assert sub_node is not None
    assert sub_node["k"] == []

    # Nested subfolder + note inside nested subfolder
    rf2 = client.post("/api/folder", json={"parent": folder_rel, "name": "Vize Soruları"})
    assert rf2.status_code == 200
    nested_rel = rf2.json()["rel"]

    rn = client.post("/api/note/create", json={"kasa": nested_rel, "title": "H1 Sorular", "content": "# H1\nSoru 1"})
    assert rn.status_code == 200
    note_rel = rn.json()["rel"]
    assert note_rel.startswith(nested_rel + "/")
    assert rn.json()["kasa"] == "Difransiyel_Denklemler"

    v2 = client.get("/api/vault").json()
    assert f"note:{note_rel}" in v2["pages"]
    assert v2["pages"][f"note:{note_rel}"]["kasa"] == "Difransiyel_Denklemler"


def test_spaces_hierarchy_and_crud(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main, vault

    vault_dir = tmp_path / "notes"
    vault_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(vault, "ROOT", tmp_path)
    monkeypatch.setattr(vault, "VAULT_DIR", vault_dir)
    monkeypatch.setattr(main, "VAULT_DIR", vault_dir)

    client = TestClient(main.app)

    # Empty vault still exposes the 3 default spaces cleanly with empty tree
    v0 = client.get("/api/vault").json()
    assert [s["id"] for s in v0["spaces"]] == ["donem_7", "donem_8", "belgeler"]
    assert v0["tree"] == []
    assert v0["root_docs"] == []

    # Create a custom Space and kasas in distinct spaces
    rs = client.post(
        "/api/space",
        json={"title": "Staj ve Sertifikalar", "icon": "💻", "accent": "#bc8cff", "tag": "Kariyer"},
    )
    assert rs.status_code == 200
    sp_id = rs.json()["id"]

    rk1 = client.post(
        "/api/kasa",
        json={"title": "Difransiyel Denklemler", "space": ""},  # known D7 default
    )
    assert rk1.status_code == 200
    assert rk1.json()["space"] == "donem_7"

    rk2 = client.post(
        "/api/kasa",
        json={"title": "Bitirme Projesi", "space": "donem_8", "accent": "#79c0ff"},
    )
    assert rk2.status_code == 200
    assert rk2.json()["space"] == "donem_8"

    rk3 = client.post(
        "/api/kasa",
        json={"title": "Belgelerim", "space": sp_id},
    )
    assert rk3.status_code == 200
    assert rk3.json()["space"] == sp_id

    # Write a root-level calendar doc -> should populate root_docs without breaking kasalar/tree
    client.post("/api/note", json={"rel": "00_LAB_ORTAK_TAKVIM.md", "content": "# Ortak Takvim\nSinav"})
    v1 = client.get("/api/vault").json()
    assert len(v1["root_docs"]) == 1
    assert v1["root_docs"][0]["rel"] == "00_LAB_ORTAK_TAKVIM.md"
    assert v1["root_docs"][0]["space"] == "donem_7"

    sp_map = {s["id"]: s for s in v1["spaces"]}
    assert sp_map["donem_7"]["count_kasas"] == 1
    assert sp_map["donem_8"]["count_kasas"] == 1
    assert sp_map[sp_id]["count_kasas"] == 1
    assert any(n["space"] == "donem_8" for n in v1["tree"] if n["kasa"] == "Bitirme_Projesi")

    # Update kasa metadata & move Bitirme_Projesi to the custom space
    ru = client.post(
        "/api/kasa/update",
        json={"key": "Bitirme_Projesi", "title": "Bitirme Tasarımı", "space": sp_id, "icon": "🚀"},
    )
    assert ru.status_code == 200
    assert ru.json()["space"] == sp_id
    assert ru.json()["label"] == "Bitirme Tasarımı"

    # Deleting custom space preserves kasas by falling back safely to belgeler
    rd = client.delete(f"/api/space?id={sp_id}")
    assert rd.status_code == 200
    assert rd.json()["fallback"] == "belgeler"

    v2 = client.get("/api/vault").json()
    bitirme = next(k for k in v2["kasalar"] if k["key"] == "Bitirme_Projesi")
    assert bitirme["space"] == "belgeler"
    assert bitirme["title"] == "Bitirme Tasarımı"
    assert bitirme["icon"] == "🚀"


def test_ui_state_persistence(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main as bmain, store

    monkeypatch.setattr(store, "DB_PATH", tmp_path / "ui.db")
    store.init()
    client = TestClient(bmain.app)

    assert client.get("/api/ui_state").json() == {}
    r = client.post("/api/ui_state", json={
        "agydesk_theme": "nord",
        "agydesk_tabs_v1": '{"openTabs":["kasalar","note:a.md"],"active":"note:a.md"}',
    })
    assert r.status_code == 200
    state = client.get("/api/ui_state").json()
    assert state["agydesk_theme"] == "nord"
    assert "note:a.md" in state["agydesk_tabs_v1"]

    # Deleting a key with None removes it without touching others
    client.post("/api/ui_state", json={"agydesk_tabs_v1": None})
    state2 = client.get("/api/ui_state").json()
    assert state2 == {"agydesk_theme": "nord"}


def test_vault_move_and_reorder(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main, vault

    vault_dir = tmp_path / "notes"
    vault_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(vault, "ROOT", tmp_path)
    monkeypatch.setattr(vault, "VAULT_DIR", vault_dir)
    monkeypatch.setattr(main, "VAULT_DIR", vault_dir)

    (vault_dir / "Katihal_Elektronigi").mkdir()
    (vault_dir / "Difransiyel_Denklemler").mkdir()
    client = TestClient(main.app)

    # Create subfolders and notes/pdfs
    f1 = client.post("/api/folder", json={"parent": "Katihal_Elektronigi", "name": "Kaynaklar"}).json()["rel"]
    f2 = client.post("/api/folder", json={"parent": "Katihal_Elektronigi", "name": "Sorular"}).json()["rel"]
    n1 = client.post("/api/note/create", json={"kasa": "Katihal_Elektronigi", "title": "Not A", "content": "# Not A"}).json()["rel"]
    n2 = client.post("/api/note/create", json={"kasa": "Katihal_Elektronigi", "title": "Not B", "content": "# Not B"}).json()["rel"]
    (vault_dir / "Katihal_Elektronigi" / "slayt.pdf").write_bytes(b"%PDF-1.4")

    # 1. Move file into folder
    rm = client.post("/api/vault/move", json={"src": "Katihal_Elektronigi/slayt.pdf", "target": f1, "position": "into"})
    assert rm.status_code == 200
    assert rm.json()["moved"] is True
    assert rm.json()["new_rel"] == f"{f1}/slayt.pdf"
    assert (vault_dir / f"{f1}/slayt.pdf").exists()
    assert not (vault_dir / "Katihal_Elektronigi/slayt.pdf").exists()

    # 2. Reorder folder before file in same kasa
    ro = client.post("/api/vault/move", json={"src": f2, "target": n1, "position": "before"})
    assert ro.status_code == 200
    assert ro.json()["reordered"] is True
    v1 = client.get("/api/vault").json()
    kat_kids = next(k["k"] for k in v1["tree"] if k["kasa"] == "Katihal_Elektronigi")
    rels = [c["rel"] for c in kat_kids]
    assert rels.index(f2) < rels.index(n1)

    # 3. Cross-folder move + position after sibling inside f1
    rm2 = client.post("/api/vault/move", json={"src": n2, "target": f"{f1}/slayt.pdf", "position": "after"})
    assert rm2.status_code == 200
    assert rm2.json()["moved"] is True
    assert rm2.json()["new_rel"] == f"{f1}/Not_B.md"
    v2 = client.get("/api/vault").json()
    kat_kids2 = next(k["k"] for k in v2["tree"] if k["kasa"] == "Katihal_Elektronigi")
    f1_node = next(c for c in kat_kids2 if c["rel"] == f1)
    assert [c["rel"] for c in f1_node["k"]] == [f"{f1}/slayt.pdf", f"{f1}/Not_B.md"]

    # 4. Move folder into another folder and verify self/descendant guard
    rm_dir = client.post("/api/vault/move", json={"src": f2, "target": f1, "position": "into"})
    assert rm_dir.status_code == 200
    new_f2 = rm_dir.json()["new_rel"]
    assert new_f2 == f"{f1}/Sorular"
    bad_self = client.post("/api/vault/move", json={"src": f1, "target": new_f2, "position": "into"})
    assert bad_self.status_code == 400

    # 5. Reorder root kasas
    rk = client.post("/api/vault/move", json={"src": "Katihal_Elektronigi", "target": "Difransiyel_Denklemler", "position": "before"})
    assert rk.status_code == 200
    v3 = client.get("/api/vault").json()
    kasa_order = [k["kasa"] for k in v3["tree"]]
    assert kasa_order.index("Katihal_Elektronigi") < kasa_order.index("Difransiyel_Denklemler")


def test_auth_hint_and_error_detection():
    from backend import providers
    assert providers.is_auth_error("authentication failed or timed out") is True
    assert providers.is_auth_error("Error: INVALID_GRANT") is True
    assert providers.is_auth_error("RESOURCE_EXHAUSTED quota") is False
    hint = providers.detect_auth_hint("Sign in at https://accounts.google.com/o/oauth2/auth?x=1")
    assert hint is not None and "https://accounts.google.com/o/oauth2/auth?x=1" in hint
    assert providers.detect_auth_hint("regular log line") is None


def test_health_exposes_auth_flags_and_force_local(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main, store

    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()

    async def fake_ollama():
        return False

    async def fake_complete(*args, **kwargs):
        return ("yerel yanıt", 5, False, None)

    monkeypatch.setattr(main.providers, "ollama_alive", fake_ollama)
    monkeypatch.setattr(main.providers, "complete", fake_complete)
    client = TestClient(main.app)

    h = client.get("/api/health").json()
    assert "auth_needed" in h and isinstance(h["auth_needed"], bool)
    assert "auth_running" in h and isinstance(h["auth_running"], bool)

    r = client.post("/api/run", json={"session": "test_force_loc", "text": "karmaşık mimari", "force_provider": "local"})
    assert r.status_code == 200
    body = r.json()
    assert body["route"]["provider"] == "local"
    assert body["route"]["fallback"] is True


def test_split_vault_notlar_and_dokuman(tmp_path, monkeypatch):
    from backend import vault

    split_root = tmp_path / "AgyDesk_Belgeler"
    (split_root / "AgyDesk_Notlar" / "Mikrodalga").mkdir(parents=True)
    (split_root / "AgyDesk_Dokuman" / "Mikrodalga").mkdir(parents=True)
    (split_root / "AgyDesk_Notlar" / "Kontrol").mkdir(parents=True)
    (split_root / "AgyDesk_Dokuman" / "Kontrol").mkdir(parents=True)

    monkeypatch.setattr(vault, "VAULT_DIR", split_root)
    monkeypatch.setattr(vault, "ROOT", tmp_path)

    # Not (.md) AgyDesk_Notlar altına gider, PDF/görsel AgyDesk_Dokuman altına gider
    created = vault.create_note("Mikrodalga", "Smith Abağı", "# Smith Abağı\nNot")
    assert created["rel"] == "Mikrodalga/Smith_Abagi.md"
    assert (split_root / "AgyDesk_Notlar" / "Mikrodalga" / "Smith_Abagi.md").exists()
    assert not (split_root / "AgyDesk_Dokuman" / "Mikrodalga" / "Smith_Abagi.md").exists()

    pdf_res = vault.save_asset("Mikrodalga", "slayt.pdf", b"%PDF-1.4\n...")
    assert pdf_res["rel"] == "Mikrodalga/slayt.pdf"
    assert (split_root / "AgyDesk_Dokuman" / "Mikrodalga" / "slayt.pdf").exists()

    img_res = vault.save_asset("Mikrodalga/Smith_Abagi.md", "ekran.png", b"\x89PNG\r\n\x1a\n")
    assert img_res["rel"].startswith("Mikrodalga/_gorseller/")
    assert (split_root / "AgyDesk_Dokuman" / img_res["rel"]).exists()

    # scan_vault her iki klasörü sanal hiyerarşide birleştirir
    tree = vault.scan_vault()
    k_mikro = next(k for k in tree["kasalar"] if k["key"] == "Mikrodalga")
    assert k_mikro["counts"]["notes"] == 1
    assert k_mikro["counts"]["docs"] == 1
    assert k_mikro["counts"]["images"] == 1
    assert "note:Mikrodalga/Smith_Abagi.md" in tree["pages"]
    assert "note:Mikrodalga/slayt.pdf" in tree["pages"]

    # Fiziksel önekli yollarla da okuma çalışır
    r_pref = vault.read_note("AgyDesk_Notlar/Mikrodalga/Smith_Abagi.md")
    assert r_pref["rel"] == "Mikrodalga/Smith_Abagi.md"
    assert "Smith Abağı" in r_pref["content"]

    # move_item .md'yi Notlar altında, .pdf'yi Dokuman altında taşır
    mv_md = vault.move_item("Mikrodalga/Smith_Abagi.md", "Kontrol", "into")
    assert mv_md["new_rel"] == "Kontrol/Smith_Abagi.md"
    assert (split_root / "AgyDesk_Notlar" / "Kontrol" / "Smith_Abagi.md").exists()

    mv_pdf = vault.move_item("Mikrodalga/slayt.pdf", "Kontrol", "into")
    assert mv_pdf["new_rel"] == "Kontrol/slayt.pdf"
    assert (split_root / "AgyDesk_Dokuman" / "Kontrol" / "slayt.pdf").exists()

    vault.delete_note("Kontrol/Smith_Abagi.md")
    assert not (split_root / "AgyDesk_Notlar" / "Kontrol" / "Smith_Abagi.md").exists()


def test_parse_agy_usage_json_and_quota():
    import json
    from backend import store

    sample = json.dumps({
        "status": "SUCCESS",
        "command": {
            "name": "usage",
            "data": {
                "groups": [
                    {
                        "name": "Gemini Models",
                        "description": "Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash",
                        "buckets": [
                            {"id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly", "remaining_fraction": 0.66, "reset_time": "2026-11-20T22:51:49Z"},
                            {"id": "gemini-5h", "name": "Five Hour Limit Remaining", "window": "5h", "remaining_fraction": 0.65, "reset_time": "2026-11-15T13:20:49Z"},
                        ],
                    },
                    {
                        "name": "Claude and GPT models",
                        "description": "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5",
                        "buckets": [
                            {"id": "3p-weekly", "name": "Weekly Limit Remaining", "window": "weekly", "remaining_fraction": 0.0, "reset_time": "2026-11-17T07:42:49Z"},
                            {"id": "3p-5h", "name": "Five Hour Limit Remaining", "window": "5h", "disabled": True, "remaining_fraction": 1.0},
                        ],
                    },
                    {
                        "name": "Gemini 4 Argon",
                        "description": "Separate Argon quota",
                        "buckets": [
                            {"id": "gemini-argon-wtu-weekly", "name": "Gemini 4 Argon Weekly Limit", "window": "weekly", "remaining_fraction": 0.74, "reset_time": "2026-11-20T23:13:24Z"},
                        ],
                    },
                ]
            },
        },
    })
    parsed = store.parse_agy_usage_json(sample, now_ts=1794745200.0)
    assert parsed is not None
    assert parsed["gemini-hydrogen"]["remaining_pct"] == 65
    assert parsed["gemini-hydrogen"]["used_pct"] == 35
    assert "Haftalık: %66" in parsed["gemini-hydrogen"]["detail"]
    assert "5 sa: %65" in parsed["gemini-hydrogen"]["detail"]
    assert parsed["gemini-argon"]["remaining_pct"] == 74
    assert parsed["gemini-argon"]["used_pct"] == 26
    assert parsed["claude-opus"]["used_pct"] == 100
    assert parsed["claude-sonnet"]["used_pct"] == 100


def test_root_docs_workspace_scoping_and_global(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main, vault

    split_root = tmp_path / "AgyDesk_Belgeler"
    (split_root / "AgyDesk_Notlar" / "Elektrik_Makineleri_Lab").mkdir(parents=True)
    (split_root / "AgyDesk_Dokuman" / "Elektrik_Makineleri_Lab").mkdir(parents=True)

    monkeypatch.setattr(vault, "VAULT_DIR", split_root)
    monkeypatch.setattr(vault, "ROOT", tmp_path)
    monkeypatch.setattr(main, "VAULT_DIR", split_root)

    client = TestClient(main.app)

    # 1. 00_LAB_ORTAK_TAKVIM.md stays at AgyDesk_Notlar root, scopes to donem_7, preserves wikilink
    (split_root / "AgyDesk_Notlar" / "00_LAB_ORTAK_TAKVIM.md").write_text(
        "# 7. Dönem Lab Takvimi\n", encoding="utf-8"
    )
    (split_root / "AgyDesk_Notlar" / "Elektrik_Makineleri_Lab" / "00_LAB_CALISMA_PLANI.md").write_text(
        "# Plan\n- Bakınız: [[00_LAB_ORTAK_TAKVIM]]\n", encoding="utf-8"
    )
    # 2. Unconfigured generic root doc defaults to global ("all")
    (split_root / "AgyDesk_Notlar" / "00_GENEL_REHBER.md").write_text(
        "# Genel Rehber\n", encoding="utf-8"
    )
    # 3. Frontmatter-scoped root doc for donem_8 (title stripped cleanly past frontmatter)
    (split_root / "AgyDesk_Notlar" / "00_DONEM8_TAKVIM.md").write_text(
        "---\n# yaml comment\nspace: donem_8\n---\n# 8. Dönem Takvimi\n", encoding="utf-8"
    )
    # 4. Frontmatter multi-space root doc
    (split_root / "AgyDesk_Notlar" / "00_MULTI_ORTAK.md").write_text(
        "---\nspaces:\n  - donem_7\n  - donem_8\n---\n# Çoklu Dönem Notu\n", encoding="utf-8"
    )

    v = client.get("/api/vault").json()
    by_rel = {d["rel"]: d for d in v["root_docs"]}

    assert by_rel["00_LAB_ORTAK_TAKVIM.md"]["space"] == "donem_7"
    assert by_rel["00_LAB_ORTAK_TAKVIM.md"]["spaces"] == ["donem_7"]
    assert by_rel["00_LAB_ORTAK_TAKVIM.md"]["global"] is False

    assert by_rel["00_GENEL_REHBER.md"]["space"] == "all"
    assert by_rel["00_GENEL_REHBER.md"]["spaces"] == ["all"]
    assert by_rel["00_GENEL_REHBER.md"]["global"] is True

    assert by_rel["00_DONEM8_TAKVIM.md"]["space"] == "donem_8"
    assert by_rel["00_DONEM8_TAKVIM.md"]["global"] is False
    assert by_rel["00_DONEM8_TAKVIM.md"]["title"] == "8. Dönem Takvimi"
    assert by_rel["00_DONEM8_TAKVIM.md"]["scope_source"] == "frontmatter"

    assert by_rel["00_MULTI_ORTAK.md"]["spaces"] == ["donem_7", "donem_8"]
    assert by_rel["00_MULTI_ORTAK.md"]["global"] is False

    # Wikilink + backlink + read_note all remain intact at original path
    assert v["wikimap"]["00_lab_ortak_takvim"] == "note:00_LAB_ORTAK_TAKVIM.md"
    assert any(
        b["id"] == "note:Elektrik_Makineleri_Lab/00_LAB_CALISMA_PLANI.md"
        for b in v["backlinks"].get("note:00_LAB_ORTAK_TAKVIM.md", [])
    )
    rn = client.get("/api/note", params={"rel": "00_DONEM8_TAKVIM.md"}).json()
    assert rn["space"] == "donem_8"
    assert rn["global"] is False
    assert rn["title"] == "8. Dönem Takvimi"

    # Config API overrides frontmatter/default and persists to .agydesk_spaces.json
    ru = client.post(
        "/api/root_doc/space",
        json={"rel": "00_LAB_ORTAK_TAKVIM.md", "space": "all"},
    )
    assert ru.status_code == 200
    assert ru.json()["global"] is True
    assert ru.json()["space"] == "all"

    ru2 = client.post(
        "/api/root_doc/space",
        json={"rel": "00_LAB_ORTAK_TAKVIM.md", "space": "donem_7"},
    )
    assert ru2.status_code == 200
    assert ru2.json()["global"] is False
    assert ru2.json()["space"] == "donem_7"
    assert ru2.json()["scope_source"] == "config"

    v2 = client.get("/api/vault").json()
    d_lab = next(d for d in v2["root_docs"] if d["rel"] == "00_LAB_ORTAK_TAKVIM.md")
    assert d_lab["space"] == "donem_7"
    assert d_lab["global"] is False
    assert d_lab["scope_source"] == "config"











