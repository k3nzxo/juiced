import en, { type Dict } from "./en";
import de from "./de";
import fr from "./fr";
import es from "./es";
import pt from "./pt";
import ru from "./ru";
import tr from "./tr";
import pl from "./pl";
import ar from "./ar";
import fi from "./fi";
import extraEn, { extra, type ExtraDict } from "./extra";

export const LOCALES = [
  { code: "en", name: "English", html: "en" },
  { code: "de", name: "Deutsch", html: "de" },
  { code: "fr", name: "Français", html: "fr" },
  { code: "es", name: "Español", html: "es" },
  { code: "pt", name: "Português (BR)", html: "pt-BR" },
  { code: "ru", name: "Русский", html: "ru" },
  { code: "tr", name: "Türkçe", html: "tr" },
  { code: "pl", name: "Polski", html: "pl" },
  { code: "fi", name: "Suomi", html: "fi" },
  { code: "ar", name: "العربية", html: "ar" },
] as const;
// Sprachen, die von rechts nach links geschrieben werden
export const RTL = new Set<string>(["ar"]);

export type Lang = (typeof LOCALES)[number]["code"];
export type FullDict = Dict & ExtraDict;
export type Key = keyof FullDict;

const partials: Record<Lang, Partial<Dict>> = { en, de, fr, es, pt, ru, tr, pl, fi, ar };

export function dict(lang: Lang): FullDict {
  return { ...en, ...extraEn, ...partials[lang], ...extra[lang] } as FullDict;
}

export function fmt(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function useT(lang: Lang) {
  const d = dict(lang);
  return (key: Key, vars?: Record<string, string | number>) => fmt((d[key] as string) ?? String(key), vars);
}

export const langPaths = () => LOCALES.map((l) => ({ params: { lang: l.code } }));

export const DISCORD_INVITE = "https://discord.gg/juiced";
