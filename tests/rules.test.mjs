// Aufruf: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../docs/js/rules.js";
import { nameKey, mentions, springerFormatOk, suggestMerges } from "../docs/js/names.js";

const cfg = JSON.parse(readFileSync(new URL("../config/leagues.json", import.meta.url)));
const meta = { season: "2026/2027", leagues: cfg.seasons["2026/2027"].leagues, races: cfg.races, springer_regel: true };

const T = (id, name, league_id, kader = []) => {
  const m = name.match(/^(.*?)\s+(\d+)$/);
  return { id, name, league_id, club: m[1], number: +m[2], withdrawn: false,
    kader: kader.map((n) => ({ name: n, status: "", first_seen: "2026-08-20T10:00:00Z" })) };
};
const teams = [
  T(1, "BC Alsdorf 4", 571, ["Carsten Lehmann", "Sebastian Bock", "Roman Morid", "Andre Prost", "Vincent Breuer"]),
  T(2, "BC Alsdorf 5", 569, ["Sabine Sparacio", "Anna Alpha", "Bert Beta", "Carl Gamma"]),
  T(3, "BC Alsdorf 6", 576, ["Max Muster", "Dora Delta", "Emil Eps", "Fritz Zeta"]),
  T(10, "PBC Phönix Düren 4", 571, ["P1 Eins", "P2 Zwei", "P3 Drei", "P4 Vier"].map((x) => x.replace(/\d/, ""))),
  T(11, "PBC Gegner 1", 569, []),
  T(12, "PBC Gegner 2", 576, []),
  T(20, "PBC X 1", 569, []),
  T(21, "PBC X 2", 569, []),
];

const disc = ["14/1", "8-Ball", "9-Ball", "10-Ball"];
const LLRACE = { "14/1": 75, "8-Ball": 5, "9-Ball": 6, "10-Ball": 5 };
function report(home, away, { desc = "", captured = null, date, raceTab = LLRACE, endstand = null, homeWins = 4 } = {}) {
  // home/away: Arrays mit 8 Namen (Partie 1..8)
  const games = [];
  let hw = 0, aw = 0;
  for (let i = 0; i < 8; i++) {
    const d = disc[i % 4];
    const race = raceTab[d];
    const homeWin = i < homeWins;
    homeWin ? hw++ : aw++;
    const g = { round: i < 4 ? 1 : 2, nr: i + 1, discipline: d, home: home[i] || "", away: away[i] || "",
      score: d === "14/1" ? (homeWin ? [1, 0] : [0, 1]) : homeWin ? [race, 1] : [1, race], points: d === "14/1" ? (homeWin ? [race, 10] : [10, race]) : null };
    games.push(g);
  }
  return { games, endstand: endstand || [hw, aw], description: desc, captured_by: "Heim Erfasser",
    captured_at: captured || `${date}T20:00`, zu_null: false };
}
const ALS4 = ["Carsten Lehmann", "Sebastian Bock", "Roman Morid", "Andre Prost"];
const DUE4 = ["P Eins", "P Zwei", "P Drei", "P Vier"];
const lineup = (four) => [...four, ...four.slice(1), four[0]];

const matches = [];
const reports = {};
let mid = 100;
function M(league_id, st, date, home_id, away_id, rep) {
  const id = ++mid;
  matches.push({ id, league_id, st, date, time: "16:00", home_id, away_id, result: rep ? rep.endstand : null, memo: [], url: `sb_spielbericht.php?p=13--2026/2027-${league_id}-0-${id}` });
  if (rep) reports[String(id)] = rep;
  return id;
}

