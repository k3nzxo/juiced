// Spieldaten Where Winds Meet: Pfade (Waffenpaare) und Inner Ways. Erzeugt, Bilder unter /wwm/iw/.
export type Path = { id: string; name: string; group: string; role: "dps" | "tank" | "healer"; weapons: string[] };
export const PATHS: Path[] = [
  { id: "bellstrike_splendor", name: "Bellstrike · Splendor", group: "bellstrike", role: "dps", weapons: ["Nameless Sword", "Nameless Spear"] },
  { id: "bellstrike_umbra", name: "Bellstrike · Umbra", group: "bellstrike", role: "dps", weapons: ["Strategic Sword", "Heavenquaker Spear"] },
  { id: "bamboocut_wind", name: "Bamboocut · Wind", group: "bamboocut", role: "dps", weapons: ["Infernal Twinblades", "Mortal Rope Dart"] },
  { id: "bamboocut_dust", name: "Bamboocut · Dust", group: "bamboocut", role: "dps", weapons: ["Everspring Umbrella", "Unfettered Rope Dart"] },
  { id: "bamboocut_kite", name: "Bamboocut · Kite", group: "bamboocut", role: "dps", weapons: ["Heavenwill Gauntlets", "Skygrasp Rope Dart"] },
  { id: "bamboocut_draught", name: "Bamboocut · Draught", group: "bamboocut", role: "dps", weapons: ["Riven Twinblades", "Skystrike Gauntlets"] },
  { id: "silkbind_jade", name: "Silkbind · Jade", group: "silkbind", role: "dps", weapons: ["Inkwell Fan", "Vernal Umbrella"] },
  { id: "silkbind_deluge", name: "Silkbind · Deluge", group: "silkbind", role: "healer", weapons: ["Panacea Fan", "Soulshade Umbrella"] },
  { id: "silkbind_wings", name: "Silkbind · Wings", group: "silkbind", role: "healer", weapons: ["Willowbend Fan", "Museflow Waist Drum"] },
  { id: "stonesplit_might", name: "Stonesplit · Might", group: "stonesplit", role: "tank", weapons: ["Thundercry Blade", "Stormbreaker Spear"] },
  { id: "stonesplit_strength", name: "Stonesplit · Strength", group: "stonesplit", role: "dps", weapons: ["Snowparting Blade", "Phalanxbane Blade"] },
];
export type InnerWay = { id: string; name: string; path: string };
export const INNER_WAYS: InnerWay[] = [
  { id: "skyspeak", name: "Skyspeak", path: "bamboocut_draught" },
  { id: "eonpour", name: "Eonpour", path: "bamboocut_draught" },
  { id: "volutefit", name: "Volutefit", path: "bamboocut_draught" },
  { id: "mistwing", name: "Mistwing", path: "bamboocut_draught" },
  { id: "phantom_rally", name: "Phantom Rally", path: "bamboocut_dust" },
  { id: "song_of_tang", name: "Song of Tang", path: "bamboocut_dust" },
  { id: "towline_sweep", name: "Towline Sweep", path: "bamboocut_dust" },
  { id: "light_anew", name: "Light Anew", path: "bamboocut_dust" },
  { id: "soaring_high", name: "Soaring High", path: "bamboocut_kite" },
  { id: "empirical_edge", name: "Empirical Edge", path: "bamboocut_kite" },
  { id: "sky_gripped", name: "Sky Gripped", path: "bamboocut_kite" },
  { id: "celestial_vigor", name: "Celestial Vigor", path: "bamboocut_kite" },
  { id: "echoes_of_oblivion", name: "Echoes of Oblivion", path: "bamboocut_wind" },
  { id: "vendetta", name: "Vendetta", path: "bamboocut_wind" },
  { id: "breaking_point", name: "Breaking Point", path: "bamboocut_wind" },
  { id: "riptide_reflex", name: "Riptide Reflex", path: "bamboocut_wind" },
  { id: "sword_morph", name: "Sword Morph", path: "bellstrike_splendor" },
  { id: "battle_anthem", name: "Battle Anthem", path: "bellstrike_splendor" },
  { id: "wildfire_spark", name: "Wildfire Spark", path: "bellstrike_splendor" },
  { id: "mountains_might", name: "Mountain's Might", path: "bellstrike_splendor" },
  { id: "sandswirl_tail", name: "Sandswirl Tail", path: "bellstrike_splendor" },
  { id: "sword_horizon", name: "Sword Horizon", path: "bellstrike_umbra" },
  { id: "wolfchasers_art", name: "Wolfchaser's Art", path: "bellstrike_umbra" },
  { id: "adaptive_steel", name: "Adaptive Steel", path: "bellstrike_umbra" },
  { id: "insightful_strike", name: "Insightful Strike", path: "bellstrike_umbra" },
  { id: "seasonal_edge", name: "Seasonal Edge", path: "general" },
  { id: "morale_chant", name: "Morale Chant", path: "general" },
  { id: "heart_of_fire", name: "Heart of Fire", path: "general" },
  { id: "invigorated_warrior", name: "Invigorated Warrior", path: "general" },
  { id: "divine_roulette", name: "Divine Roulette", path: "general" },
  { id: "evasive_charge", name: "Evasive Charge", path: "general" },
  { id: "fury_harvest", name: "Fury Harvest", path: "general" },
  { id: "vital_leech", name: "Vital Leech", path: "general" },
  { id: "bitter_seasons", name: "Bitter Seasons", path: "general" },
  { id: "shadow_assault", name: "Shadow Assault", path: "general" },
  { id: "fivefold_bleed", name: "Fivefold Bleed", path: "general" },
  { id: "steadfast_stance", name: "Steadfast Stance", path: "general" },
  { id: "evening_snow", name: "Evening Snow", path: "general" },
  { id: "wind_beneath_wings", name: "Wind Beneath Wings", path: "general" },
  { id: "royal_remedy", name: "Royal Remedy", path: "silkbind_deluge" },
  { id: "restoring_blossom", name: "Restoring Blossom", path: "silkbind_deluge" },
  { id: "esoteric_revival", name: "Esoteric Revival", path: "silkbind_deluge" },
  { id: "mending_loom", name: "Mending Loom", path: "silkbind_deluge" },
  { id: "blossom_barrage", name: "Blossom Barrage", path: "silkbind_jade" },
  { id: "light_and_shadow_alike", name: "Light and Shadow Alike", path: "silkbind_jade" },
  { id: "flying_gourds", name: "Flying Gourds", path: "silkbind_jade" },
  { id: "thunderous_bloom", name: "Thunderous Bloom", path: "silkbind_jade" },
  { id: "star_reacher", name: "Star Reacher", path: "silkbind_jade" },
  { id: "harmony_song", name: "Harmony Song", path: "silkbind_wings" },
  { id: "blades_will", name: "Blade's Will", path: "silkbind_wings" },
  { id: "zephyr_whispers", name: "Zephyr Whispers", path: "silkbind_wings" },
  { id: "ink_and_strings", name: "Ink and Strings", path: "silkbind_wings" },
  { id: "exquisite_scenery", name: "Exquisite Scenery", path: "stonesplit_might" },
  { id: "art_of_resistance", name: "Art of Resistance", path: "stonesplit_might" },
  { id: "rock_solid", name: "Rock Solid", path: "stonesplit_might" },
  { id: "trapped_beast", name: "Trapped Beast", path: "stonesplit_might" },
  { id: "frost_clad_night", name: "Frost-Clad Night", path: "stonesplit_strength" },
  { id: "wildfire_surge", name: "Wildfire Surge", path: "stonesplit_strength" },
  { id: "throat_piercing_art", name: "Throat-Piercing Art", path: "stonesplit_strength" },
  { id: "steadfast_devotion", name: "Steadfast Devotion", path: "stonesplit_strength" },
];
export const pathById = (id: string | null | undefined) => PATHS.find((p) => p.id === id);
export const innerWayById = (id: string) => INNER_WAYS.find((w) => w.id === id);
export const innerWayImg = (id: string) => `/wwm/iw/${id}.webp`;
// Raid-Helper-Klassen/Specs ("Bellstrike_Splendor", "Silkbind Deluge") auf unsere Pfade abbilden
export const pathFromText = (s: string | null | undefined) => { const k = String(s || "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""); return PATHS.find((p) => p.id === k); };

// ---------------------------------------------------------------- Waffen + Builds (zwei beliebige Waffen, auch Hybride)
export type School = "bellstrike" | "bamboocut" | "silkbind" | "stonesplit";
export const SCHOOLS: { id: School; name: string; color: string }[] = [
  { id: "bellstrike", name: "Bellstrike", color: "#3b82f6" },
  { id: "bamboocut", name: "Bamboocut", color: "#a855f7" },
  { id: "silkbind", name: "Silkbind", color: "#22c55e" },
  { id: "stonesplit", name: "Stonesplit", color: "#eab308" },
];
export type Weapon = { id: string; name: string; school: School; short: string };
export const WEAPONS: Weapon[] = [
  { id: "nameless_sword", name: "Nameless Sword", school: "bellstrike", short: "NS" },
  { id: "strategic_sword", name: "Strategic Sword", school: "bellstrike", short: "SS" },
  { id: "nameless_spear", name: "Nameless Spear", school: "bellstrike", short: "NSp" },
  { id: "heavenquaker_spear", name: "Heavenquaker Spear", school: "bellstrike", short: "HQ" },
  { id: "infernal_twinblades", name: "Infernal Twinblades", school: "bamboocut", short: "TB" },
  { id: "riven_twinblades", name: "Riven Twinblades", school: "bamboocut", short: "Riven" },
  { id: "mortal_rope_dart", name: "Mortal Rope Dart", school: "bamboocut", short: "Dart" },
  { id: "unfettered_rope_dart", name: "Unfettered Rope Dart", school: "bamboocut", short: "Unfettered" },
  { id: "skygrasp_rope_dart", name: "Skygrasp Rope Dart", school: "bamboocut", short: "Skygrasp" },
  { id: "everspring_umbrella", name: "Everspring Umbrella", school: "bamboocut", short: "Everspring" },
  { id: "heavenwill_gauntlets", name: "Heavenwill Gauntlets", school: "bamboocut", short: "Heavenwill" },
  { id: "skystrike_gauntlets", name: "Skystrike Gauntlets", school: "bamboocut", short: "Skystrike" },
  { id: "inkwell_fan", name: "Inkwell Fan", school: "silkbind", short: "Inkwell" },
  { id: "vernal_umbrella", name: "Vernal Umbrella", school: "silkbind", short: "Vernal" },
  { id: "panacea_fan", name: "Panacea Fan", school: "silkbind", short: "Panacea" },
  { id: "soulshade_umbrella", name: "Soulshade Umbrella", school: "silkbind", short: "Soulshade" },
  { id: "willowbend_fan", name: "Willowbend Fan", school: "silkbind", short: "Willowbend" },
  { id: "museflow_drum", name: "Museflow Waist Drum", school: "silkbind", short: "Drum" },
  { id: "thundercry_blade", name: "Thundercry Blade", school: "stonesplit", short: "Mo" },
  { id: "stormbreaker_spear", name: "Stormbreaker Spear", school: "stonesplit", short: "Stormbreaker" },
  { id: "snowparting_blade", name: "Snowparting Blade", school: "stonesplit", short: "Snowparting" },
  { id: "phalanxbane_blade", name: "Phalanxbane Blade", school: "stonesplit", short: "Phalanxbane" },
];
export const PRESETS: { name: string; weapons: [string, string]; role: "dps" | "tank" | "healer" }[] = [
  { name: "Double Sword", weapons: ["nameless_sword", "strategic_sword"], role: "dps" },
  { name: "Nameless/HQ", weapons: ["nameless_sword", "heavenquaker_spear"], role: "dps" },
  { name: "Full Umbra", weapons: ["strategic_sword", "heavenquaker_spear"], role: "dps" },
  { name: "Mo/TB", weapons: ["thundercry_blade", "infernal_twinblades"], role: "tank" },
  { name: "Rats TB", weapons: ["infernal_twinblades", "mortal_rope_dart"], role: "dps" },
  { name: "Fan/Fan", weapons: ["inkwell_fan", "panacea_fan"], role: "healer" },
  { name: "Drums", weapons: ["willowbend_fan", "museflow_drum"], role: "healer" },
];
export const weaponById = (id: string) => WEAPONS.find((w) => w.id === id);
export const schoolColor = (s: string) => SCHOOLS.find((x) => x.id === s)?.color || "var(--muted)";
/** Build-ID: zwei Waffen, sortiert, mit "+" verbunden */
export const buildId = (a: string, b: string) => [a, b].sort().join("+");
export const buildWeapons = (id: string | null | undefined) => (String(id || "").split("+").map(weaponById).filter(Boolean) as Weapon[])
  .sort((a, b) => WEAPONS.indexOf(a) - WEAPONS.indexOf(b));
export const buildLabel = (id: string | null | undefined) => {
  const ws = buildWeapons(id);
  if (!ws.length) return "";
  const p = PRESETS.find((x) => buildId(x.weapons[0], x.weapons[1]) === id);
  return p ? p.name : ws.map((w) => w.short).join("/");
};
/** Pfade (für Inner Ways), zu denen die Waffen eines Builds gehören */
export const buildPaths = (id: string | null | undefined) => {
  const names = buildWeapons(id).map((w) => w.name);
  return PATHS.filter((p) => p.weapons.some((w) => names.includes(w))).map((p) => p.id);
};
