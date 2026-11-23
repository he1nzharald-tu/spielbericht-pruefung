// Namensabgleich: Normalisierung, Aliasse, Ähnlichkeitsvorschläge.

const UML = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

export function tokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UML[c])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 0);
}

/** Schlüssel unabhängig von Groß-/Kleinschreibung, Umlautschreibweise und Reihenfolge. */
export function nameKey(name) {
  return tokens(name).sort().join(" ");
}

/** Wendet bestätigte Zuordnungen an (Alias-Schlüssel -> Haupt-Schlüssel). */
export function makeResolver(aliases = {}) {
  return (name) => {
    let k = nameKey(name);
    const seen = new Set();
    while (aliases[k] && !seen.has(k)) {
      seen.add(k);
      k = aliases[k];
    }
    return k;
  };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Prüft, ob die Beschreibung den Spieler erwähnt (ein Namensteil mit mind. 3 Buchstaben genügt). */
export function mentions(description, name) {
  const d = " " + tokens(description).join(" ") + " ";
  return tokens(name).some((t) => t.length >= 3 && d.includes(" " + t + " "));
}

/** Formatprüfung "Springer = Vorname Nachname Passnummer" (Reihenfolge Name/Passnummer egal). */
export function springerFormatOk(description, name) {
  const desc = String(description || "");
  const parts = desc.split(/(?=springer)/i);
  return parts.some((p) => /^springer\s*=\s*/i.test(p) && mentions(p, name) && /\d{3,}/.test(p) &&
    tokens(name).filter((t) => t.length >= 2).every((t) => (" " + tokens(p).join(" ") + " ").includes(" " + t + " ")));
}

/**
 * Vorschläge für vermutlich gleiche Spieler mit abweichender Schreibweise.
 * players: [{key, name, clubs:Set}]
 * Liefert Paare mit kleinem Abstand innerhalb desselben Vereins.
 */
export function suggestMerges(players, distinct = []) {
  const skip = new Set(distinct.map((p) => [p[0], p[1]].sort().join("|")));
  const out = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.key === b.key) continue;
      const shared = [...a.clubs].some((c) => b.clubs.has(c));
      if (!shared) continue;
      const pair = [a.key, b.key].sort().join("|");
      if (skip.has(pair)) continue;
      const dist = levenshtein(a.key, b.key);
      const maxLen = Math.max(a.key.length, b.key.length);
      const ta = a.key.split(" "), tb = b.key.split(" ");
      const tokenSubset = ta.every((t) => tb.includes(t)) || tb.every((t) => ta.includes(t));
      if ((dist <= 2 && maxLen >= 8) || (tokenSubset && Math.min(ta.length, tb.length) >= 2)) {
        out.push({ a, b, dist });
      }
    }
  }
  return out.sort((x, y) => x.dist - y.dist);
}