// Sparacio: ST1 Springer (Format abweichend), ST2 Springer ohne Vermerk + gleicher ST für Stamm, ST3 3. Einsatz (fest), ST4 in alter Stamm
const withSpar = ["Carsten Lehmann", "Sebastian Bock", "Sabine Sparacio", "Andre Prost"];
const m1 = M(571, 1, "2026-09-19", 10, 1, report(DUE4, lineup(withSpar), { desc: "Springer Sparacio 1044", date: "2026-09-19" }));
const m2 = M(571, 2, "2026-09-26", 1, 10, report(lineup(withSpar), DUE4, { desc: "", date: "2026-09-26" }));
const m2b = M(569, 2, "2026-09-27", 2, 11, report(lineup(["Sabine Sparacio", "Anna Alpha", "Bert Beta", "Carl Gamma"]), lineup(["G A", "G B", "G C", "G D"]), { date: "2026-09-27", raceTab: { "14/1": 50, "8-Ball": 3, "9-Ball": 4, "10-Ball": 3 } }));
const m3 = M(571, 3, "2026-10-03", 10, 1, report(DUE4, lineup(withSpar), { desc: "Springer = Sabine Sparacio 1044", date: "2026-10-03" }));
const m4 = M(569, 4, "2026-10-17", 2, 11, report(lineup(["Sabine Sparacio", "Anna Alpha", "Bert Beta", "Carl Gamma"]), lineup(["G A", "G B", "G C", "G D"]), { date: "2026-10-17", raceTab: { "14/1": 50, "8-Ball": 3, "9-Ball": 4, "10-Ball": 3 } }));

// Max Muster (Stamm Alsdorf 6): Springer in Alsdorf 5 (ST5), dann in Alsdorf 4 (ST6) -> R2
const m5 = M(569, 5, "2026-10-31", 2, 11, report(lineup(["Max Muster", "Anna Alpha", "Bert Beta", "Carl Gamma"]), lineup(["G A", "G B", "G C", "G D"]), { desc: "Springer = Max Muster 2001", date: "2026-10-31", raceTab: { "14/1": 50, "8-Ball": 3, "9-Ball": 4, "10-Ball": 3 } }));
const m6 = M(571, 6, "2026-11-07", 1, 10, report(lineup(["Carsten Lehmann", "Sebastian Bock", "Max Muster", "Andre Prost"]), DUE4, { desc: "Springer = Max Muster 2001", date: "2026-11-07" }));

// Roman Morid (Stamm Alsdorf 4) spielt in Alsdorf 6 -> B4; Bericht zu spät erfasst -> A6; Endstand falsch -> A7
const m7 = M(576, 7, "2026-11-21", 3, 12, report(lineup(["Roman Morid", "Dora Delta", "Emil Eps", "Fritz Zeta"]), lineup(["H A", "H B", "H C", "H D"]),
  { date: "2026-11-21", captured: "2026-11-23T09:00", endstand: [5, 3], raceTab: { "14/1": 30, "8-Ball": 3, "9-Ball": 4, "10-Ball": 3 } }));

// A1: Spieler dreimal; A4: 3 Spieler, falsche Partien leer
const three = ["Carsten Lehmann", "Sebastian Bock", "Andre Prost"];
const m8 = M(571, 8, "2026-11-28", 1, 10, report(["Carsten Lehmann", "Sebastian Bock", "Andre Prost", "Carsten Lehmann", "Sebastian Bock", "Andre Prost", "Carsten Lehmann", ""], DUE4.concat(DUE4), { date: "2026-11-28" }));

// B2: Vereinsduell X1 - X2 am ST 3 und ST 12 (Rückrunde beginnt ST 10)
M(569, 3, "2026-10-03", 20, 21, null);
M(569, 12, "2027-02-27", 21, 20, null);
for (let s = 1; s <= 18; s++) M(569, s, s <= 9 ? `2026-${String(9 + Math.floor(s / 4)).padStart(2, "0")}-${String(10 + s).padStart(2, "0")}` : `2027-0${1 + Math.floor((s - 10) / 3)}-${String(10 + s).padStart(2, "0")}`, 11, 11 + 0, null);

// B1: Verlegung ST 5 KK A: Regeltermin 31.10.2026, eines am 19.12.2026 (ok), eines am 05.01.2027 (zu spät)
M(576, 5, "2026-10-31", 12, 3, null);
M(576, 5, "2026-10-31", 12, 3, null);
M(576, 5, "2026-12-19", 3, 12, null);
M(576, 5, "2027-01-05", 3, 12, null);

