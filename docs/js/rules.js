// Prüfregeln nach Springer-Regelung (ab 2026/2027) und STO PBVRW (Fassung 05.10.2026).
// Reine Funktion: analyze(data, settings) -> { findings, springer, players, stats }

import { makeResolver, mentions, springerFormatOk } from "./names.js";

export const PENALTIES = {
  "10.2.7": {
    sto: "10.2.7", nr: 7, betrag: 100,
    text: "Einsatz eines nicht spielberechtigten Sportlers: Die Begegnung wird für diese Mannschaft mit dem größtmöglichen Ergebnis als verloren gewertet (2:0 Pkt. und 8:0 Sp.-Pkt. für die gegnerische Mannschaft). Bußgeld 100,00 € (Bußgeldkatalog Nr. 7).",
  },
  "10.3.2": {
    sto: "10.3.2", nr: 8, betrag: 15,
    text: "Unvollständig, nicht fristgerecht oder falsch eingetragener Spielbericht: Bußgeld 15,00 € (Bußgeldkatalog Nr. 8).",
  },
  "10.2.8": {
    sto: "10.2.8", nr: null, betrag: null,
    text: "Die Begegnung wird für beide Mannschaften mit 0:8 gewertet.",
  },
  "10.5.8": {
    sto: "10.5.8", nr: 13, betrag: 100,
    text: "Die Begegnung wird für beide Mannschaften mit dem größtmöglichen Ergebnis als verloren gewertet. Bußgeld je 100,00 € (Bußgeldkatalog Nr. 13).",
  },
  "10.5.3": {
    sto: "10.5.3", nr: 11, betrag: 100,
    text: "Unentschuldigtes Nichtantreten: Die Begegnung wird mit dem größtmöglichen Ergebnis als verloren gewertet. Bußgeld 100,00 € (Bußgeldkatalog Nr. 11).",
  },
  "10.5.4": {
    sto: "10.5.4", nr: 12, betrag: 50,
    text: "Entschuldigtes Nichtantreten: Die Begegnung wird mit dem größtmöglichen Ergebnis als verloren gewertet. Bußgeld 50,00 € (Bußgeldkatalog Nr. 12). Die Entschuldigung gilt nur, wenn sie dem 1. Sportwart spätestens 24 Stunden vor dem Spieltermin vorlag.",
  },
  none: {
    sto: null, nr: null, betrag: null,
    text: "Die STO nennt hierfür keine ausdrückliche Sanktion – Entscheidung durch den 1. Sportwart.",
  },
};

export const RULES = {
  R1: "Springer nur aus unterklassiger Mannschaft",
  R2: "Nur eine Springer-Mannschaft je Saison",
  R4: "Nach dem 3. Springer-Einsatz Sperre in der bisherigen Stammmannschaft",
  R5: "Gleicher Spieltag in zwei Mannschaften (10.2.6)",
  R6: "Springer nicht in der Beschreibung vermerkt",
  R6F: "Springer-Vermerk weicht vom vorgeschriebenen Format ab",
  R6X: "Beschreibung nennt Springer, aber kein Springer-Einsatz erkannt",
  A1: "Spieler öfter als zweimal in einer Begegnung",
  A1R: "Spieler zweimal im selben Durchgang",
  A2: "Senioren: gleiche Disziplin in beiden Durchgängen",
  A4: "Mannschaftsstärke / entfallene Partien",
  A4E: "Leeres Spielerfeld",
  A6: "Spielbericht nicht bis 14:00 Uhr des Folgetags erfasst",
  A7: "Endstand passt nicht zu den Einzelergebnissen",
  A7R: "Ausspielziel nicht erreicht",
  A7S: "Ergebnis im Spielplan weicht vom Spielbericht ab",
  A8: "Mehr als zwei Mannschaften eines Vereins in einer Gruppe",
  A9: "Mehr als zehn Spieler im Kader",
  A10: "Spieler in zwei Kombi-Mannschaften gemeldet",
  K1: "Spieler nicht im Kader der Mannschaft",
  K2: "Einsatz für einen anderen Verein",
  B1: "Spielverlegung außerhalb der Frist",
  B1O: "Begegnung überfällig",
  B2: "Vereinsduell: Rückspiel nicht vor der Rückrunde",
  B3: "Spieler einer abgemeldeten Mannschaft während der Sperre eingesetzt",
  B4: "Einsatz in unterklassiger Mannschaft (Wechsel nach unten)",
  B7: "Mannschaft dreimal nicht angetreten",
  B7Z: "Wertung ohne gespielte Partien",
  P1: "Eintrag im Protest-Feld",
  D1: "Vermerk in der Beschreibung",
  CH: "Spielbericht nachträglich geändert",
};

const DAY = 86400000;

function parseDate(d) {
  return d ? new Date(d + "T00:00:00") : null;
}

