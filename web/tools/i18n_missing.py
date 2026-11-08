"""Fehlende Übersetzungen finden: python web/tools/i18n_missing.py (Englisch ist die Vorlage)."""
import re, json, sys
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "i18n")
# Begriffe, die in allen Sprachen gleich bleiben (Eigennamen, Abkürzungen)
SAME = {"float_region", "kind_gvg", "m_euw", "m_gvg", "nav_discord", "none", "plat_pc", "plat_ps", "role_nameless", "role_team",
        "vod_r_none", "apps_vods", "rank_coach", "rank_leader", "role_healer", "role_tank"}
KEY = re.compile(r'(?:^[ \t]*|,[ \t]+|\{[ \t]*)([a-z][a-z0-9_]*)[ \t]*:[ \t]*["`]', re.M)


def keys(text):
    return set(KEY.findall(text))


def block(text, name):
    start = text.index("const en = {" if name == "en" else f"const {name}: Partial<ExtraDict> = {{")
    return text[start:text.index("\n};", start)]


en_base = open(os.path.join(D, "en.ts"), encoding="utf-8").read()
extra = open(os.path.join(D, "extra.ts"), encoding="utf-8").read()
EN = keys(en_base) | keys(block(extra, "en"))
out = {}
for lang in ["de", "fr", "es", "pt", "ru", "tr", "pl"]:
    have = keys(open(D + f"\\{lang}.ts", encoding="utf-8").read()) | keys(block(extra, lang))
    out[lang] = sorted(k for k in EN - have if k not in SAME and not k.startswith("weapon_"))
for lang in ["ar", "fi"]:
    out[lang] = sorted(k for k in EN - keys(open(D + f"\\{lang}.ts", encoding="utf-8").read()) if k not in SAME and not k.startswith("weapon_"))
for k, v in out.items():
    print(k, len(v), v[:60])
