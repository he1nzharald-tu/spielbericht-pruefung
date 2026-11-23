// Push-Benachrichtigung über neue Fälle nach jedem Datenlauf (läuft in GitHub Actions).
// Ruft billard-blmr.de NICHT auf – wertet nur die gerade gespeicherten Daten aus.
//
// Umgebungsvariablen:
//   NTFY_TOPIC   geheimer Kanalname (GitHub-Secret); ohne ihn wird nur der Stand gespeichert
//   NTFY_SERVER  Standard https://ntfy.sh
//   NOTIFY_LEVEL "verstoss" (nur Verstöße) oder "hinweis" (Verstöße + Hinweise, Standard)
//   APP_URL      Link, der beim Antippen der Nachricht geöffnet wird
//   WEEKLY       "true" beim wöchentlichen Lauf: Nachricht auch ohne neue Fälle (Wochenmeldung)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { analyze } from "../docs/js/rules.js";

const ROOT = new URL("../", import.meta.url);
const read = (p, d) => {
  const u = new URL(p, ROOT);
  return existsSync(u) ? JSON.parse(readFileSync(u, "utf8")) : d;
};

const seasons = read("docs/data/seasons.json", []);
if (!seasons.length) process.exit(0);
const slug = seasons[seasons.length - 1].slug;
const base = `docs/data/${slug}/`;
const data = {
  meta: read(base + "meta.json"),
  teams: read(base + "teams.json", []),
  matches: read(base + "matches.json", []),
  reports: read(base + "reports.json", {}),
  changes: read(base + "changes.json", []),
  withdrawals: read(base + "withdrawals.json", []),
};
const level = (process.env.NOTIFY_LEVEL || "hinweis").toLowerCase();
const wanted = level.startsWith("verstoss") ? ["verstoss"] : ["verstoss", "hinweis"];
const { findings } = analyze(data);
const relevant = findings.filter((f) => wanted.includes(f.severity));

const statePath = new URL(base + "notified.json", ROOT);
const first = !existsSync(statePath);
const known = new Set(first ? [] : JSON.parse(readFileSync(statePath, "utf8")).ids || []);
const fresh = relevant.filter((f) => !known.has(f.id));

const save = () =>
  writeFileSync(statePath, JSON.stringify({ updated_at: new Date().toISOString(), ids: [...new Set([...known, ...relevant.map((f) => f.id)])].sort() }, null, 0));

const topic = process.env.NTFY_TOPIC;
const weekly = process.env.WEEKLY === "true";

if (process.argv.includes("--test")) {
  if (!topic) {
    console.error("NTFY_TOPIC ist nicht gesetzt – bitte das Repository-Secret prüfen.");
    process.exit(1);
  }
  await send("Spielbericht-Prüfung: Testnachricht", `Die Push-Benachrichtigung ist eingerichtet. Aktuell bestehen ${findings.filter((f) => f.severity === "verstoss").length} Verstöße und ${findings.filter((f) => f.severity === "hinweis").length} Hinweise in der Saison ${data.meta?.season}. Antippen öffnet die App.`, 3, ["white_check_mark"]);
  process.exit(0);
}

// Kennzahlen dieses Laufs für die Wochenmeldung
const runAt = data.meta?.generated_at;
const newReports = Object.values(data.reports).filter((r) => r.first_fetched_at && r.first_fetched_at === runAt).length;
const newChanges = data.changes.filter((c) => c.detected_at === runAt).length;
const totalV = findings.filter((f) => f.severity === "verstoss").length;
const totalH = findings.filter((f) => f.severity === "hinweis").length;
const errors = (data.meta?.errors || []).length;
const summary = [
  `Geprüft: ${Object.keys(data.reports).length} Spielberichte (${newReports} neu seit dem letzten Lauf)` + (newChanges ? `, ${newChanges} nachträglich geändert` : ""),
  `Insgesamt in der Saison: ${totalV} Verstöße, ${totalH} Hinweise`,
  errors ? `⚠️ ${errors} Seiten konnten nicht geladen werden` : "",
].filter(Boolean).join("\n");

if (first) {
  // Erster Lauf: bestehende Fälle als bekannt merken, keine Nachrichtenflut
  save();
  console.log(`Benachrichtigungen initialisiert: ${relevant.length} bestehende Fälle als bekannt markiert.`);
  if (topic) await send("Spielbericht-Prüfung: Benachrichtigungen aktiv", `Ab jetzt kommt eine Nachricht, sobald neue Fälle gefunden werden. Aktuell bestehen ${relevant.length} Fälle.`, 3, []);
  process.exit(0);
}

const prefix = weekly ? "Wochenprüfung" : "Spielbericht-Prüfung";
if (!fresh.length) {
  save();
  console.log("Keine neuen Fälle.\n" + summary);
  if (weekly && topic) await send(`${prefix}: keine neuen Vermerke`, `Keine neuen Verstöße oder Hinweise.\n${summary}`, 2, ["white_check_mark"]);
  process.exit(0);
}

const nV = fresh.filter((f) => f.severity === "verstoss").length;
const nH = fresh.length - nV;
const title = [nV && `${nV} neue${nV === 1 ? "r" : ""} Verstoß${nV === 1 ? "" : "e"}`, nH && `${nH} neue${nH === 1 ? "r" : ""} Hinweis${nH === 1 ? "" : "e"}`].filter(Boolean).join(", ");
const lines = fresh
  .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "verstoss" ? -1 : 1))
  .slice(0, 8)
  .map((f) => `${f.severity === "verstoss" ? "❗" : "•"} ${f.league || ""}${f.st ? " ST" + f.st : ""}: ${f.title}${f.player ? " – " + f.player : ""}${f.match ? " (" + f.match + ")" : f.team ? " (" + f.team + ")" : ""}`);
if (fresh.length > 8) lines.push(`… und ${fresh.length - 8} weitere`);
if (weekly) lines.push("", summary);

if (topic) {
  await send(`${prefix}: ${title}`, lines.join("\n"), nV ? 4 : 3, nV ? ["warning"] : ["memo"]);
} else {
  console.log("NTFY_TOPIC nicht gesetzt – keine Nachricht gesendet.");
}
console.log(title + "\n" + lines.join("\n"));
save();

async function send(t, body, priority, tags) {
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const res = await fetch(server, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic, title: t, message: body, priority, tags,
      click: process.env.APP_URL || "https://he1nzharald-tu.github.io/spielbericht-pruefung/",
    }),
  });
  if (!res.ok) {
    console.error("ntfy-Fehler:", res.status, await res.text());
    process.exitCode = 1;
  }
  else console.log("Push gesendet.");
}