function addDays(iso, n) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function mode(arr) {
  const c = new Map();
  for (const x of arr) c.set(x, (c.get(x) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of c) if (v > n || (v === n && k < best)) { best = k; n = v; }
  return best;
}

export function analyze(data, settings = {}) {
  const { meta, teams = [], matches = [], reports = {}, changes = [], withdrawals = [] } = data;
  const resolve = makeResolver(settings.aliases || {});
  const sportwarte = (settings.sportwarte || ["Wolfgang Romich"]).map((s) => s.toLowerCase());
  const leagues = new Map((meta?.leagues || []).map((l) => [l.id, l]));
  const races = meta?.races || {};
  const springerOn = meta?.springer_regel !== false;
  const seasonStartYear = parseInt(String(meta?.season || "").slice(0, 4), 10);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const findings = [];
  const add = (f) => {
    f.id = [f.code, f.matchId || "", f.teamId || "", f.playerKey || "", f.extra || ""].join("|");
    if (!findings.some((x) => x.id === f.id)) findings.push(f);
  };
  const comp = (t) => leagues.get(t?.league_id)?.competition || "kombi";
  const level = (t) => leagues.get(t?.league_id)?.level ?? 99;
  // a höherklassig als b?
  const higher = (a, b) => level(a) < level(b) || (level(a) === level(b) && a.number < b.number);
  const lower = (a, b) => higher(b, a);
  const baseOf = (m) => ({
    matchId: m.id, leagueId: m.league_id, st: m.st, date: m.date, url: m.url,
  });

  // ---------------------------------------------------------------- Kader-Index
  const kaderOf = new Map(); // playerKey -> [{team, first_seen, name}]
  const displayName = new Map();
  for (const t of teams) {
    for (const p of t.kader || []) {
      const k = resolve(p.name);
      if (!displayName.has(k)) displayName.set(k, p.name);
      if (!kaderOf.has(k)) kaderOf.set(k, []);
      kaderOf.get(k).push({ team: t, first_seen: p.first_seen || "", name: p.name });
    }
  }
  const teamKaderKeys = new Map(teams.map((t) => [t.id, new Set((t.kader || []).map((p) => resolve(p.name)))]));

  // ---------------------------------------------------------------- Einsätze
  const apps = []; // {key, name, team, match, report, side, games:[]}
  for (const m of matches) {
    const r = reports[String(m.id)];
    if (!r || isBye(m) || !scoredGames(r).length) continue;
    const sides = [["home", m.home_id], ["away", m.away_id]];
    for (const [side, tid] of sides) {
      const team = teamById.get(tid);
      if (!team) continue;
      const per = new Map();
      for (const g of r.games || []) {
        const nm = validName(g[side]);
        if (!nm) continue;
        const k = resolve(nm);
        if (!displayName.has(k)) displayName.set(k, nm);
        if (!per.has(k)) per.set(k, { key: k, name: nm, team, match: m, report: r, side, games: [] });
        per.get(k).games.push(g);
      }
      apps.push(...per.values());
    }
  }
  const chrono = (a, b) =>
    (a.match.date || "").localeCompare(b.match.date || "") ||
    (a.match.time || "").localeCompare(b.match.time || "") ||
    (a.match.st || 0) - (b.match.st || 0) || a.match.id - b.match.id;
  apps.sort(chrono);
  const appsByPlayer = new Map();
  for (const a of apps) {
    if (!appsByPlayer.has(a.key)) appsByPlayer.set(a.key, []);
    appsByPlayer.get(a.key).push(a);
  }

  // ---------------------------------------------------------------- Je Spielbericht
  for (const m of matches) {
    const r = reports[String(m.id)];
    if (!r || isBye(m)) continue;
    const lg = leagues.get(m.league_id) || {};
    const c = lg.competition || "kombi";
    const games = r.games || [];
    const sec = c === "senioren" ? "11.7" : c === "pokal" ? "11.6" : "11." + Math.min(5, Math.max(1, lg.level || 1));

    // A6: Erfassungsfrist – maßgeblich ist der erste bekannte Erfassungszeitpunkt
    const firstAt = r.captured_first_at || r.captured_at;
    const firstBy = r.captured_first_by || r.captured_by;
    if (firstAt && m.date) {
      const deadline = addDays(m.date, 1) + "T14:00";
      const hist = (r.capture_history || []).map((h) => `${fmtDT(h.at)} (${h.by || "?"})`);
      const corrected = r.captured_at && r.captured_at !== firstAt;
      if (firstAt.slice(0, 16) > deadline) {
        const bySw = sportwarte.includes(String(firstBy || "").toLowerCase());
        const knownSinceStart = !!r.capture_history && r.capture_history.length > 0 && r.first_fetched_at && r.first_fetched_at.slice(0, 16) <= deadline;
        add({
          ...baseOf(m), code: "A6", severity: bySw ? "hinweis" : "verstoss",
          teamId: m.home_id, opponentId: m.away_id,
          title: RULES.A6,
          detail: `Erste bekannte Erfassung am ${fmtDT(firstAt)} von ${firstBy || "?"}, Frist war ${fmtDT(deadline)}.` +
            (corrected ? ` Später geändert: ${fmtDT(r.captured_at)} von ${r.captured_by || "?"}.` : "") +
            (bySw ? " Erfassung durch den Sportwart – vermutlich Korrektur eines früheren Eintrags, der dem Tool nicht vorliegt; bitte prüfen." :
              knownSinceStart ? "" : " Hinweis: Der Bericht wurde vom Tool erst nach Ablauf der Frist erstmals gelesen; eine frühere, später überschriebene Erfassung ist nicht ausgeschlossen.") +
            (hist.length > 1 ? ` Verlauf: ${hist.join(" → ")}.` : ""),
          penalty: PENALTIES["10.3.2"], sto: "10.3.1 / 10.3.2",
        });
      }
    }

    const desc = (r.description || "").trim();
    const prot = (r.protest || "").trim();
    const notes = [desc && `Beschreibung: „${desc}“`, prot && `Protest: „${prot}“`].filter(Boolean).join(" · ");

    // B7Z: Wertung ohne gespielte Partien – immer Hinweis mit Beschreibung/Protest
    if (isZuNull(r)) {
      const res = r.endstand || m.result || [0, 0];
      let loser = res[0] < res[1] ? m.home_id : res[1] < res[0] ? m.away_id : null;
      const txt = (desc + " " + prot).toLowerCase();
      for (const tid of [m.home_id, m.away_id]) {
        const nm = teamById.get(tid)?.name?.toLowerCase();
        if (nm && txt.includes(nm)) loser = tid;
      }
      const winner = loser === m.home_id ? m.away_id : m.home_id;
      const nichtAngetreten = /nicht\s*(spielfähig|angetreten|erschienen)|abgesagt|kein(e)?\s*(mannschaft|spieler)/.test(txt);
      const entschuldigt = /entschuldigt/.test(txt) && !/unentschuldigt/.test(txt);
      const amSpieltag = /am\s*spieltag|kurzfristig|am\s*selben\s*tag/.test(txt);
      let pen = PENALTIES.none, extra = "";
      if (nichtAngetreten || entschuldigt) {
        if (entschuldigt && amSpieltag) {
          pen = PENALTIES["10.5.3"];
          extra = " Entschuldigung „am Spieltag“: nach 10.5.4 nur gültig, wenn sie mind. 24 Std. vor dem Termin beim 1. Sportwart vorlag – sonst unentschuldigt (10.5.3).";
        } else if (entschuldigt) {
          pen = PENALTIES["10.5.4"];
          extra = " Prüfen, ob die Entschuldigung mind. 24 Std. vorher beim 1. Sportwart vorlag.";
        } else {
          pen = PENALTIES["10.5.4"];
          extra = " Entschuldigt (10.5.4, 50 €) oder unentschuldigt (10.5.3, 100 €)?";
        }
      }
      add({ ...baseOf(m), code: "B7Z", severity: "hinweis", teamId: loser || m.home_id, opponentId: loser ? winner : m.away_id,
        title: RULES.B7Z + (nichtAngetreten ? " – Nichtantreten" : ""),
        detail: `Endstand ${fmtRes(res)} ohne gespielte Einzelpartien. ` + (notes ? notes + "." : "Keine Begründung in Beschreibung oder Protest angegeben.") + extra,
        penalty: pen, sto: pen.sto ? `${pen.sto} / 10.8.1` : "10.8.1", note: notes });
      continue;
    }

    // Eintrag im Protest-Feld / sonstiger Vermerk in der Beschreibung
    if (prot) {
      add({ ...baseOf(m), code: "P1", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, title: RULES.P1,
        detail: `Protest: „${prot}“` + (desc ? ` · Beschreibung: „${desc}“` : ""), penalty: PENALTIES.none, sto: "10.4.4" });
    } else if (desc && !/springer/i.test(desc)) {
      add({ ...baseOf(m), code: "D1", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, title: RULES.D1,
        detail: `Beschreibung: „${desc}“`, penalty: PENALTIES.none, sto: "10.4.4" });
    }
    if (!games.length) continue;

    // A7: Summen, Ausspielziele, Abgleich mit Spielplan
    let hw = 0, aw = 0;
    const raceTab = races[c === "relegation" ? "kombi" : c]?.[String(lg.level)] || {};
    for (const g of scoredGames(r)) {
      const [h, a] = g.score;
      if (h > a) hw++; else if (a > h) aw++;
      if (g.discipline === "14/1") {
        const race = raceTab["14/1"];
        if (race && g.points && Math.max(...g.points) !== race && g.home && g.away) {
          add({ ...baseOf(m), code: "A7R", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, extra: g.nr,
            title: RULES.A7R, detail: `Partie ${g.nr} (14.1): ${g.points.join(":")} Punkte, Ausspielziel ${race}. Mögliche Aufgabe oder Tippfehler.`,
            penalty: PENALTIES["10.3.2"], sto: sec + ".4 / 10.3.2" });
        }
      } else {
        const race = raceTab[g.discipline];
        if (race && Math.max(h, a) !== race && g.home && g.away && !(c === "pokal" && (g.nr || 0) > 8)) {
          add({ ...baseOf(m), code: "A7R", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, extra: g.nr,
            title: RULES.A7R, detail: `Partie ${g.nr} (${g.discipline}): ${h}:${a}, Ausspielziel ${race}. Mögliche Aufgabe oder Tippfehler.`,
            penalty: PENALTIES["10.3.2"], sto: sec + ".4 / 10.3.2" });
        }
      }
    }
    if (r.endstand && (r.endstand[0] !== hw || r.endstand[1] !== aw)) {
      add({ ...baseOf(m), code: "A7", severity: "verstoss", teamId: m.home_id, opponentId: m.away_id,
        title: RULES.A7, detail: `Endstand ${fmtRes(r.endstand)}, aus den Partien ergibt sich ${hw}:${aw}.`,
        penalty: PENALTIES["10.3.2"], sto: "10.3.2" });
    }
    if (r.endstand && m.result && (r.endstand[0] !== m.result[0] || r.endstand[1] !== m.result[1])) {
      add({ ...baseOf(m), code: "A7S", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id,
        title: RULES.A7S, detail: `Spielplan ${fmtRes(m.result)}, Spielbericht ${fmtRes(r.endstand)} (evtl. Wertungsänderung).`,
        penalty: PENALTIES.none, sto: "10.7" });
    }

    // A1–A4 je Seite
    for (const [side, tid, oid] of [["home", m.home_id, m.away_id], ["away", m.away_id, m.home_id]]) {
      const team = teamById.get(tid);
      const cnt = new Map(), perRound = new Map(), discRound = new Map();
      const empty = [];
      for (const g of games) {
        const nm = validName(g[side]);
        if (!nm) { if (g.score) empty.push(g); continue; }
        const k = resolve(nm);
        cnt.set(k, (cnt.get(k) || 0) + 1);
        const rk = k + "|" + g.round;
        perRound.set(rk, (perRound.get(rk) || 0) + 1);
        if (!discRound.has(k)) discRound.set(k, []);
        discRound.get(k).push(g);
      }
      const maxGames = c === "pokal" ? 8 : 99;
      for (const [k, n] of cnt) {
        const relevant = (discRound.get(k) || []).filter((g) => !g.nr || g.nr <= maxGames).length;
        if (relevant > 2) {
          add({ ...baseOf(m), code: "A1", severity: "verstoss", teamId: tid, opponentId: oid, playerKey: k, player: displayName.get(k),
            title: RULES.A1, detail: `${displayName.get(k)} spielt ${relevant} Partien für ${team?.name}.`, penalty: PENALTIES.none, sto: c === "senioren" ? "11.7.6" : c === "pokal" ? "11.6.7" : sec + ".6" });
        }
      }
      for (const [rk, n] of perRound) {
        const [k, rd] = rk.split("|");
        const inRegular = (discRound.get(k) || []).filter((g) => String(g.round) === rd && (!g.nr || g.nr <= maxGames)).length;
        if (inRegular > 1) {
          add({ ...baseOf(m), code: "A1R", severity: "verstoss", teamId: tid, opponentId: oid, playerKey: k, player: displayName.get(k), extra: rd,
            title: RULES.A1R, detail: `${displayName.get(k)} spielt im ${rd}. Durchgang ${inRegular} Partien für ${team?.name}.`, penalty: PENALTIES.none, sto: c === "senioren" ? "11.7.6" : c === "pokal" ? "11.6.7" : sec + ".6" });
        }
      }
      if (c === "senioren") {
        for (const [k, gs] of discRound) {
          const r1 = gs.filter((g) => g.round === 1).map((g) => g.discipline);
          const dup = gs.filter((g) => g.round === 2 && r1.includes(g.discipline));
          if (dup.length) {
            add({ ...baseOf(m), code: "A2", severity: "verstoss", teamId: tid, opponentId: oid, playerKey: k, player: displayName.get(k),
              title: RULES.A2, detail: `${displayName.get(k)} spielt ${dup[0].discipline} in beiden Durchgängen.`, penalty: PENALTIES.none, sto: "11.7.6" });
          }
        }
      }
      // A4 Mannschaftsstärke
      const distinct = cnt.size;
      const minFull = c === "senioren" ? 3 : 4;
      const minAllowed = minFull - 1;
      if (distinct < minAllowed) {
        add({ ...baseOf(m), code: "A4", severity: "verstoss", teamId: tid, opponentId: oid,
          title: RULES.A4, detail: `${team?.name} ist mit nur ${distinct} Spielern angetreten (mindestens ${minAllowed}).`, penalty: PENALTIES.none, sto: c === "senioren" ? "11.7.3" : sec + ".3" });
      } else if (distinct === minAllowed) {
        const expected = expectedDropped(c, games);
        const emptyIds = empty.map((g) => gameId(g));
        const wrong = emptyIds.filter((x) => !expected.includes(x));
        const missing = expected.filter((x) => !emptyIds.includes(x));
        if (wrong.length || missing.length) {
          add({ ...baseOf(m), code: "A4", severity: "hinweis", teamId: tid, opponentId: oid,
            title: RULES.A4, detail: `${team?.name} mit ${distinct} Spielern: Entfallen müssten ${expected.join(", ") || "–"}, leer sind ${emptyIds.join(", ") || "keine"}.`,
            penalty: PENALTIES.none, sto: c === "senioren" ? "11.7.3" : c === "pokal" ? "11.6.4" : sec + ".3" });
        }
      } else if (empty.length) {
        add({ ...baseOf(m), code: "A4E", severity: "hinweis", teamId: tid, opponentId: oid,
          title: RULES.A4E, detail: `${team?.name}: kein Spieler eingetragen bei ${empty.map(gameId).join(", ")}. Möglicher erster Springer-Einsatz (Spieler war noch nicht auswählbar) – Korrektur durch den Sportwart offen?`,
          penalty: PENALTIES["10.3.2"], sto: "Springer-Regelung / 10.3.2" });
      }
      // K1 Spieler nicht im Kader (nur Senioren/Pokal; Kombi siehe Springer)
      if (c !== "kombi" && team && (team.kader || []).length) {
        for (const k of cnt.keys()) {
          if (!teamKaderKeys.get(team.id).has(k)) {
            add({ ...baseOf(m), code: "K1", severity: "hinweis", teamId: tid, opponentId: oid, playerKey: k, player: displayName.get(k),
              title: RULES.K1, detail: `${displayName.get(k)} steht nicht im Kader von ${team.name}.` + (c === "senioren" ? " Nach- und Ummelden ist bei Senioren nicht erlaubt (11.7.3)." : ""),
              penalty: PENALTIES["10.2.7"], sto: c === "senioren" ? "11.7.3 / 10.2.1" : "10.2.1" });
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- Springer & Spielberechtigung (Kombi)
  const maxStByLeague = new Map();
  for (const m of matches) if (m.st != null && !isBye(m)) maxStByLeague.set(m.league_id, Math.max(maxStByLeague.get(m.league_id) || 0, m.st));
  const springer = [];
  for (const [key, list] of appsByPlayer) {
    const kombi = list.filter((a) => comp(a.team) === "kombi");
    // R5 / 10.2.6: gleicher Spieltag, verschiedene Mannschaften (je Wettbewerb)
    const bySt = new Map();
    for (const a of list) {
      if (a.match.st == null) continue;
      const kk = comp(a.team) + "|" + a.match.st;
      if (!bySt.has(kk)) bySt.set(kk, []);
      bySt.get(kk).push(a);
    }
    for (const [kk, arr] of bySt) {
      const teamIds = [...new Set(arr.map((a) => a.team.id))];
      if (teamIds.length > 1) {
        const later = arr.slice().sort(chrono).slice(1);
        for (const a of later) {
          add({ ...baseOf(a.match), code: "R5", severity: "verstoss", teamId: a.team.id, opponentId: oppOf(a), playerKey: key, player: a.name,
            title: RULES.R5,
            detail: `${a.name} spielt am ${a.match.st}. Spieltag für ${arr.map((x) => `${x.team.name} (${fmtD(x.match.date)})`).join(" und ")}. Maßgeblich ist die Spieltagnummer.`,
            penalty: PENALTIES["10.2.7"], sto: "10.2.6 / Springer-Regelung" });
        }
      }
    }
    if (!kombi.length) continue;

    // Stammmannschaft bestimmen
    const kad = (kaderOf.get(key) || []).filter((x) => comp(x.team) === "kombi");
    let stamm = null, source = "";
    if (kad.length) {
      kad.sort((x, y) => (x.first_seen || "").localeCompare(y.first_seen || "") || (lower(x.team, y.team) ? -1 : lower(y.team, x.team) ? 1 : 0));
      stamm = kad[0].team;
      source = "Kader";
    } else {
      const ts = [...new Map(kombi.map((a) => [a.team.id, a.team])).values()];
      ts.sort((x, y) => (lower(x, y) ? -1 : lower(y, x) ? 1 : 0));
      stamm = ts[0];
      source = "Einsätze";
    }
    const st = { key, name: displayName.get(key) || kombi[0].name, club: stamm.club, stammStart: stamm, stamm, source,
      springerTeam: null, uses: [], festgespielt: false, oldStamm: null, events: [] };

    for (const a of kombi) {
      const T = a.team;
      const base = { ...baseOf(a.match), teamId: T.id, opponentId: oppOf(a), playerKey: key, player: a.name };
      if (T.club !== st.stamm.club) {
        add({ ...base, code: "K2", severity: "hinweis", title: RULES.K2,
          detail: `${a.name} (Stammverein lt. ${source}: ${st.stamm.club}) spielt für ${T.name}. Vereinswechsel (2.7.1) oder Namensgleichheit prüfen.`,
          penalty: PENALTIES["10.2.7"], sto: "2.6.7 / 2.7.1" });
        continue;
      }
      if (T.id === st.stamm.id) continue;
      if (st.oldStamm && T.id === st.oldStamm.id) {
        add({ ...base, code: "R4", severity: "verstoss", title: RULES.R4,
          detail: `${a.name} ist seit ${fmtD(st.festAt)} Stammspieler von ${st.stamm.name} (3. Springer-Einsatz) und darf nicht mehr für ${T.name} spielen.`,
          penalty: PENALTIES["10.2.7"], sto: "Springer-Regelung" });
        continue;
      }
      if (higher(T, st.stamm)) {
        if (!springerOn) continue;
        const inKaderT = teamKaderKeys.get(T.id)?.has(key);
        if (!st.springerTeam) st.springerTeam = T;
        if (st.springerTeam.id !== T.id) {
          add({ ...base, code: "R2", severity: "verstoss", title: RULES.R2,
            detail: `${a.name} wurde bereits für ${st.springerTeam.name} als Springer eingesetzt und darf nicht zusätzlich in ${T.name} aushelfen.`,
            penalty: PENALTIES["10.2.7"], sto: "Springer-Regelung" });
          continue;
        }
        st.uses.push({ matchId: a.match.id, date: a.match.date, st: a.match.st, leagueId: a.match.league_id, team: T.name, n: st.uses.length + 1 });
        const n = st.uses.length;
        // R6 Vermerk in der Beschreibung
        const desc = a.report.description || "";
        if (!mentions(desc, a.name)) {
          add({ ...base, code: "R6", severity: "verstoss", title: RULES.R6,
            detail: `${n}. Springer-Einsatz von ${a.name} (Stamm: ${st.stamm.name}) für ${T.name}. Beschreibung: ${desc ? "„" + desc + "“" : "leer"}.` + (inKaderT ? " Spieler steht inzwischen im Kader – evtl. vom Sportwart angelegt." : ""),
            penalty: PENALTIES["10.3.2"], sto: "Springer-Regelung / 10.3.2" });
        } else if (!springerFormatOk(desc, a.name)) {
          add({ ...base, code: "R6F", severity: "hinweis", title: RULES.R6F,
            detail: `Beschreibung „${desc}“ – vorgeschrieben ist „Springer = Vorname Nachname Passnummer“.`,
            penalty: PENALTIES.none, sto: "Springer-Regelung" });
        }
        if (n === 3) {
          st.festgespielt = true;
          st.festAt = a.match.date;
          st.oldStamm = st.stamm;
          st.stamm = T;
          add({ ...base, code: "FEST", severity: "info", title: "Spieler festgespielt",
            detail: `${a.name}: 3. Einsatz in ${T.name} – ab jetzt Stammspieler dort, keine Einsätze mehr in ${st.oldStamm.name}.`,
            penalty: PENALTIES.none, sto: "Springer-Regelung" });
        }
      } else if (lower(T, st.stamm)) {
        if (!st.down) st.down = new Map();
        st.down.set(T.id, (st.down.get(T.id) || 0) + 1);
        const nT = st.down.get(T.id);
        const lgT = leagues.get(T.league_id) || {}, lgS = leagues.get(st.stamm.league_id) || {};
        const maxStT = maxStByLeague.get(T.league_id) || 0;
        const last3 = maxStT && a.match.st != null && a.match.st > maxStT - 3;
        const inKaderT = teamKaderKeys.get(T.id)?.has(key);
        const sameLevel = level(T) === level(st.stamm);
        const downTeams = [...st.down.keys()].map((id) => teamById.get(id)?.name).filter(Boolean);
        const parts = [
          `${a.name} ist laut ${source} Stammspieler von ${st.stamm.name} (${lgS.code || "?"}) und spielt am ${a.match.st}. Spieltag (${fmtD(a.match.date)}) für ${T.name} (${lgT.code || "?"}), eine ${sameLevel ? "gleich klassifizierte Mannschaft mit höherer Nummer" : "niedriger klassifizierte Mannschaft"} – ${nT}. Einsatz dort.`,
          `Als Springer darf ein Sportler nur in höherklassigen Mannschaften aushelfen. Ein Einsatz nach unten ist nur als regulärer Mannschaftswechsel (Ummeldung) möglich: nach STO ${sameLevel ? "10.6.3" : "10.6.2"} einmal je Spielzeit und nicht in den letzten drei Spieltagen.`,
          maxStT ? `Spieltag ${a.match.st} von ${maxStT}: ${last3 ? "liegt in den letzten drei Spieltagen – Wechsel hier nicht zulässig." : "außerhalb der letzten drei Spieltage."}` : "",
          inKaderT ? `${a.name} steht inzwischen im Kader von ${T.name} – Ummeldung vermutlich erfolgt.` : `${a.name} steht nicht im Kader von ${T.name} – keine Ummeldung erkennbar.`,
          downTeams.length > 1 ? `Bereits mehrere Mannschaften nach unten (${downTeams.join(", ")}): weiterer Wechsel nur nach 3 Monaten Wartezeit (10.6.4).` : "",
          `Zu beachten: Laut Springer-Regelung ist STO 10.6.2 gestrichen, die STO-Fassung vom 05.10.2026 enthält sie noch – abschließende Bewertung durch den 1. Sportwart.`,
        ];
        add({ ...base, code: "B4", severity: "hinweis", title: RULES.B4 + (last3 ? " – letzte drei Spieltage" : !inKaderT ? " – ohne Ummeldung" : ""),
          detail: parts.filter(Boolean).join(" "),
          penalty: PENALTIES["10.2.7"], sto: `${sameLevel ? "10.6.3" : "10.6.2"} / 10.6.4 / Springer-Regelung` });
      }
    }
    // Nicht im Kader gemeldet (nur wenn Kader der Mannschaft überhaupt erkannt wurde)
    if (!kad.length && (stamm.kader || []).length) {
      add({ matchId: kombi[0].match.id, leagueId: kombi[0].match.league_id, st: kombi[0].match.st, date: kombi[0].match.date, url: kombi[0].match.url,
        code: "K1", severity: "hinweis", teamId: stamm.id, playerKey: key, player: st.name, title: RULES.K1,
        detail: `${st.name} spielt für ${stamm.name}, ist aber in keinem Kader gemeldet.`, penalty: PENALTIES["10.2.7"], sto: "10.2.1 / 3.3" });
    }
    if (st.uses.length || st.festgespielt) springer.push(st);
  }

  // R6X: Beschreibung nennt Springer, aber keiner erkannt
  const springerMatches = new Set(springer.flatMap((s) => s.uses.map((u) => u.matchId)));
  for (const f of findings) if (["R2", "R4", "B4", "K2"].includes(f.code)) springerMatches.add(f.matchId);
  for (const m of matches) {
    const r = reports[String(m.id)];
    if (r && /springer/i.test(r.description || "") && !springerMatches.has(m.id)) {
      add({ ...baseOf(m), code: "R6X", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, title: RULES.R6X,
        detail: `Beschreibung „${r.description}“. Prüfen: Stammmannschaft, Namensschreibweise oder Kader.`, penalty: PENALTIES.none, sto: "Springer-Regelung" });
    }
  }

  // ---------------------------------------------------------------- Kader-Regeln
  const byLeagueClub = new Map();
  for (const t of teams) {
    const k = t.league_id + "|" + t.club;
    if (!byLeagueClub.has(k)) byLeagueClub.set(k, []);
    byLeagueClub.get(k).push(t);
    if ((t.kader || []).length > 10) {
      add({ code: "A9", severity: "hinweis", teamId: t.id, leagueId: t.league_id, title: RULES.A9,
        detail: `${t.name}: ${t.kader.length} Spieler im Kader.`, penalty: PENALTIES.none, sto: "4.1.3 / 10.2.1" });
    }
  }
  for (const [k, ts] of byLeagueClub) {
    if (ts.length > 2) {
      add({ code: "A8", severity: "hinweis", teamId: ts[0].id, leagueId: ts[0].league_id, extra: k, title: RULES.A8,
        detail: ts.map((t) => t.name).join(", "), penalty: PENALTIES.none, sto: "11.8" });
    }
  }
  for (const [key, list] of kaderOf) {
    const komb = [...new Map(list.filter((x) => comp(x.team) === "kombi").map((x) => [x.team.id, x.team])).values()];
    if (komb.length > 1) {
      add({ code: "A10", severity: "hinweis", teamId: komb[0].id, leagueId: komb[0].league_id, playerKey: key, player: displayName.get(key),
        title: RULES.A10, detail: `${displayName.get(key)} steht in den Kadern von ${komb.map((t) => t.name).join(" und ")}. (Kann auch ein vom Sportwart angelegter Springer sein.)`,
        penalty: PENALTIES.none, sto: "4.1.4" });
    }
  }

  // ---------------------------------------------------------------- Spielplan-Regeln
  const today = settings.today ? new Date(settings.today) : new Date();
  const byLeague = new Map();
  for (const m of matches) {
    if (!byLeague.has(m.league_id)) byLeague.set(m.league_id, []);
    byLeague.get(m.league_id).push(m);
  }
  for (const [lid, ms] of byLeague) {
    const lg = leagues.get(lid) || {};
    if (lg.competition === "pokal" || lg.competition === "relegation") continue;
    const regular = new Map();
    const bySt = new Map();
    for (const m of ms) {
      if (m.st == null || !m.date) continue;
      if (!bySt.has(m.st)) bySt.set(m.st, []);
      bySt.get(m.st).push(m.date);
    }
    for (const [s, ds] of bySt) regular.set(s, mode(ds));
    const maxSt = Math.max(0, ...bySt.keys());
    // B1 Verlegungen
    for (const m of ms) {
      const reg = regular.get(m.st);
      if (!reg || !m.date || isBye(m)) continue;
      const d = parseDate(m.date), r0 = parseDate(reg);
      const diff = Math.round((d - r0) / DAY);
      if (diff <= 3) {
        if (!m.result && d.getTime() + 28 * DAY < today.getTime()) {
          add({ ...baseOf(m), code: "B1O", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, title: RULES.B1O,
            detail: `Angesetzt am ${fmtD(m.date)}, noch kein Ergebnis.`, penalty: PENALTIES["10.5.8"], sto: "10.5.6 / 10.5.8" });
        }
        continue;
      }
      let problem = null;
      if (m.st >= 15) problem = `Nachverlegung ab dem 15. Spieltag nicht zulässig (Regeltermin ${fmtD(reg)}, angesetzt ${fmtD(m.date)}).`;
      else if (r0.getFullYear() === seasonStartYear) {
        if (d > new Date(seasonStartYear + "-12-31T23:59:59")) problem = `Spieltag im ersten Kalenderjahr: Nachverlegung nur bis 31.12.${seasonStartYear} (Regeltermin ${fmtD(reg)}, angesetzt ${fmtD(m.date)}).`;
      } else if (diff > 28) problem = `Nachverlegung um ${diff} Tage (max. 4 Wochen; Regeltermin ${fmtD(reg)}, angesetzt ${fmtD(m.date)}).`;
      if (problem) {
        add({ ...baseOf(m), code: "B1", severity: "hinweis", teamId: m.home_id, opponentId: m.away_id, title: RULES.B1,
          detail: problem + " Genehmigung durch den Sportwart prüfen.", penalty: PENALTIES["10.5.8"], sto: "10.5.6 / 10.5.8" });
      } else {
        add({ ...baseOf(m), code: "B1", severity: "info", teamId: m.home_id, opponentId: m.away_id, title: "Spiel verlegt (innerhalb der Frist)",
          detail: `Regeltermin ${fmtD(reg)}, angesetzt ${fmtD(m.date)}.`, penalty: PENALTIES.none, sto: "10.5.6" });
      }
    }
    // B2 Vereinsduell
    const teamsHere = teams.filter((t) => t.league_id === lid);
    const rrStart = maxSt ? regular.get(Math.floor(maxSt / 2) + 1) : null;
    for (let i = 0; i < teamsHere.length; i++) {
      for (let j = i + 1; j < teamsHere.length; j++) {
        const a = teamsHere[i], b = teamsHere[j];
        if (a.club !== b.club) continue;
        const duel = ms.filter((m) => (m.home_id === a.id && m.away_id === b.id) || (m.home_id === b.id && m.away_id === a.id))
          .sort((x, y) => (x.st || 0) - (y.st || 0));
        if (duel.length < 2 || duel[0].st === 1 || !rrStart) continue;
        const ret = duel[1];
        if (!ret.date || ret.date >= rrStart) {
          add({ ...baseOf(ret), code: "B2", severity: "hinweis", teamId: a.id, opponentId: b.id, title: RULES.B2,
            detail: `${a.name} – ${b.name}: Rückspiel am ${fmtD(ret.date)}, Rückrunde beginnt ${fmtD(rrStart)}. Muss vorgezogen werden.`,
            penalty: PENALTIES["10.2.8"], sto: "10.2.8" });
        }
      }
    }
  }

  // Abmeldungen (Meldungen der Startseite) und B3: Sperre von drei Spieltagen in niedrigeren Mannschaften (10.8.2)
  const regularByLeague = new Map();
  {
    const tmp = new Map();
    for (const m of matches) {
      if (m.st == null || !m.date || isBye(m)) continue;
      const k = m.league_id + "|" + m.st;
      if (!tmp.has(k)) tmp.set(k, []);
      tmp.get(k).push(m.date);
    }
    for (const [k, ds] of tmp) {
      const [lid, st] = k.split("|").map(Number);
      if (!regularByLeague.has(lid)) regularByLeague.set(lid, new Map());
      regularByLeague.get(lid).set(st, mode(ds));
    }
  }
  for (const w of withdrawals) {
    const t = teamById.get(w.team_id);
    const lg = leagues.get(w.league_id) || {};
    add({ code: "WD", severity: "hinweis", teamId: t?.id ?? null, leagueId: w.league_id, date: w.date, extra: w.date + w.club,
      title: `Mannschaft ${w.kind || "abgemeldet"}`,
      detail: `${t ? t.name : w.club} (${lg.code || w.league_name}) laut Meldung vom ${fmtD(w.date)}: „${w.text}“` +
        (t ? "" : " Die Mannschaft ist im Spielplan nicht mehr enthalten und war in früheren Läufen nicht erfasst – Kader und Einsätze liegen nicht vor."),
      penalty: { sto: "10.8.1", nr: 15, betrag: 100, text: "Abmeldung einer Mannschaft im Laufe der Spielzeit: Bußgeld 100,00 € (Bußgeldkatalog Nr. 15). Die Spiele der Mannschaft werden annulliert." },
      sto: "10.8.1", withdrawal: w });
  }
  for (const t of teams.filter((x) => x.withdrawn)) {
    const wd = t.withdrawn_at || matches.filter((m) => (m.home_id === t.id || m.away_id === t.id) && m.result).map((m) => m.date).sort().pop() || "";
    const players = new Set(apps.filter((a) => a.team.id === t.id).map((a) => a.key));
    for (const k of teamKaderKeys.get(t.id) || []) players.add(k);
    for (const a of apps) {
      if (!players.has(a.key) || a.team.id === t.id || a.team.club !== t.club || comp(a.team) !== comp(t)) continue;
      if ((a.match.date || "") < wd || !lower(a.team, t)) continue;
      // die ersten drei Spieltage der unteren Liga nach der Abmeldung sind gesperrt
      const reg = regularByLeague.get(a.team.league_id) || new Map();
      const blocked = [...reg.entries()].filter(([, d]) => d >= wd).sort((x, y) => x[0] - y[0]).slice(0, 3).map(([st]) => st);
      if (a.match.st != null && blocked.includes(a.match.st)) {
        add({ ...baseOf(a.match), code: "B3", severity: "verstoss", teamId: a.team.id, opponentId: oppOf(a), playerKey: a.key, player: a.name, title: RULES.B3,
          detail: `${a.name} gehörte zu ${t.name} (abgemeldet am ${fmtD(wd)}) und spielt am ${a.match.st}. Spieltag (${fmtD(a.match.date)}) für die niedriger klassifizierte Mannschaft ${a.team.name}. Gesperrt sind dort die Spieltage ${blocked.join(", ")}; in höher oder gleich klassifizierten Mannschaften wäre der Einsatz ohne Sperre zulässig.`,
          penalty: PENALTIES["10.2.7"], sto: "10.8.2 / 10.2.7" });
      }
    }
  }

  // B7 dreimal nicht angetreten
  const zuNull = new Map();
  for (const m of matches) {
    const r = reports[String(m.id)];
    if (!r || isBye(m) || !isZuNull(r)) continue;
    const res = r.endstand || m.result;
    if (!res) continue;
    const loser = res[0] < res[1] ? m.home_id : res[1] < res[0] ? m.away_id : null;
    if (loser) zuNull.set(loser, [...(zuNull.get(loser) || []), m]);
  }
  for (const [tid, ms] of zuNull) {
    if (ms.length >= 3) {
      const t = teamById.get(tid);
      add({ ...baseOf(ms[2]), code: "B7", severity: "hinweis", teamId: tid, title: RULES.B7,
        detail: `${t?.name}: ${ms.length} Wertungen ohne Einzelpartien (${ms.map((m) => fmtD(m.date)).join(", ")}). Bei Nichtantreten: Disqualifikation.`,
        penalty: PENALTIES.none, sto: "10.8.1" });
    }
  }

  // Änderungen an Spielberichten
  for (const ch of changes) {
    const m = matchById.get(ch.report_id);
    if (!m) continue;
    add({ ...baseOf(m), code: "CH", severity: "info", teamId: m.home_id, opponentId: m.away_id, extra: ch.detected_at, title: RULES.CH,
      detail: `Erkannt ${fmtDT(ch.detected_at)}: ${ch.diff.map((d) => d.field).join(", ")}.`, penalty: PENALTIES.none, sto: "10.4.2", change: ch });
  }

  // Anreichern
  for (const f of findings) {
    f.team = teamById.get(f.teamId)?.name || "";
    f.opponent = teamById.get(f.opponentId)?.name || "";
    f.league = leagues.get(f.leagueId)?.code || "";
    f.competition = leagues.get(f.leagueId)?.competition || "";
    const m = matchById.get(f.matchId);
    if (m) f.match = `${teamById.get(m.home_id)?.name || "?"} – ${teamById.get(m.away_id)?.name || "?"}`;
  }
  const sevOrder = { verstoss: 0, hinweis: 1, info: 2 };
  findings.sort((a, b) => (a.st ?? 999) - (b.st ?? 999) || sevOrder[a.severity] - sevOrder[b.severity] || (a.league || "").localeCompare(b.league || "") || (a.date || "").localeCompare(b.date || ""));

  const players = [...appsByPlayer.entries()].map(([key, list]) => ({
    key, name: displayName.get(key), clubs: new Set(list.map((a) => a.team.club)), apps: list.length,
  }));
  for (const [key, list] of kaderOf) {
    if (!appsByPlayer.has(key)) players.push({ key, name: displayName.get(key), clubs: new Set(list.map((x) => x.team.club)), apps: 0 });
  }

  return {
    findings,
    springer: springer.map((s) => ({
      key: s.key, name: s.name, club: s.club, stamm: s.stammStart.name, stammSource: s.source,
      springerTeam: s.springerTeam?.name || "", uses: s.uses, festgespielt: s.festgespielt, festAt: s.festAt || null,
      currentStamm: s.stamm.name,
    })),
    players,
    stats: {
      matches: matches.length,
      reports: Object.keys(reports).length,
      appearances: apps.length,
    },
  };

  function oppOf(a) {
    return a.side === "home" ? a.match.away_id : a.match.home_id;
  }
}

function isBye(m) {
  return !!m.bye || !!m.removed || !m.home_id || !m.away_id;
}

function scoredGames(r) {
  return (r.games || []).filter((g) => g.score && (g.score[0] + g.score[1] > 0 || validName(g.home) || validName(g.away)));
}

function isZuNull(r) {
  return !!r.zu_null || (!scoredGames(r).length && !!r.endstand);
}

function validName(s) {
  const t = String(s || "").trim();
  return /[A-Za-zÄÖÜäöüß]{2}/.test(t) ? t : "";
}

function gameId(g) {
  return `${g.round}. DG ${g.discipline}` + (g.nr ? ` (Nr. ${g.nr})` : "");
}

function expectedDropped(c, games) {
  // 11.x.3: 3 Spieler -> DG1 9-Ball und DG2 14.1 entfallen; Pokal: Spiel 4 und 8; Senioren (2 Spieler): DG1 8-Ball
  if (c === "pokal") return games.filter((g) => g.nr === 4 || g.nr === 8).map(gameId);
  if (c === "senioren") return games.filter((g) => g.round === 1 && g.discipline === "8-Ball").map(gameId);
  return games.filter((g) => (g.round === 1 && g.discipline === "9-Ball") || (g.round === 2 && g.discipline === "14/1")).map(gameId);
}

export function fmtD(iso) {
  if (!iso) return "?";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
export function fmtDT(iso) {
  if (!iso) return "?";
  return fmtD(iso) + (iso.length > 10 ? " " + iso.slice(11, 16) + " Uhr" : "");
}
export function fmtRes(r) {
  return r ? `${r[0]}:${r[1]}` : "–";
}
