// Server-Fehler in der Sprache des Besuchers: der Server schickt {code, params, detail},
// hier wird daraus der übersetzte Text (err_<code>), sonst der englische Ersatztext.
export function errorText(data: any, dict: Record<string, string>, fallback: string): string {
  if (data && typeof data.code === "string") {
    const tpl = dict["err_" + data.code];
    if (tpl) return tpl.replace(/\{(\w+)\}/g, (_, k) => (data.params && k in data.params ? String(data.params[k]) : `{${k}}`));
  }
  return data && typeof data.detail === "string" ? data.detail : fallback;
}
