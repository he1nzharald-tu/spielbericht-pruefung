// Lokale Einstellungen und Bearbeitungsstände (nur auf diesem Gerät).

const KEY = "spielbericht-pruefung:v1";

export const DEFAULT_TEMPLATES = [
  {
    id: "verstoss",
    name: "Verstoß – Mitteilung mit Strafe",
    subject: "PBVRW {saison}: {regel} – {begegnung} ({liga}, {spieltag}. Spieltag)",
    body:
`Hallo {mannschaft},

bei der Prüfung des Spielberichts {begegnung} vom {datum} ({liga}, {spieltag}. Spieltag) wurde Folgendes festgestellt:

{grund}

Regelgrundlage: {sto}
Folge: {strafe}

Spielbericht: {link}

Gegen diese Entscheidung kann nach den Bestimmungen des PBVRW Einspruch eingelegt werden.

Mit sportlichen Grüßen
{absender}`,
  },
  {
    id: "anhoerung",
    name: "Bitte um Stellungnahme",
    subject: "PBVRW {saison}: Rückfrage zum Spielbericht {begegnung} ({liga}, {spieltag}. Spieltag)",
    body:
`Hallo {mannschaft},

beim Spielbericht {begegnung} vom {datum} ({liga}, {spieltag}. Spieltag) ist uns Folgendes aufgefallen:

{grund}

Bitte nehmt dazu bis zum {frist} Stellung. Mögliche Folge laut STO ({sto}): {strafe}

Spielbericht: {link}

Mit sportlichen Grüßen
{absender}`,
  },
  {
    id: "springer",
    name: "Springer-Angabe fehlt",
    subject: "PBVRW {saison}: Springer-Angabe fehlt – {begegnung}",
    body:
`Hallo {mannschaft},

im Spielbericht {begegnung} vom {datum} ({liga}, {spieltag}. Spieltag) wurde ein Springer eingesetzt, ohne ihn im Feld „Beschreibung“ zu vermerken:

{grund}

Laut Springer-Regelung muss jeder Springer-Einsatz in der Beschreibung eingetragen werden:
Springer = Vorname Nachname Passnummer

Folge: {strafe}

Spielbericht: {link}

Mit sportlichen Grüßen
{absender}`,
  },
];

const DEFAULTS = {
  status: {},        // findingId -> {status, note, mailedAt, updatedAt}
  addresses: {},     // "club:<Name>" | "team:<id>" -> "a@b.de, c@d.de"
  aliases: {},       // nameKey -> nameKey (bestätigte Zuordnungen)
  distinct: [],      // [[keyA, keyB]] ausdrücklich verschiedene Personen
  templates: DEFAULT_TEMPLATES,
  absender: "",
  sportwarte: ["Wolfgang Romich"],
  fristTage: 7,
  repo: "he1nzharald-tu/spielbericht-pruefung",
};

let cache = null;

export function load() {
  if (cache) return cache;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { raw = null; }
  cache = { ...structuredClone(DEFAULTS), ...(raw || {}) };
  if (!Array.isArray(cache.templates) || !cache.templates.length) cache.templates = structuredClone(DEFAULT_TEMPLATES);
  return cache;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function update(fn) {
  const s = load();
  fn(s);
  save();
  return s;
}

export function caseState(id) {
  return load().status[id] || { status: "offen", note: "", mailedAt: null };
}

export function setCase(id, patch) {
  update((s) => {
    s.status[id] = { ...(s.status[id] || { status: "offen", note: "" }), ...patch, updatedAt: new Date().toISOString() };
  });
}

export function addressesFor(team) {
  if (!team) return "";
  const s = load();
  return (s.addresses["team:" + team.id] || s.addresses["club:" + team.club] || "").trim();
}

export function exportJson() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: "spielbericht-pruefung", data: load() }, null, 1);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;
  if (typeof data !== "object" || !data) throw new Error("Ungültige Datei");
  update((s) => {
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in data)) continue;
      if (k === "status" || k === "addresses" || k === "aliases") s[k] = { ...s[k], ...data[k] };
      else s[k] = data[k];
    }
  });
}
