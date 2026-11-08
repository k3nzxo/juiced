import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://juiced.team",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "auto" },
  i18n: {
    locales: ["en", "de", "fr", "es", "pt", "ru", "tr", "pl"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  server: { port: 4321 },
  vite: {
    server: {
      // lokale Entwicklung: API läuft separat auf :8000
      proxy: { "/api": "http://127.0.0.1:8010", "/vods": "http://127.0.0.1:8010" },
    },
  },
});
