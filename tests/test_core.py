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
    assert router.route("merhaba nasılsın", None, low).provider == "gemini-flash"


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


def test_obsidian_prompt_routes_to_flash():
    msg = "Bu uygulamayı test ediyorum. Obsidian için hazırladığın notları burda açar mısın?"
    assert router.route(msg, None, low).provider == "gemini-flash"


def test_cloud_failover_when_sonnet_exhausted():
    pct = lambda p: 100 if p == "claude-sonnet" else 5
    d = router.route("backend api yaz", None, pct)
    assert d.provider == "gemini-flash" and d.fallback


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


