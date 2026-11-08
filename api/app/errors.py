"""Fehlermeldungen einheitlich: Code + Zahlen + englischer Ersatztext.
Die Website zeigt den Code in der Sprache des Besuchers (err_<code> in den Übersetzungen)."""
import re

from fastapi import Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse

# (Muster der bisherigen Meldung, Code, englischer Text mit {platzhaltern})
_RULES = [
    (r"^Not found$", "not_found", "Not found."),
    (r"^VOD nicht gefunden$", "vod_not_found", "VOD not found."),
    (r"^Notiz nicht gefunden$", "note_not_found", "Note not found."),
    (r"^VOD-Speicher \(Storage Box\) ist gerade nicht verbunden", "storage_offline", "VOD storage is not connected right now. Please tell an admin."),
    (r"^Link abgelaufen$", "link_expired", "This link has expired."),
    (r"^Ungültiger Link$", "link_invalid", "Invalid link."),
    (r"^Titel fehlt$", "title_missing", "Please enter a title."),
    (r"^Please pick a role", "role_missing", "Please pick a role."),
    (r"^Team-VODs können nur Coaches", "coach_only", "Only coaches can do that."),
    (r"^Only coaches of this role", "coach_only", "Only coaches can do that."),
    (r"^Du hast schon (?P<n>\d+) VODs hochgeladen \(max\. (?P<max>\d+)\)", "per_user_limit",
     "You already have {n} VODs uploaded (max. {max}). Delete an old one first."),
    (r"^Dateityp (?P<ext>\S+) nicht erlaubt", "file_type", "File type {ext} is not allowed."),
    (r"^Leere Datei$", "file_empty", "The file is empty."),
    (r"^Datei zu groß \(max\. (?P<max>[\d.]+) GB\)", "file_too_large", "File too large (max. {max} GB)."),
    (r"^VOD-Speicher voll \((?P<used>[\d.]+) / (?P<limit>[\d.]+) GB\)", "storage_full",
     "VOD storage is full ({used} of {limit} GB). Delete old VODs first."),
    (r"^Not enough free", "no_space", "Not enough free space right now. Try again later."),
    (r"^(Only the uploader|Nur der Uploader)", "uploader_only", "Only the uploader can do that."),
    (r"^Upload already finished$", "upload_finished", "The upload is already finished."),
    (r"^(Bad chunk index|Chunk too large|Chunk incomplete)$", "chunk_error", "Upload error, please try again."),
    (r"^Upload was cancelled$", "upload_cancelled", "The upload was cancelled."),
    (r"^Upload incomplete \((?P<n>\d+) parts missing\)", "upload_incomplete", "Upload incomplete ({n} parts missing)."),
    (r"^Keine Berechtigung$", "no_permission", "You don't have permission for that."),
    (r"^VOD wird gerade verarbeitet", "processing", "The VOD is still being processed. Try again in a moment."),
    (r"^Text fehlt$", "text_missing", "Please enter some text."),
    (r"^Not signed in$", "not_signed_in", "Please sign in first."),
    (r"^Members only$", "members_only", "Members only."),
    (r"^Leader / Vice only$", "admin_only", "Only Leader and Vice can do that."),
    (r"^Not allowed$", "no_permission", "You don't have permission for that."),
    (r"^You can't demote yourself$", "self_demote", "You can't demote yourself."),
    (r"^Bad rank$", "no_permission", "You don't have permission for that."),
    (r"^Discord login is not configured", "login_off", "Discord login isn't set up yet."),
    (r"^Missing (fields|weapon|region|gear score|screenshots|build|inner ways)$", "missing_fields", "Please fill in all required fields."),
    (r"^Bad (status|range)$", "bad_request", "Something went wrong."),
    (r"^Invalid image$", "invalid_image", "An image couldn't be read. Please use PNG, JPG or WebP."),
    (r"^Image too large$", "image_too_large", "An image is too large."),
    (r"^Invalid link$", "invalid_link", "Please check your links: they need to start with https://"),
    (r"^Too many requests", "too_many", "Too many requests. Please wait a moment."),
]
_COMPILED = [(re.compile(p), c, e) for p, c, e in _RULES]


def describe(detail):
    """Bisherige Meldung -> {"code", "params", "detail"} (detail = englischer Text)."""
    if not isinstance(detail, str):
        return {"detail": detail}
    for rx, code, en in _COMPILED:
        m = rx.search(detail)
        if m:
            params = {k: v for k, v in m.groupdict().items() if v is not None}
            return {"detail": en.format(**params), "code": code, "params": params}
    return {"detail": detail}


async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(describe(exc.detail), status_code=exc.status_code, headers=getattr(exc, "headers", None))
