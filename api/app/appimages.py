"""Build-Screenshots aus Bewerbungen: prüfen, neu speichern (ohne Metadaten), ausliefern nur für Leader/Vice."""
import base64
import io
import os
import re
import secrets

from fastapi import HTTPException
from PIL import Image

IMG_DIR = os.path.join(os.environ.get("VOD_DIR", "/code/vods"), "applications")
os.makedirs(IMG_DIR, exist_ok=True)
MAX_IMAGES = 6
MAX_BYTES = 3 * 1024 * 1024          # pro Bild, nach base64-Dekodierung
MAX_SIDE = 2000
NAME_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")
DATA_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
Image.MAX_IMAGE_PIXELS = 40_000_000  # Schutz vor "Bild-Bomben"


def save_images(items) -> list[str]:
    """Nimmt data:-URLs entgegen, gibt Dateinamen zurück. Ungültiges -> 400."""
    names: list[str] = []
    try:
        for raw in (items or [])[:MAX_IMAGES]:
            m = DATA_RE.match(raw or "")
            if not m:
                raise HTTPException(status_code=400, detail="Invalid image")
            data = base64.b64decode(m.group(2), validate=True)
            if not data or len(data) > MAX_BYTES:
                raise HTTPException(status_code=400, detail="Image too large")
            try:
                with Image.open(io.BytesIO(data)) as probe:
                    probe.verify()
                with Image.open(io.BytesIO(data)) as im:
                    im = im.convert("RGB")
                    im.thumbnail((MAX_SIDE, MAX_SIDE))
                    name = secrets.token_hex(16) + ".jpg"
                    im.save(os.path.join(IMG_DIR, name), "JPEG", quality=85, optimize=True)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid image")
            names.append(name)
    except HTTPException:
        delete_images(names)
        raise
    return names


def delete_images(names) -> None:
    for n in names or []:
        if NAME_RE.match(n or ""):
            try:
                os.remove(os.path.join(IMG_DIR, n))
            except FileNotFoundError:
                pass


def image_path(name: str) -> str:
    if not NAME_RE.match(name or ""):
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return path
