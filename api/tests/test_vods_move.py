"""Gedrosseltes Verschieben auf die Storage Box: Inhalt bleibt gleich, Quelle wird entfernt."""
import os
from types import SimpleNamespace

from app import vods


def test_move_throttled_copies_and_removes(tmp_path, monkeypatch):
    src, dst_dir = tmp_path / "src.bin", tmp_path / "box"
    dst_dir.mkdir()
    data = os.urandom(3 * 1024 * 1024 + 123)
    src.write_bytes(data)
    real_stat = os.stat
    # so tun, als läge das Ziel auf einem anderen Laufwerk (wie die Storage Box)
    monkeypatch.setattr(vods.os, "stat", lambda p, *a, **k: SimpleNamespace(st_dev=1 if str(p) == str(src) else 2)
                        if str(p) in (str(src), str(dst_dir)) else real_stat(p, *a, **k))
    monkeypatch.setattr(vods, "MOVE_MBPS", 1000.0)
    vods._move(str(src), str(dst_dir / "out.bin"))
    assert (dst_dir / "out.bin").read_bytes() == data
    assert not src.exists()
    assert not (dst_dir / "out.bin.copying").exists()
