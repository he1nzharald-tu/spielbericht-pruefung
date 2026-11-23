// PDF-Bericht mit jsPDF + AutoTable (lokal in /vendor, sonst vom CDN nachgeladen).

import { fmtD, fmtDT } from "./rules.js";

const CDN = [
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
];

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("Konnte " + src + " nicht laden"));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return window.jspdf.jsPDF;
  if (!window.jspdf?.jsPDF) await loadScript(CDN[0]);
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript(CDN[1]);
  return window.jspdf.jsPDF;
}

const SEV = { verstoss: "Verstoß", hinweis: "Hinweis", info: "Info" };
const STATUS = { offen: "offen", erledigt: "erledigt", kein: "kein Verstoß" };

/**
 * opts: { season, stFrom, stTo, generatedAt, findings (gefiltert), springer, caseState(id), leagueName(id), filterText }
 */
export async function buildPdf(opts) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const brand = [31, 95, 74];
  const red = [179, 38, 30], amber = [138, 90, 0];

  // ---------- Deckblatt
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Prüfbericht Spielbetrieb PBVRW", 14, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const rangeTxt = opts.stFrom === opts.stTo ? `${opts.stFrom}. Spieltag` : `Spieltage ${opts.stFrom}–${opts.stTo}`;
  doc.text(`Saison ${opts.season} · ${rangeTxt}`, 14, 30);
  doc.setTextColor(100);
  doc.text(`Datenstand: ${fmtDT(opts.generatedAt?.replace("Z", ""))} (UTC) · erstellt: ${new Date().toLocaleString("de-DE")}`, 14, 36);
  if (opts.filterText) doc.text(`Filter: ${opts.filterText}`, 14, 42);
  doc.setTextColor(0);

  const f = opts.findings;
  const count = (sev) => f.filter((x) => x.severity === sev).length;
  const open = f.filter((x) => opts.caseState(x.id).status === "offen" && x.severity !== "info").length;
  const tiles = [
    ["Verstöße", count("verstoss"), red],
    ["Hinweise", count("hinweis"), amber],
    ["Info", count("info"), [40, 95, 143]],
    ["Offen", open, [60, 60, 60]],
    ["Begegnungen geprüft", opts.matchesChecked, brand],
    ["Springer-Einsätze", opts.springer.reduce((n, s) => n + s.uses.filter((u) => u.st >= opts.stFrom && u.st <= opts.stTo).length, 0), brand],
  ];
  let x = 14;
  const tw = (W - 28 - 5 * 4) / 6;
  for (const [label, n, col] of tiles) {
    doc.setDrawColor(220);
    doc.roundedRect(x, 50, tw, 22, 2, 2);
    doc.setFontSize(18);
    doc.setTextColor(...col);
    doc.setFont("helvetica", "bold");
    doc.text(String(n), x + 4, 61);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(label, x + 4, 68);
    x += tw + 4;
  }
  doc.setTextColor(0);

  // Verstöße/Hinweise je Liga und je Verein
  const byLeague = groupCount(f.filter((x) => x.severity !== "info"), (x) => x.league || "–");
  const byClub = groupCount(f.filter((x) => x.severity !== "info"), (x) => clubOf(x.team) || "–");
  doc.autoTable({
    startY: 80, margin: { left: 14, right: W / 2 + 4 }, theme: "grid",
    head: [["Liga", "Verstöße", "Hinweise"]],
    body: byLeague.map(([k, v]) => [k, v.verstoss || 0, v.hinweis || 0]),
    headStyles: { fillColor: brand }, styles: { fontSize: 9 },
  });
  doc.autoTable({
    startY: 80, margin: { left: W / 2 + 4, right: 14 }, theme: "grid",
    head: [["Verein", "Verstöße", "Hinweise"]],
    body: byClub.slice(0, 25).map(([k, v]) => [k, v.verstoss || 0, v.hinweis || 0]),
    headStyles: { fillColor: brand }, styles: { fontSize: 9 },
  });

  // ---------- Je Spieltag
  const sts = [...new Set(f.map((x) => x.st ?? 0))].sort((a, b) => a - b);
  for (const st of sts) {
    const items = f.filter((x) => (x.st ?? 0) === st);
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(st ? `${st}. Spieltag` : "Ohne Spieltag (Kader, Saison)", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.autoTable({
      startY: 21, theme: "striped",
      head: [["Art", "Liga", "Datum", "Begegnung / Mannschaft", "Regel", "Details", "STO / Folge", "Status"]],
      body: items.map((it) => {
        const cs = opts.caseState(it.id);
        return [
          SEV[it.severity],
          it.league,
          it.date ? fmtD(it.date) : "",
          (it.match || it.team) + (it.player ? `\nSpieler: ${it.player}` : ""),
          it.title,
          it.detail + (cs.note ? `\nNotiz: ${cs.note}` : ""),
          (it.sto || "") + (it.penalty?.betrag ? `\n${it.penalty.betrag.toFixed(2).replace(".", ",")} €` : ""),
          STATUS[cs.status] + (cs.mailedAt ? `\nMail ${fmtD(cs.mailedAt.slice(0, 10))}` : ""),
        ];
      }),
      headStyles: { fillColor: brand, fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak", valign: "top" },
      columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 13 }, 2: { cellWidth: 18 }, 3: { cellWidth: 45 }, 4: { cellWidth: 38 }, 5: { cellWidth: "auto" }, 6: { cellWidth: 30 }, 7: { cellWidth: 20 } },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 0) {
          const sev = items[d.row.index].severity;
          d.cell.styles.textColor = sev === "verstoss" ? red : sev === "hinweis" ? amber : [40, 95, 143];
          d.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: 14, right: 14 },
    });
  }

  // ---------- Springer-Übersicht
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Springer-Übersicht (ganze Saison)", 14, 16);
  doc.setFont("helvetica", "normal");
  doc.autoTable({
    startY: 21, theme: "striped",
    head: [["Spieler", "Verein", "Stammmannschaft", "Springer-Mannschaft", "Einsätze", "Status"]],
    body: opts.springer.map((s) => [
      s.name, s.club, `${s.stamm} (${s.stammSource})`, s.springerTeam,
      s.uses.map((u) => `${u.n}. ST ${u.st} (${fmtD(u.date)})`).join("\n"),
      s.festgespielt ? `festgespielt seit ${fmtD(s.festAt)} – Stamm jetzt ${s.currentStamm}` : `${s.uses.length} von 2 Springer-Einsätzen`,
    ]),
    headStyles: { fillColor: brand, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.6, valign: "top" },
    margin: { left: 14, right: 14 },
  });

  // Seitenzahlen
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Spielbericht-Prüfung PBVRW · ${opts.season} · Seite ${i}/${pages}`, 14, doc.internal.pageSize.getHeight() - 6);
  }

  const name = `Pruefbericht_${opts.season.replace("/", "-")}_ST${opts.stFrom}${opts.stTo !== opts.stFrom ? "-" + opts.stTo : ""}.pdf`;
  return { doc, name };
}

function groupCount(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, {});
    const o = m.get(k);
    o[x.severity] = (o[x.severity] || 0) + 1;
  }
  return [...m.entries()].sort((a, b) => (b[1].verstoss || 0) - (a[1].verstoss || 0) || a[0].localeCompare(b[0]));
}

function clubOf(teamName) {
  return String(teamName || "").replace(/\s+\d{1,2}$/, "");
}