const data = { meta, teams, matches, reports, changes: [] };
const res = analyze(data, { today: "2026-11-23" });
const has = (code, pred = () => true) => res.findings.filter((f) => f.code === code && pred(f));

test("Namensschlüssel ist reihenfolge- und umlautunabhängig", () => {
  assert.equal(nameKey("Meinhart Adrian"), nameKey("adrian  MEINHART"));
  assert.equal(nameKey("Jörg Müller"), nameKey("Joerg Mueller"));
  assert.ok(mentions("Springer Sparacio 1044", "Sabine Sparacio"));
  assert.ok(!mentions("", "Sabine Sparacio"));
  assert.ok(springerFormatOk("Springer = Sabine Sparacio 1044", "Sabine Sparacio"));
  assert.ok(springerFormatOk("Springer = 1044 Sabine Sparacio", "Sabine Sparacio"));
  assert.ok(!springerFormatOk("Springer Sparacio 1044", "Sabine Sparacio"));
});

test("Ähnliche Namen werden vorgeschlagen", () => {
  const s = suggestMerges([
    { key: nameKey("Sabine Sparacio"), clubs: new Set(["A"]) },
    { key: nameKey("Sabine Sparaccio"), clubs: new Set(["A"]) },
    { key: nameKey("Sabine Sparacio"), clubs: new Set(["B"]) },
  ]);
  assert.equal(s.length, 1);
});

test("Springer Sparacio: Format-Hinweis, fehlender Vermerk, gleicher Spieltag, festgespielt, Sperre", () => {
  const sp = res.springer.find((s) => s.name === "Sabine Sparacio");
  assert.ok(sp, "Springer erkannt");
  assert.equal(sp.stamm, "BC Alsdorf 5");
  assert.equal(sp.springerTeam, "BC Alsdorf 4");
  assert.equal(sp.uses.length, 3);
  assert.ok(sp.festgespielt);
  assert.equal(has("R6F", (f) => f.matchId === m1).length, 1);
  assert.equal(has("R6", (f) => f.matchId === m2).length, 1);
  assert.equal(has("R6", (f) => f.matchId === m3).length, 0);
  assert.equal(has("R5", (f) => f.player === "Sabine Sparacio").length, 1);
  assert.equal(has("FEST", (f) => f.matchId === m3).length, 1);
  assert.equal(has("R4", (f) => f.matchId === m4).length, 1);
  assert.equal(has("R4", (f) => f.matchId === m2b).length, 0, "vor dem Festspielen kein R4");
});

test("Zweite Springer-Mannschaft (R2)", () => {
  assert.equal(has("R2", (f) => f.matchId === m6 && f.player === "Max Muster").length, 1);
  assert.equal(has("R6", (f) => f.matchId === m5).length, 0);
});

test("Wechsel nach unten (B4), Frist (A6), Endstand (A7)", () => {
  assert.equal(has("B4", (f) => f.matchId === m7 && f.player === "Roman Morid").length, 1);
  assert.equal(has("A6", (f) => f.matchId === m7).length, 1);
  assert.equal(has("A7", (f) => f.matchId === m7).length, 1);
  assert.equal(has("A6", (f) => f.matchId === m1).length, 0);
});

test("Einsätze je Begegnung (A1) und Mannschaftsstärke (A4)", () => {
  assert.equal(has("A1", (f) => f.matchId === m8 && f.player === "Carsten Lehmann").length, 1);
  assert.equal(has("A1R", (f) => f.matchId === m8).length, 1, "Lehmann zweimal im 1. Durchgang");
  assert.equal(has("A4", (f) => f.matchId === m8).length, 1);
});

test("Vereinsduell (B2) und Verlegungen (B1)", () => {
  assert.equal(has("B2").length, 1);
  assert.equal(has("B1", (f) => f.severity === "info" && f.date === "2026-12-19").length, 1);
  assert.equal(has("B1", (f) => f.severity === "hinweis" && f.date === "2027-01-05").length, 1);
});

test("Keine falschen Springer bei regulären Einsätzen", () => {
  assert.equal(res.springer.filter((s) => !["Sabine Sparacio", "Max Muster"].includes(s.name)).length, 0);
});
