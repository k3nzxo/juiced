"""Spieldaten Where Winds Meet (erzeugt, passend zu web/src/data/wwm.ts)."""
PATHS = {
    "bellstrike_splendor": "dps",
    "bellstrike_umbra": "dps",
    "bamboocut_wind": "dps",
    "bamboocut_dust": "dps",
    "bamboocut_kite": "dps",
    "bamboocut_draught": "dps",
    "silkbind_jade": "dps",
    "silkbind_deluge": "healer",
    "silkbind_wings": "healer",
    "stonesplit_might": "tank",
    "stonesplit_strength": "dps",
}
INNER_WAYS = {
    "skyspeak": "bamboocut_draught",
    "eonpour": "bamboocut_draught",
    "volutefit": "bamboocut_draught",
    "mistwing": "bamboocut_draught",
    "phantom_rally": "bamboocut_dust",
    "song_of_tang": "bamboocut_dust",
    "towline_sweep": "bamboocut_dust",
    "light_anew": "bamboocut_dust",
    "soaring_high": "bamboocut_kite",
    "empirical_edge": "bamboocut_kite",
    "sky_gripped": "bamboocut_kite",
    "celestial_vigor": "bamboocut_kite",
    "echoes_of_oblivion": "bamboocut_wind",
    "vendetta": "bamboocut_wind",
    "breaking_point": "bamboocut_wind",
    "riptide_reflex": "bamboocut_wind",
    "sword_morph": "bellstrike_splendor",
    "battle_anthem": "bellstrike_splendor",
    "wildfire_spark": "bellstrike_splendor",
    "mountains_might": "bellstrike_splendor",
    "sandswirl_tail": "bellstrike_splendor",
    "sword_horizon": "bellstrike_umbra",
    "wolfchasers_art": "bellstrike_umbra",
    "adaptive_steel": "bellstrike_umbra",
    "insightful_strike": "bellstrike_umbra",
    "seasonal_edge": "general",
    "morale_chant": "general",
    "heart_of_fire": "general",
    "invigorated_warrior": "general",
    "divine_roulette": "general",
    "evasive_charge": "general",
    "fury_harvest": "general",
    "vital_leech": "general",
    "bitter_seasons": "general",
    "shadow_assault": "general",
    "fivefold_bleed": "general",
    "steadfast_stance": "general",
    "evening_snow": "general",
    "wind_beneath_wings": "general",
    "royal_remedy": "silkbind_deluge",
    "restoring_blossom": "silkbind_deluge",
    "esoteric_revival": "silkbind_deluge",
    "mending_loom": "silkbind_deluge",
    "blossom_barrage": "silkbind_jade",
    "light_and_shadow_alike": "silkbind_jade",
    "flying_gourds": "silkbind_jade",
    "thunderous_bloom": "silkbind_jade",
    "star_reacher": "silkbind_jade",
    "harmony_song": "silkbind_wings",
    "blades_will": "silkbind_wings",
    "zephyr_whispers": "silkbind_wings",
    "ink_and_strings": "silkbind_wings",
    "exquisite_scenery": "stonesplit_might",
    "art_of_resistance": "stonesplit_might",
    "rock_solid": "stonesplit_might",
    "trapped_beast": "stonesplit_might",
    "frost_clad_night": "stonesplit_strength",
    "wildfire_surge": "stonesplit_strength",
    "throat_piercing_art": "stonesplit_strength",
    "steadfast_devotion": "stonesplit_strength",
}


# Waffen (für Builds aus zwei beliebigen Waffen)
WEAPONS = {
    "nameless_sword": "bellstrike",
    "strategic_sword": "bellstrike",
    "nameless_spear": "bellstrike",
    "heavenquaker_spear": "bellstrike",
    "infernal_twinblades": "bamboocut",
    "riven_twinblades": "bamboocut",
    "mortal_rope_dart": "bamboocut",
    "unfettered_rope_dart": "bamboocut",
    "skygrasp_rope_dart": "bamboocut",
    "everspring_umbrella": "bamboocut",
    "heavenwill_gauntlets": "bamboocut",
    "skystrike_gauntlets": "bamboocut",
    "inkwell_fan": "silkbind",
    "vernal_umbrella": "silkbind",
    "panacea_fan": "silkbind",
    "soulshade_umbrella": "silkbind",
    "willowbend_fan": "silkbind",
    "museflow_drum": "silkbind",
    "thundercry_blade": "stonesplit",
    "stormbreaker_spear": "stonesplit",
    "snowparting_blade": "stonesplit",
    "phalanxbane_blade": "stonesplit",
}
# alte Pfade -> Waffenpaar (für die Übernahme bestehender Profile)
PATH_WEAPONS = {
    "bellstrike_splendor": ("nameless_sword", "nameless_spear"),
    "bellstrike_umbra": ("strategic_sword", "heavenquaker_spear"),
    "bamboocut_wind": ("infernal_twinblades", "mortal_rope_dart"),
    "bamboocut_dust": ("everspring_umbrella", "unfettered_rope_dart"),
    "bamboocut_kite": ("heavenwill_gauntlets", "skygrasp_rope_dart"),
    "bamboocut_draught": ("riven_twinblades", "skystrike_gauntlets"),
    "silkbind_jade": ("inkwell_fan", "vernal_umbrella"),
    "silkbind_deluge": ("panacea_fan", "soulshade_umbrella"),
    "silkbind_wings": ("willowbend_fan", "museflow_drum"),
    "stonesplit_might": ("thundercry_blade", "stormbreaker_spear"),
    "stonesplit_strength": ("snowparting_blade", "phalanxbane_blade"),
}


def build_id(a: str, b: str) -> str:
    return "+".join(sorted((a, b)))


def clean_build(v) -> str | None:
    """'a+b' mit zwei bekannten, verschiedenen Waffen -> sortierte ID, sonst None."""
    parts = [x for x in str(v or "").split("+") if x in WEAPONS]
    if len(parts) != 2 or parts[0] == parts[1]:
        return None
    return build_id(*parts)
