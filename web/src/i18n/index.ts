import en, { type Dict } from "./en";
import de from "./de";
import fr from "./fr";
import es from "./es";
import pt from "./pt";
import ru from "./ru";
import tr from "./tr";
import pl from "./pl";

export const LOCALES = [
  { code: "en", name: "English", html: "en" },
  { code: "de", name: "Deutsch", html: "de" },
  { code: "fr", name: "Français", html: "fr" },
  { code: "es", name: "Español", html: "es" },
  { code: "pt", name: "Português (BR)", html: "pt-BR" },
  { code: "ru", name: "Русский", html: "ru" },
  { code: "tr", name: "Türkçe", html: "tr" },
  { code: "pl", name: "Polski", html: "pl" },
] as const;

export type Lang = (typeof LOCALES)[number]["code"];
export type Key = keyof Dict;

const partials: Record<Lang, Partial<Dict>> = { en, de, fr, es, pt, ru, tr, pl };

export function dict(lang: Lang): Dict {
  return { ...en, ...partials[lang] } as Dict;
}

export function fmt(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function useT(lang: Lang) {
  const d = dict(lang);
  return (key: Key, vars?: Record<string, string | number>) => fmt(d[key] ?? en[key] ?? String(key), vars);
}

export const langPaths = () => LOCALES.map((l) => ({ params: { lang: l.code } }));

export const DISCORD_INVITE = "https://discord.gg/juiced";
