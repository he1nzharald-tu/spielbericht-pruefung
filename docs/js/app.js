import { analyze, PENALTIES, RULES, fmtD, fmtDT, fmtRes } from "./rules.js";
import { suggestMerges, nameKey } from "./names.js";
import * as store from "./store.js";
import { buildPdf } from "./pdf.js";

const BASE_URL = "https://billard-blmr.de/";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  seasons: [],
  season: null,
  data: null,
  result: null,
  tab: "faelle",
  teamsById: new Map(),
  leaguesById: new Map(),
};

// ------------------------------------------------------------------ Laden

async function getJson(path, bust) {
  const r = await fetch(path + (bust ? `?v=${encodeURIComponent(bust)}` : ""), { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function loadSeason(slug) {
  $("#stand").textContent = "Lade Daten …";
  const base = `data/${slug}/`;
  const meta = await getJson(base + "meta.json", Date.now());
  const v = meta.generated_at;
  const [teams, matches, reports, changes, withdrawals] = await Promise.all([
    getJson(base + "teams.json", v),
    getJson(base + "matches.json", v),
    getJson(base + "reports.json", v),
    getJson(base + "changes.json", v).catch(() => []),
    getJson(base + "withdrawals.json", v).catch(() => []),
  ]);
  state.data = { meta, teams, matches, reports, changes, withdrawals };
  state.teamsById = new Map(teams.map((t) => [t.id, t]));
  state.leaguesById = new Map(meta.leagues.map((l) => [l.id, l]));
  runAnalysis();
  fillFilters();
  const errs = (meta.errors || []).length;
  $("#stand").textContent = `Stand ${fmtDT(meta.generated_at.replace("Z", ""))} UTC · ${meta.counts.reports} Spielberichte` + (errs ? ` · ${errs} Ladefehler` : "");
  render();
}

function runAnalysis() {
  const s = store.load();
  state.result = analyze(state.data, { aliases: s.aliases, sportwarte: s.sportwarte });
}

async function init() {
  bindStatic();
  try {
    state.seasons = await getJson("data/seasons.json", Date.now());
  } catch {
    state.seasons = [];
  }
  if (!state.seasons.length) {
    $("#view").innerHTML = `<p class="empty">Noch keine Daten vorhanden. Bitte unter <a href="${actionsUrl()}" target="_blank" rel="noopener">GitHub Actions</a> den Lauf „Daten aktualisieren“ starten.</p>`;
    $("#stand").textContent = "Keine Daten";
    return;
  }
  const sel = $("#f-season");
  sel.innerHTML = state.seasons.map((s) => `<option value="${esc(s.slug)}">${esc(s.season)}</option>`).join("");
  sel.value = state.seasons[state.seasons.length - 1].slug;
  state.season = sel.value;
  try {
    await loadSeason(state.season);
  } catch (e) {
    $("#view").innerHTML = `<p class="empty">Daten konnten nicht geladen werden: ${esc(e.message)}</p>`;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function actionsUrl() {
  return `https://github.com/${store.load().repo}/actions/workflows/scrape.yml`;
}

// ------------------------------------------------------------------ Filter

function fillFilters() {
  const { matches, meta, teams } = state.data;
  const sts = [...new Set(matches.map((m) => m.st).filter((x) => x != null))].sort((a, b) => a - b);
  const played = matches.filter((m) => m.result && m.st != null).map((m) => m.st);
  const lastPlayed = played.length ? Math.max(...played) : sts[0] || 1;
  const opt = (v) => `<option value="${v}">${v}</option>`;
  const from = $("#f-st-from"), to = $("#f-st-to");
  const prevFrom = from.value, prevTo = to.value;
  from.innerHTML = sts.map(opt).join("");
  to.innerHTML = sts.map(opt).join("");
  from.value = prevFrom && sts.includes(+prevFrom) ? prevFrom : String(lastPlayed);
  to.value = prevTo && sts.includes(+prevTo) ? prevTo : String(lastPlayed);

  const lg = $("#f-league");
  const prevL = lg.value;
  const comps = { kombi: "Kombi", senioren: "Senioren", pokal: "Pokal", relegation: "Relegation" };
  lg.innerHTML = `<option value="">Alle Ligen</option>` +
    Object.entries(comps).map(([c, label]) => `<optgroup label="${label}">` +
      meta.leagues.filter((l) => l.competition === c).map((l) => `<option value="${l.id}">${esc(l.code)} – ${esc(l.name)}</option>`).join("") + `</optgroup>`).join("");
  lg.value = prevL;

  const clubSel = $("#f-club");
  const prevC = clubSel.value;
  const clubs = [...new Set(teams.map((t) => t.club))].sort((a, b) => a.localeCompare(b, "de"));
  clubSel.innerHTML = `<option value="">Alle Vereine</option>` + clubs.map((c) => `<option>${esc(c)}</option>`).join("");
  clubSel.value = prevC;
}

function filters() {
  return {
    stFrom: +$("#f-st-from").value || 0,
    stTo: +$("#f-st-to").value || 99,
    league: $("#f-league").value ? +$("#f-league").value : null,
    club: $("#f-club").value,
    status: $("#f-status").value,
    sev: { verstoss: $("#f-sev-verstoss").checked, hinweis: $("#f-sev-hinweis").checked, info: $("#f-sev-info").checked },
    q: $("#f-search").value.trim().toLowerCase(),
  };
}

function filterText(f) {
  const parts = [];
  if (f.league) parts.push("Liga " + (state.leaguesById.get(f.league)?.code || f.league));
  if (f.club) parts.push("Verein " + f.club);
  if (f.status) parts.push("Status " + f.status);
  if (f.q) parts.push(`Suche „${f.q}“`);
  return parts.join(", ");
}

function filteredFindings({ includeNoSt = true } = {}) {
  const f = filters();
  const out = [];
  for (const it of state.result.findings) {
    if (it.st != null) {
      if (it.st < f.stFrom || it.st > f.stTo) continue;
    } else if (!includeNoSt) continue;
    if (!f.sev[it.severity]) continue;
    if (f.league && it.leagueId !== f.league) continue;
    if (f.club) {
      const t = state.teamsById.get(it.teamId), o = state.teamsById.get(it.opponentId);
      if (t?.club !== f.club && o?.club !== f.club) continue;
    }
    const cs = store.caseState(it.id);
    if (f.status && cs.status !== f.status) continue;
    if (f.q) {
      const hay = [it.title, it.detail, it.player, it.team, it.opponent, it.match, it.league, cs.note].join(" ").toLowerCase();
      if (!hay.includes(f.q)) continue;
    }
    out.push(it);
  }
  return out;
}

// ------------------------------------------------------------------ Darstellung

function render() {
  if (!state.data) return;
  const f = filters();
  const sevs = Object.entries(f.sev).filter(([, v]) => v).map(([k]) => SEVL[k]).join(", ");
  $("#filter-summary").textContent = [`ST ${f.stFrom === f.stTo ? f.stFrom : f.stFrom + "–" + f.stTo}`, filterText(f), sevs].filter(Boolean).join(" · ");
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const v = $("#view");
  ({ faelle: renderCases, springer: renderSpringer, berichte: renderReports, aenderungen: renderChanges, einstellungen: renderSettings })[state.tab](v);
}

function reportLink(it) {
  return it.url ? BASE_URL + it.url.replace(/^\//, "") : null;
}

function renderCases(v) {
  const list = filteredFindings();
  const all = state.result.findings;
  const f = filters();
  const inRange = all.filter((x) => x.st == null || (x.st >= f.stFrom && x.st <= f.stTo));
  const cnt = (sev) => inRange.filter((x) => x.severity === sev).length;
  const open = inRange.filter((x) => x.severity !== "info" && store.caseState(x.id).status === "offen").length;
  const checked = state.data.matches.filter((m) => m.st >= f.stFrom && m.st <= f.stTo && state.data.reports[String(m.id)]).length;

  let html = `<div class="cards">
    <div class="stat verstoss"><b>${cnt("verstoss")}</b><span>Verstöße</span></div>
    <div class="stat hinweis"><b>${cnt("hinweis")}</b><span>Hinweise</span></div>
    <div class="stat"><b>${open}</b><span>offen</span></div>
    <div class="stat"><b>${checked}</b><span>Spielberichte geprüft</span></div>
  </div>`;
  if (!list.length) {
    v.innerHTML = html + `<p class="empty">Keine Fälle für die gewählten Filter.</p>`;
    return;
  }
  const groups = new Map();
  for (const it of list) {
    const k = it.st ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  for (const [st, items] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const nV = items.filter((x) => x.severity === "verstoss").length;
    html += `<section class="st-group"><h2>${st ? st + ". Spieltag" : "Saison / Kader"} <small>${items.length} Fälle${nV ? `, ${nV} Verstöße` : ""}</small></h2>`;
    html += items.map(caseCard).join("");
    html += `</section>`;
  }
  v.innerHTML = html;
}

const SEVL = { verstoss: "Verstoß", hinweis: "Hinweis", info: "Info" };
const STATL = { offen: "offen", erledigt: "erledigt", kein: "kein Verstoß" };

function caseCard(it) {
  const cs = store.caseState(it.id);
  const link = reportLink(it);
  const meta = [it.league, it.date ? fmtD(it.date) : "", it.match || it.team].filter(Boolean).join(" · ");
  const pen = it.penalty && it.penalty.sto ? `Folge (${esc(it.penalty.sto)}): ${esc(it.penalty.text)}` : it.penalty ? esc(it.penalty.text) : "";
  const diff = it.change ? `<div class="diff">${it.change.diff.map((d) => `${esc(d.field)}: <span class="before">${esc(short(d.before))}</span> → <span class="after">${esc(short(d.after))}</span>`).join("\n")}</div>` : "";
  return `<article class="case ${it.severity} ${cs.status !== "offen" ? "done" : ""}" data-id="${esc(it.id)}">
    <header>
      <span class="chip ${it.severity}">${SEVL[it.severity]}</span>
      <h3>${esc(it.title)}</h3>
      ${it.severity !== "info" ? `<span class="chip status ${cs.status}">${STATL[cs.status]}</span>` : ""}
      ${cs.mailedAt ? `<span class="chip status">Mail ${fmtD(cs.mailedAt.slice(0, 10))}</span>` : ""}
    </header>
    <p class="meta">${esc(meta)}${it.player ? ` · Spieler: <b>${esc(it.player)}</b>` : ""} · STO ${esc(it.sto || "–")}</p>
    <p class="detail">${esc(it.detail)}</p>
    ${diff}
    ${it.severity !== "info" ? `<p class="penalty">${pen}</p>` : ""}
    <div class="actions">
      ${link ? `<a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Spielbericht</a>` : ""}
      ${it.severity !== "info" ? `
      <select data-act="status" aria-label="Status">
        ${Object.entries(STATL).map(([k, l]) => `<option value="${k}" ${cs.status === k ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="btn small" data-act="mail" type="button">E-Mail …</button>
      <button class="btn small ghost" data-act="note" type="button">${cs.note ? "Notiz bearbeiten" : "Notiz"}</button>` : ""}
    </div>
    ${cs.note ? `<p class="meta">Notiz: ${esc(cs.note)}</p>` : ""}
  </article>`;
}

function short(v) {
  if (v == null) return "–";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  if (Array.isArray(v)) return v.join(":");
  if (typeof v === "object") return [v.home, v.score ? v.score.join(":") : "", v.away].filter((x) => x !== "").join(" ");
  return String(v);
}

function renderSpringer(v) {
  const f = filters();
  let rows = state.result.springer;
  if (f.club) rows = rows.filter((s) => s.club === f.club);
  if (f.q) rows = rows.filter((s) => [s.name, s.club, s.stamm, s.springerTeam].join(" ").toLowerCase().includes(f.q));
  if (!rows.length) {
    v.innerHTML = `<p class="empty">Keine Springer-Einsätze erkannt.</p>`;
    return;
  }
  v.innerHTML = `<p class="muted">Ganze Saison. Springer-Mannschaft = erste höherklassige Mannschaft, in der der Spieler eingesetzt wurde. Ab dem 3. Einsatz dort ist er festgespielt.</p>
  <div class="table-wrap"><table class="data">
    <thead><tr><th>Spieler</th><th>Verein</th><th>Stammmannschaft</th><th>Springer-Mannschaft</th><th>Einsätze</th><th>Status</th></tr></thead>
    <tbody>${rows.map((s) => `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${esc(s.club)}</td>
      <td>${esc(s.stamm)}<br><span class="muted">lt. ${esc(s.stammSource)}</span></td>
      <td>${esc(s.springerTeam)}</td>
      <td><div class="uses">${s.uses.map((u) => `<a class="use ${u.n >= 3 ? "n3" : ""}" href="${esc(BASE_URL + (state.data.matches.find((m) => m.id === u.matchId)?.url || ""))}" target="_blank" rel="noopener">${u.n}. · ST ${u.st} · ${fmtD(u.date)}</a>`).join("")}</div></td>
      <td>${s.festgespielt ? `<b>festgespielt</b> seit ${fmtD(s.festAt)}<br><span class="muted">Stamm jetzt ${esc(s.currentStamm)}</span>` : `${s.uses.length} von 2`}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderReports(v) {
  const f = filters();
  const { matches, reports } = state.data;
  let ms = matches.filter((m) => m.st != null && m.st >= f.stFrom && m.st <= f.stTo);
  if (f.league) ms = ms.filter((m) => m.league_id === f.league);
  if (f.club) ms = ms.filter((m) => state.teamsById.get(m.home_id)?.club === f.club || state.teamsById.get(m.away_id)?.club === f.club);
  const findingsByMatch = new Map();
  for (const it of state.result.findings) {
    if (!it.matchId || it.severity === "info") continue;
    findingsByMatch.set(it.matchId, (findingsByMatch.get(it.matchId) || 0) + (it.severity === "verstoss" ? 100 : 1));
  }
  ms.sort((a, b) => a.st - b.st || a.league_id - b.league_id || (a.date || "").localeCompare(b.date || ""));
  if (f.q) ms = ms.filter((m) => {
    const r = reports[String(m.id)];
    return [state.teamsById.get(m.home_id)?.name, state.teamsById.get(m.away_id)?.name, r?.description, r?.protest, ...(r?.games || []).flatMap((g) => [g.home, g.away])].join(" ").toLowerCase().includes(f.q);
  });
  v.innerHTML = ms.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>ST</th><th>Liga</th><th>Datum</th><th>Begegnung</th><th>Ergebnis</th><th>Beschreibung / Protest</th><th>Erfasst</th><th>Fälle</th></tr></thead>
    <tbody>${ms.map((m) => {
      const r = reports[String(m.id)];
      const score = findingsByMatch.get(m.id) || 0;
      const nV = Math.floor(score / 100), nH = score % 100;
      return `<tr>
        <td>${m.st}</td><td>${esc(state.leaguesById.get(m.league_id)?.code)}</td>
        <td>${fmtD(m.date)}${m.time ? " " + m.time : ""}</td>
        <td><a href="${esc(BASE_URL + m.url)}" target="_blank" rel="noopener">${esc(state.teamsById.get(m.home_id)?.name || "?")} – ${esc(state.teamsById.get(m.away_id)?.name || "?")}</a>${m.removed ? ` <span class="chip status">gestrichen</span>` : ""}</td>
        <td>${fmtRes(r?.endstand || m.result)}</td>
        <td>${esc(r?.description || (m.memo || []).join("; "))}${r?.protest ? `<br><span class="muted">Protest:</span> ${esc(r.protest)}` : ""}</td>
        <td>${r?.captured_at ? fmtDT(r.captured_at) + "<br><span class='muted'>" + esc(r.captured_by || "") + "</span>" : r ? "–" : "<span class='muted'>nicht geladen</span>"}</td>
        <td>${nV ? `<span class="chip verstoss">${nV}</span> ` : ""}${nH ? `<span class="chip hinweis">${nH}</span>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>` : `<p class="empty">Keine Begegnungen im gewählten Bereich.</p>`;
}

function renderChanges(v) {
  const ch = [...(state.data.changes || [])].reverse();
  if (!ch.length) {
    v.innerHTML = `<p class="empty">Noch keine nachträglichen Änderungen an Spielberichten erkannt.</p>
      <p class="muted">Der wöchentliche Lauf (montags 11 Uhr) lädt alle Spielpläne und Spielberichte komplett neu. Jede Abweichung zum vorherigen Stand erscheint hier mit Vorher/Nachher.</p>`;
    return;
  }
  v.innerHTML = ch.map((c) => {
    const m = state.data.matches.find((x) => x.id === c.report_id);
    const title = m ? `${state.teamsById.get(m.home_id)?.name} – ${state.teamsById.get(m.away_id)?.name}` : `Bericht ${c.report_id}`;
    return `<article class="case info">
      <header><span class="chip info">Änderung</span><h3>${esc(title)}</h3></header>
      <p class="meta">${esc(state.leaguesById.get(c.league_id)?.code || "")} · ${c.st ?? "?"}. Spieltag · erkannt ${fmtDT(c.detected_at.replace("Z", ""))} UTC</p>
      <div class="diff">${c.diff.map((d) => `${esc(d.field)}: <span class="before">${esc(short(d.before))}</span> → <span class="after">${esc(short(d.after))}</span>`).join("\n")}</div>
      ${m ? `<div class="actions" style="margin-top:.5rem"><a class="btn small" href="${esc(BASE_URL + m.url)}" target="_blank" rel="noopener">Spielbericht</a></div>` : ""}
    </article>`;
  }).join("");
}

function renderSettings(v) {
  const s = store.load();
  const clubs = new Map();
  for (const t of state.data.teams) {
    if (!clubs.has(t.club)) clubs.set(t.club, []);
    clubs.get(t.club).push(t);
  }
  const clubNames = [...clubs.keys()].sort((a, b) => a.localeCompare(b, "de"));
  const missing = clubNames.filter((c) => !s.addresses["club:" + c] && !clubs.get(c).some((t) => s.addresses["team:" + t.id])).length;

  const suggestions = suggestMerges(state.result.players, s.distinct).slice(0, 40);
  const aliasEntries = Object.entries(s.aliases);
  const meta = state.data.meta;

  v.innerHTML = `<div class="settings">
  <section>
    <h2>Daten</h2>
    <p class="muted">Stand: ${fmtDT(meta.generated_at.replace("Z", ""))} UTC (${esc(meta.mode)}) · ${meta.requests} Abrufe · letzter Vollabgleich: ${meta.last_full_at ? fmtDT(meta.last_full_at.replace("Z", "")) + " UTC" : "–"}</p>
    <p class="muted">Die Daten werden automatisch jeden Montag um 11 Uhr komplett aktualisiert; danach kommt eine Push-Nachricht (auch wenn es keine neuen Fälle gibt). Für eine sofortige Aktualisierung den Lauf bei GitHub starten („Run workflow“).</p>
    <div class="row"><a class="btn" href="${actionsUrl()}" target="_blank" rel="noopener">Daten jetzt aktualisieren (GitHub)</a>
      <button class="btn" type="button" id="btn-reload">Neu laden</button></div>
    ${(meta.errors || []).length || (meta.warnings || []).length ? `<details><summary>Diagnose: ${(meta.errors || []).length} Fehler, ${(meta.warnings || []).length} Warnungen</summary>
      <ul class="diag">${[...(meta.errors || []), ...(meta.warnings || [])].slice(0, 200).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
  </section>

  <section>
    <h2>Absender und Vorgaben</h2>
    <div class="row">
      <label>Absender (Signatur in E-Mails)<textarea id="set-absender" rows="3" placeholder="Vorname Nachname&#10;1. Sportwart PBVRW">${esc(s.absender)}</textarea></label>
      <label>Sportwart-Namen (Erfassungen durch diese gelten als Korrektur, kommagetrennt)<input type="text" id="set-sportwarte" value="${esc(s.sportwarte.join(", "))}"></label>
      <label>Frist für Stellungnahmen (Tage)<input type="text" inputmode="numeric" id="set-frist" value="${esc(s.fristTage)}"></label>
    </div>
  </section>

  <section>
    <h2>E-Mail-Adressen</h2>
    <p class="muted">Adresse je Verein; abweichend kann je Mannschaft eine eigene Adresse eingetragen werden. Mehrere Adressen mit Komma trennen. ${missing ? `<b>${missing} Vereine ohne Adresse.</b>` : ""}</p>
    ${clubNames.map((c) => `<details class="addr-club"><summary>${esc(c)} ${s.addresses["club:" + c] ? "" : "<span class='muted'>(keine Adresse)</span>"}</summary>
      <div class="row"><label>Verein<input type="text" inputmode="email" data-addr="club:${esc(c)}" value="${esc(s.addresses["club:" + c] || "")}" placeholder="sportwart@verein.de"></label></div>
      ${clubs.get(c).sort((a, b) => a.number - b.number).map((t) => `<div class="row"><label>${esc(t.name)} (${esc(state.leaguesById.get(t.league_id)?.code)})<input type="text" inputmode="email" data-addr="team:${t.id}" value="${esc(s.addresses["team:" + t.id] || "")}" placeholder="leer = Vereinsadresse"></label></div>`).join("")}
    </details>`).join("")}
  </section>

  <section>
    <h2>Namensabgleich</h2>
    <p class="muted">Ähnliche Schreibweisen im selben Verein. Zusammenführen, wenn es dieselbe Person ist – die Prüfung läuft danach neu.</p>
    ${suggestions.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name A</th><th>Name B</th><th></th></tr></thead><tbody>
      ${suggestions.map((p) => `<tr><td>${esc(p.a.name)} <span class="muted">(${p.a.apps} Eins.)</span></td><td>${esc(p.b.name)} <span class="muted">(${p.b.apps} Eins.)</span></td>
        <td><button class="btn small" data-merge="${esc(p.b.key)}|${esc(p.a.key)}">gleiche Person</button> <button class="btn small ghost" data-distinct="${esc(p.a.key)}|${esc(p.b.key)}">verschieden</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted">Keine offenen Vorschläge.</p>`}
    <h3>Manuell zuordnen</h3>
    <div class="row"><label>Schreibweise<input type="text" id="alias-from" placeholder="z. B. Meinhart Adrian"></label><label>gehört zu<input type="text" id="alias-to" placeholder="z. B. Adrian Meinhart"></label><button class="btn" type="button" id="alias-add">Zuordnen</button></div>
    ${aliasEntries.length ? `<h3>Bestätigte Zuordnungen</h3><ul>${aliasEntries.map(([a, b]) => `<li>${esc(a)} → ${esc(b)} <button class="btn small ghost" data-unalias="${esc(a)}">entfernen</button></li>`).join("")}</ul>` : ""}
  </section>

  <section>
    <h2>Textvorlagen</h2>
    <p class="muted">Platzhalter: {mannschaft} {verein} {gegner} {begegnung} {liga} {spieltag} {datum} {saison} {regel} {grund} {sto} {strafe} {link} {frist} {absender} {spieler}</p>
    ${s.templates.map((t, i) => `<details class="addr-club"><summary>${esc(t.name)}</summary>
      <div class="row"><label>Name<input type="text" data-tpl="${i}" data-field="name" value="${esc(t.name)}"></label></div>
      <div class="row"><label>Betreff<input type="text" data-tpl="${i}" data-field="subject" value="${esc(t.subject)}"></label></div>
      <div class="row"><label>Text<textarea rows="10" data-tpl="${i}" data-field="body">${esc(t.body)}</textarea></label></div>
      <div class="row"><button class="btn small danger" type="button" data-tpl-del="${i}">Vorlage löschen</button></div>
    </details>`).join("")}
    <div class="row"><button class="btn" type="button" id="tpl-add">Neue Vorlage</button><button class="btn ghost" type="button" id="tpl-reset">Standardvorlagen wiederherstellen</button></div>
  </section>

  <section>
    <h2>Sichern und übertragen</h2>
    <p class="muted">Status, Notizen, Adressen, Namenszuordnungen und Vorlagen liegen nur auf diesem Gerät. Zum Übertragen (z. B. PC → iPhone) hier exportieren und auf dem anderen Gerät importieren.</p>
    <div class="row"><button class="btn" type="button" id="btn-export">Exportieren</button>
      <label class="btn" style="display:inline-flex;flex-direction:row;align-items:center">Importieren<input type="file" id="file-import" accept="application/json,.json" hidden></label></div>
  </section>
  </div>`;
}

// ------------------------------------------------------------------ E-Mail

let mailCase = null;

function placeholders(it, s) {
  const t = state.teamsById.get(it.teamId);
  const o = state.teamsById.get(it.opponentId);
  const frist = new Date(Date.now() + (+s.fristTage || 7) * 86400000);
  return {
    mannschaft: t?.name || it.team || "",
    verein: t?.club || "",
    gegner: o?.name || "",
    begegnung: it.match || t?.name || "",
    liga: state.leaguesById.get(it.leagueId)?.name || it.league || "",
    spieltag: it.st ?? "",
    datum: it.date ? fmtD(it.date) : "",
    saison: state.data.meta.season,
    regel: it.title,
    grund: $("#mail-reason").value,
    sto: $("#mail-penalty").selectedOptions[0]?.dataset.sto || it.sto || "",
    strafe: $("#mail-penalty-text").value,
    link: reportLink(it) || "",
    frist: frist.toLocaleDateString("de-DE"),
    absender: s.absender || "",
    spieler: it.player || "",
  };
}

function fillTemplate(str, ph) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in ph ? String(ph[k]) : m));
}

function openMail(it) {
  mailCase = it;
  const s = store.load();
  const t = state.teamsById.get(it.teamId);
  const o = state.teamsById.get(it.opponentId);
  $("#mail-case").textContent = `${it.title} · ${it.match || it.team} · ${it.league} ${it.st ? it.st + ". ST" : ""}`;
  $("#mail-to").value = store.addressesFor(t);
  const oppAddr = store.addressesFor(o);
  $("#mail-cc-opp").checked = it.penalty?.sto === "10.2.7" && !!oppAddr;
  $("#mail-cc-opp").disabled = !o;
  $("#mail-cc-addr").textContent = o ? `(${o.name}${oppAddr ? ": " + oppAddr : ", keine Adresse hinterlegt"})` : "";
  $("#mail-reason").value = it.detail;
  const pens = [["auto", it.penalty], ...Object.entries(PENALTIES).filter(([k]) => k !== (it.penalty?.sto || "none"))];
  $("#mail-penalty").innerHTML = pens.map(([k, p], i) => `<option value="${k}" data-sto="${esc(p?.sto || "")}">${i === 0 ? "Vorschlag: " : ""}${esc(p?.sto ? "STO " + p.sto : "ohne ausdrückliche Sanktion")}${p?.betrag ? " – " + p.betrag + " €" : ""}</option>`).join("") + `<option value="custom" data-sto="">Eigener Text</option>`;
  $("#mail-penalty-text").value = it.penalty?.text || "";
  const tplDefault = it.code === "R6" ? "springer" : it.severity === "verstoss" ? "verstoss" : "anhoerung";
  $("#mail-template").innerHTML = s.templates.map((tp) => `<option value="${esc(tp.id)}" ${tp.id === tplDefault ? "selected" : ""}>${esc(tp.name)}</option>`).join("");
  applyTemplate();
  $("#mail-dialog").showModal();
}

function applyTemplate() {
  const s = store.load();
  const tp = s.templates.find((x) => x.id === $("#mail-template").value) || s.templates[0];
  const ph = placeholders(mailCase, s);
  $("#mail-subject").value = fillTemplate(tp.subject, ph);
  $("#mail-body").value = fillTemplate(tp.body, ph);
  const warn = [];
  if (!$("#mail-to").value.trim()) warn.push("Keine Empfängeradresse hinterlegt (Einstellungen → E-Mail-Adressen).");
  if (!s.absender) warn.push("Kein Absender eingetragen (Einstellungen).");
  $("#mail-warn").hidden = !warn.length;
  $("#mail-warn").textContent = warn.join(" ");
}

function mailtoUrl() {
  const to = $("#mail-to").value.split(/[,;\s]+/).filter(Boolean).join(",");
  const params = [];
  if ($("#mail-cc-opp").checked) {
    const cc = store.addressesFor(state.teamsById.get(mailCase.opponentId));
    if (cc) params.push("cc=" + encodeURIComponent(cc.split(/[,;\s]+/).filter(Boolean).join(",")));
  }
  params.push("subject=" + encodeURIComponent($("#mail-subject").value));
  params.push("body=" + encodeURIComponent($("#mail-body").value.replace(/\r?\n/g, "\r\n")));
  return `mailto:${encodeURIComponent(to).replace(/%2C/g, ",").replace(/%40/g, "@")}?${params.join("&")}`;
}

// ------------------------------------------------------------------ Ereignisse

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function findCase(id) {
  return state.result.findings.find((x) => x.id === id);
}

function bindStatic() {
  $("#btn-filter").addEventListener("click", () => {
    const open = $("#filters").classList.toggle("open");
    $("#btn-filter").setAttribute("aria-expanded", String(open));
  });
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; render(); $("#view").focus({ preventScroll: true }); }));
  ["#f-st-from", "#f-st-to", "#f-league", "#f-club", "#f-status", "#f-sev-verstoss", "#f-sev-hinweis", "#f-sev-info"].forEach((s) =>
    $(s).addEventListener("change", () => {
      if (s === "#f-st-from" && +$("#f-st-to").value < +$("#f-st-from").value) $("#f-st-to").value = $("#f-st-from").value;
      if (s === "#f-st-to" && +$("#f-st-to").value < +$("#f-st-from").value) $("#f-st-from").value = $("#f-st-to").value;
      render();
    }));
  let qt;
  $("#f-search").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(render, 200); });
  $("#f-season").addEventListener("change", async (e) => { state.season = e.target.value; await loadSeason(state.season); });

  $("#btn-pdf").addEventListener("click", async () => {
    if (!state.data) return;
    const btn = $("#btn-pdf");
    btn.disabled = true;
    btn.textContent = "Erstelle PDF …";
    try {
      const f = filters();
      const findings = filteredFindings();
      const { doc, name } = await buildPdf({
        season: state.data.meta.season, stFrom: f.stFrom, stTo: f.stTo, generatedAt: state.data.meta.generated_at,
        findings, springer: state.result.springer, caseState: store.caseState, filterText: filterText(f),
        matchesChecked: state.data.matches.filter((m) => m.st >= f.stFrom && m.st <= f.stTo && state.data.reports[String(m.id)]).length,
      });
      const blob = doc.output("blob");
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: name }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }
      toast("PDF erstellt: " + name);
    } catch (e) {
      toast("PDF fehlgeschlagen: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "PDF";
    }
  });

  // Delegation in der Hauptansicht
  $("#view").addEventListener("change", (e) => {
    const el = e.target;
    const card = el.closest(".case");
    if (el.dataset.act === "status" && card) {
      store.setCase(card.dataset.id, { status: el.value });
      render();
      return;
    }
    if (el.dataset.addr) {
      store.update((s) => { const v = el.value.trim(); if (v) s.addresses[el.dataset.addr] = v; else delete s.addresses[el.dataset.addr]; });
      toast("Adresse gespeichert");
      return;
    }
    if (el.dataset.tpl != null) {
      store.update((s) => { s.templates[+el.dataset.tpl][el.dataset.field] = el.value; });
      toast("Vorlage gespeichert");
      return;
    }
    if (el.id === "set-absender") { store.update((s) => { s.absender = el.value; }); toast("Gespeichert"); }
    if (el.id === "set-frist") { store.update((s) => { s.fristTage = parseInt(el.value, 10) || 7; }); toast("Gespeichert"); }
    if (el.id === "set-sportwarte") {
      store.update((s) => { s.sportwarte = el.value.split(",").map((x) => x.trim()).filter(Boolean); });
      runAnalysis();
      toast("Gespeichert – Prüfung aktualisiert");
    }
    if (el.id === "file-import" && el.files[0]) {
      el.files[0].text().then((txt) => {
        try { store.importJson(txt); runAnalysis(); render(); toast("Import abgeschlossen"); } catch (err) { toast("Import fehlgeschlagen: " + err.message); }
      });
    }
  });

  $("#view").addEventListener("click", (e) => {
    const el = e.target.closest("button, [data-merge], [data-distinct], [data-unalias]");
    if (!el) return;
    const card = el.closest(".case");
    if (el.dataset.act === "mail" && card) return openMail(findCase(card.dataset.id));
    if (el.dataset.act === "note" && card) {
      const cs = store.caseState(card.dataset.id);
      const note = prompt("Notiz zum Fall:", cs.note || "");
      if (note !== null) { store.setCase(card.dataset.id, { note }); render(); }
      return;
    }
    if (el.dataset.merge) {
      const [from, to] = el.dataset.merge.split("|");
      store.update((s) => { s.aliases[from] = to; });
      runAnalysis(); render(); toast("Zusammengeführt – Prüfung aktualisiert");
      return;
    }
    if (el.dataset.distinct) {
      store.update((s) => { s.distinct.push(el.dataset.distinct.split("|")); });
      render();
      return;
    }
    if (el.dataset.unalias) {
      store.update((s) => { delete s.aliases[el.dataset.unalias]; });
      runAnalysis(); render();
      return;
    }
    if (el.id === "alias-add") {
      const a = nameKey($("#alias-from").value), b = nameKey($("#alias-to").value);
      if (!a || !b || a === b) return toast("Bitte zwei unterschiedliche Namen eingeben");
      store.update((s) => { s.aliases[a] = b; });
      runAnalysis(); render(); toast("Zuordnung gespeichert");
      return;
    }
    if (el.dataset.tplDel != null) {
      if (!confirm("Vorlage löschen?")) return;
      store.update((s) => { s.templates.splice(+el.dataset.tplDel, 1); });
      render();
      return;
    }
    if (el.id === "tpl-add") {
      store.update((s) => { s.templates.push({ id: "t" + Date.now(), name: "Neue Vorlage", subject: "PBVRW {saison}: {regel} – {begegnung}", body: "Hallo {mannschaft},\n\n{grund}\n\nFolge: {strafe}\n\n{absender}" }); });
      render();
      return;
    }
    if (el.id === "tpl-reset") {
      store.update((s) => { s.templates = structuredClone(store.DEFAULT_TEMPLATES); });
      render();
      toast("Standardvorlagen wiederhergestellt");
      return;
    }
    if (el.id === "btn-export") {
      const blob = new Blob([store.exportJson()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `spielbericht-pruefung-einstellungen-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return;
    }
    if (el.id === "btn-reload") { loadSeason(state.season); }
  });

  // Mail-Dialog
  ["#mail-template", "#mail-cc-opp"].forEach((s) => $(s).addEventListener("change", applyTemplate));
  $("#mail-to").addEventListener("change", applyTemplate);
  $("#mail-reason").addEventListener("change", applyTemplate);
  $("#mail-penalty-text").addEventListener("change", applyTemplate);
  $("#mail-penalty").addEventListener("change", () => {
    const k = $("#mail-penalty").value;
    if (k === "auto") $("#mail-penalty-text").value = mailCase.penalty?.text || "";
    else if (k === "custom") $("#mail-penalty-text").value = "";
    else $("#mail-penalty-text").value = PENALTIES[k]?.text || "";
    applyTemplate();
  });
  $("#mail-open").addEventListener("click", () => {
    const url = mailtoUrl();
    if (url.length > 1900) toast("Hinweis: sehr langer Text – falls das Mailprogramm ihn kürzt, „Text kopieren“ nutzen.");
    store.setCase(mailCase.id, { mailedAt: new Date().toISOString() });
    window.location.href = url;
    setTimeout(render, 500);
  });
  $("#mail-copy").addEventListener("click", async () => {
    const txt = `An: ${$("#mail-to").value}\nBetreff: ${$("#mail-subject").value}\n\n${$("#mail-body").value}`;
    try { await navigator.clipboard.writeText(txt); toast("Text kopiert"); } catch { toast("Kopieren nicht möglich"); }
  });
}

init();
