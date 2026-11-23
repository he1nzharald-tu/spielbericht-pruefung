"""HTML-Parser für billard-blmr.de.

Die Seiten haben keine stabile, dokumentierte Struktur. Die Parser arbeiten deshalb
mit Mustern (Links, Datums-/Ergebnisformate, Beschriftungen) statt mit festen CSS-Pfaden.
Jeder Parser gibt zusätzlich eine Liste `warnings` zurück, die im Lauf-Protokoll landet.
"""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlparse, parse_qs

from bs4 import BeautifulSoup, Tag

DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")
TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})\b")
SCORE_RE = re.compile(r"^\s*(\d{1,3})\s*:\s*(\d{1,3})\s*$")
DISC_RE = re.compile(r"^(14/1e?|14\.1(?:\s*endlos)?|14/1\s*endlos|8[\s-]?Ball|9[\s-]?Ball|10[\s-]?Ball)$", re.I)
STATUS_RE = re.compile(r"\((Kapitän|Stammspieler|Ersatzspieler|Ersatz|Spieler|Mannschaftsführer|Springer)[^)]*\)", re.I)
CAPTURED_RE = re.compile(r"erfasst von\s+(.+?)\s*\((\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{1,2}:\d{2})", re.I)


def soup_of(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def clean(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def norm_discipline(s: str) -> str:
    s = clean(s).lower().replace(" ", "")
    if s.startswith("14"):
        return "14/1"
    for d in ("10", "9", "8"):
        if s.startswith(d):
            return f"{d}-Ball"
    return clean(s)


def iso_date(text: str) -> str | None:
    m = DATE_RE.search(text or "")
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d}"


def p_param_ids(href: str) -> list[int]:
    """Zerlegt p=13--2026/2027-571-0-5420 in die Zahlen am Ende: [571, 0, 5420]."""
    q = parse_qs(urlparse(href).query)
    p = (q.get("p") or [""])[0]
    m = re.search(r"\d{4}/\d{4}-(.*)$", p)
    if not m:
        return []
    return [int(x) for x in m.group(1).split("-") if x.isdigit()]


def team_id_from_href(href: str) -> int | None:
    if "mannschaftsplan" not in href and "sb_mannschaft" not in href:
        return None
    q = parse_qs(urlparse(href).query)
    if "t" in q and q["t"][0].isdigit():
        return int(q["t"][0])
    ids = p_param_ids(href)
    if len(ids) >= 3:
        return ids[-1]
    return None


def league_id_from_href(href: str) -> int | None:
    q = parse_qs(urlparse(href).query)
    if "l" in q and q["l"][0].isdigit():
        return int(q["l"][0])
    ids = p_param_ids(href)
    return ids[0] if ids else None


def link_label(a: Tag) -> str:
    txt = clean(a.get_text(" "))
    if txt:
        return txt
    if a.get("title"):
        return clean(a["title"])
    img = a.find("img")
    if img is not None:
        return clean(img.get("alt") or img.get("title") or "")
    return ""


def split_team_name(name: str) -> tuple[str, int]:
    """'BC Alsdorf 4' -> ('BC Alsdorf', 4); ohne Nummer -> (name, 1)."""
    name = clean(name)
    m = re.match(r"^(.*?)\s+(\d{1,2})$", name)
    if m:
        return m.group(1).strip(), int(m.group(2))
    return name, 1


# --------------------------------------------------------------------------- Spielplan

def parse_spielplan(html: str, league_id: int) -> dict:
    soup = soup_of(html)
    warnings: list[str] = []

    # Mannschaften: alle Links auf Mannschaftsseiten dieser Liga
    teams: dict[int, dict] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        tid = team_id_from_href(href)
        if tid is None:
            continue
        lid = league_id_from_href(href)
        if lid is not None and lid != league_id:
            continue
        label = link_label(a)
        t = teams.setdefault(tid, {"id": tid, "name": "", "withdrawn": False})
        if len(label) > len(t["name"]) and not DATE_RE.search(label):
            t["name"] = label
        row = a.find_parent("tr")
        if row is not None:
            rt = clean(row.get_text(" ")).lower()
            if "abgemeldet" in rt or "zurückgezogen" in rt or "disqualifiziert" in rt:
                t["withdrawn"] = True

    # Begegnungen: Links auf Spielberichte
    matches: dict[int, dict] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "sb_spielbericht" not in href:
            continue
        ids = p_param_ids(href)
        if len(ids) < 3 or ids[0] != league_id:
            continue
        mid = ids[-1]
        row = a.find_parent("tr")
        if row is None:
            continue
        cells = [clean(td.get_text(" ")) for td in row.find_all(["td", "th"], recursive=False)]
        if not cells:
            cells = [clean(td.get_text(" ")) for td in row.find_all(["td", "th"])]
        row_text = " ".join(cells)
        st = None
        for c in cells[:2]:
            if c.isdigit():
                st = int(c)
                break
        date = iso_date(row_text)
        tm = None
        for c in cells:
            if DATE_RE.search(c):
                tmm = TIME_RE.search(DATE_RE.sub("", c))
                if tmm:
                    tm = f"{int(tmm.group(1)):02d}:{tmm.group(2)}"
        result = None
        for c in cells:
            if DATE_RE.search(c):
                continue
            m = SCORE_RE.match(c)
            if m:
                result = [int(m.group(1)), int(m.group(2))]
                break
        team_ids = []
        for ta in row.find_all("a", href=True):
            tid = team_id_from_href(ta["href"])
            if tid is not None and tid not in team_ids:
                team_ids.append(tid)
        # Mannschaftsnamen stehen als Text in Zellen mit width=35% bzw. im Wappen-Titel
        names = [clean(td.get_text(" ")) for td in row.find_all("td") if str(td.get("width", "")).strip() == "35%"]
        if len(names) < 2:
            names = [re.sub(r"^Wappen\s+", "", clean(img.get("title") or "")) for img in row.find_all("img")
                     if clean(img.get("title") or "").startswith("Wappen")]
        memo = []
        for img in row.find_all("img"):
            t = clean(img.get("title") or img.get("alt") or "")
            if t.lower().startswith("memo"):
                memo.append(re.sub(r"^memo:?\s*", "", t, flags=re.I))
        for el in row.find_all(attrs={"title": True}):
            t = clean(el.get("title"))
            if t.lower().startswith("memo") and re.sub(r"^memo:?\s*", "", t, flags=re.I) not in memo:
                memo.append(re.sub(r"^memo:?\s*", "", t, flags=re.I))

        cand = {
            "id": mid,
            "league_id": league_id,
            "st": st,
            "date": date,
            "time": tm,
            "home_id": team_ids[0] if len(team_ids) > 0 else None,
            "away_id": team_ids[1] if len(team_ids) > 1 else None,
            "home_name": names[0] if len(names) > 0 else "",
            "away_name": names[1] if len(names) > 1 else "",
            "result": result,
            "memo": memo,
            "url": href,
        }
        old = matches.get(mid)
        # Zeilen mit Spieltagnummer (eigentlicher Spielplan) haben Vorrang vor "Aktuelle Ergebnisse"
        score_old = (old or {}).get("st") is not None, (old or {}).get("home_id") is not None
        score_new = cand["st"] is not None, cand["home_id"] is not None
        if old is None or score_new > score_old:
            if old and not cand["memo"]:
                cand["memo"] = old["memo"]
            matches[mid] = cand
        elif cand["memo"] and not old["memo"]:
            old["memo"] = cand["memo"]

    # Namen -> Mannschafts-IDs
    by_name = {clean(t["name"]).lower(): tid for tid, t in teams.items() if t["name"]}
    unknown = set()
    for m in matches.values():
        for side in ("home", "away"):
            if m[f"{side}_id"] is None and m[f"{side}_name"]:
                tid = by_name.get(m[f"{side}_name"].lower())
                if tid is None:
                    unknown.add(m[f"{side}_name"])
                m[f"{side}_id"] = tid
    if unknown:
        warnings.append(f"Liga {league_id}: Mannschaften ohne ID: {', '.join(sorted(unknown))}")

    if not teams:
        warnings.append(f"Liga {league_id}: keine Mannschaften gefunden")
    if not matches:
        warnings.append(f"Liga {league_id}: keine Begegnungen gefunden")
    missing_st = [m for m in matches.values() if m["st"] is None]
    if missing_st:
        warnings.append(f"Liga {league_id}: {len(missing_st)} Begegnungen ohne Spieltagnummer")

    for t in teams.values():
        club, num = split_team_name(t["name"])
        t["club"], t["number"] = club, num
        t["league_id"] = league_id

    return {"teams": list(teams.values()), "matches": sorted(matches.values(), key=lambda m: (m["st"] or 0, m["date"] or "", m["id"])), "warnings": warnings}


# --------------------------------------------------------------------------- Kader

def parse_kader(html: str) -> dict:
    soup = soup_of(html)
    warnings: list[str] = []
    players: dict[str, dict] = {}

    def add(name: str, status: str = ""):
        name = clean(STATUS_RE.sub("", name))
        name = re.sub(r"^Name:?\s*", "", name, flags=re.I).strip(" :-")
        if not name or len(name) < 3 or len(name) > 60 or any(ch.isdigit() for ch in name):
            return
        if name.lower() in {"name", "spitzname", "nationalität", "beruf", "spiel queue", "status"}:
            return
        p = players.setdefault(name, {"name": name, "status": ""})
        if status and not p["status"]:
            p["status"] = status

    # Strategie 1: Texte mit Statusklammer, z. B. "Carsten Lehmann (Kapitän)"
    for s in soup.find_all(string=STATUS_RE):
        txt = clean(s)
        m = STATUS_RE.search(txt)
        before = clean(txt[: m.start()])
        if not before:
            prev = s.find_previous(string=lambda x: clean(x) != "")
            before = clean(prev) if prev else ""
        add(before, m.group(1))

    # Strategie 2: Beschriftung "Name" gefolgt vom Wert
    for el in soup.find_all(string=re.compile(r"^\s*Name\s*:?\s*$")):
        nxt = el.find_next(string=lambda x: clean(x) != "" and not re.match(r"^\s*:?\s*$", x))
        if nxt:
            txt = clean(nxt)
            m = STATUS_RE.search(txt)
            add(txt, m.group(1) if m else "")

    if not players:
        warnings.append("Kader: keine Spieler erkannt")
    return {"players": list(players.values()), "warnings": warnings}


# --------------------------------------------------------------------------- Spielbericht

def _row_cells(tr: Tag) -> list[str]:
    tds = tr.find_all(["td", "th"], recursive=False) or tr.find_all(["td", "th"])
    out = []
    for td in tds:
        sel = td.find("select")
        if sel is not None:
            opt = sel.find("option", selected=True)
            out.append(clean(opt.get_text(" ")) if opt else "")
        else:
            out.append(clean(td.get_text(" ")))
    return out


def parse_spielbericht(html: str) -> dict:
    soup = soup_of(html)
    warnings: list[str] = []
    full_text = clean(soup.get_text(" "))

    games: list[dict] = []
    current_round = 1
    last_141 = None
    for tr in soup.find_all("tr"):
        if tr.find("tr") is not None:
            continue  # nur innerste Zeilen
        cells = _row_cells(tr)
        joined = " ".join(cells)
        rm = re.search(r"\b(?:Runde|Durchgang)\s*(\d)\b", joined, re.I)
        if rm:
            current_round = int(rm.group(1))
        di = next((i for i, c in enumerate(cells) if DISC_RE.match(c)), None)
        if di is None:
            pm = re.search(r"Punkte:?\s*(\d+)\s*[:/]\s*(\d+)", joined)
            if pm and last_141 is not None and last_141.get("points") is None:
                last_141["points"] = [int(pm.group(1)), int(pm.group(2))]
            continue
        nr = None
        for c in cells[:di][::-1]:
            if c.isdigit():
                nr = int(c)
                break
        rest = cells[di + 1:]
        si = next((i for i, c in enumerate(rest) if SCORE_RE.match(c)), None)
        if si is None:
            # Partie ohne Ergebnis (z. B. entfallen)
            home = rest[0] if rest else ""
            away = rest[1] if len(rest) > 1 else ""
            score = None
        else:
            home = " ".join(c for c in rest[:si] if c and c != ":")
            m = SCORE_RE.match(rest[si])
            score = [int(m.group(1)), int(m.group(2))]
            after = rest[si + 1:]
            away = ""
            for c in after:
                if SCORE_RE.match(c):
                    break
                if c and c != ":":
                    away = c
                    break
        g = {
            "round": current_round,
            "nr": nr,
            "discipline": norm_discipline(cells[di]),
            "home": clean(home),
            "away": clean(away),
            "score": score,
        }
        pm = re.search(r"Punkte:?\s*(\d+)\s*[:/]\s*(\d+)", joined)
        g["points"] = [int(pm.group(1)), int(pm.group(2))] if pm else None
        if g["discipline"] == "14/1":
            last_141 = g
        games.append(g)

    # Runden notfalls aus der Partienummer ableiten
    if games and all(g["round"] == 1 for g in games) and any((g["nr"] or 0) > 4 for g in games):
        half = max(g["nr"] or 0 for g in games) // 2 if len(games) % 2 == 0 else 4
        for g in games:
            if g["nr"]:
                g["round"] = 1 if g["nr"] <= half else 2

    endstand = None
    m = re.search(r"Endstand:?\s*(\d+)\s*:\s*(\d+)", full_text)
    if m:
        endstand = [int(m.group(1)), int(m.group(2))]

    description = ""
    for el in soup.find_all(string=re.compile(r"^\s*(Beschreibung|Bemerkung)\s*:?\s*$", re.I)):
        cell = el.find_parent(["td", "th", "div", "dt", "label", "b", "strong", "span"])
        nxt = None
        if cell is not None:
            sib = cell.find_next_sibling()
            if sib is not None:
                nxt = clean(sib.get_text(" "))
        if not nxt:
            n2 = el.find_next(string=lambda x: clean(x) != "")
            nxt = clean(n2) if n2 else ""
        if nxt and not re.match(r"^(Protest|Spielbericht erfasst)", nxt, re.I):
            description = nxt
            break
    if not description:
        dm = re.search(r"Beschreibung:?\s*(.*?)\s*(?:Protest|Spielbericht erfasst|$)", full_text, re.I)
        if dm:
            description = clean(dm.group(1))

    captured_by = captured_at = None
    cm = CAPTURED_RE.search(full_text)
    if cm:
        captured_by = clean(cm.group(1))
        d = datetime.strptime(cm.group(2) + " " + cm.group(3), "%d.%m.%Y %H:%M")
        captured_at = d.strftime("%Y-%m-%dT%H:%M")

    zu_null = bool(re.search(r"zu\s*Null", full_text, re.I)) and not games

    team_ids = []
    for a in soup.find_all("a", href=True):
        tid = team_id_from_href(a["href"])
        if tid is not None and tid not in team_ids:
            team_ids.append(tid)

    if not games and not zu_null:
        warnings.append("Spielbericht: keine Partien erkannt")
    if captured_at is None:
        warnings.append("Spielbericht: Erfassungszeitpunkt nicht gefunden")

    return {
        "games": games,
        "endstand": endstand,
        "description": description,
        "captured_by": captured_by,
        "captured_at": captured_at,
        "zu_null": zu_null,
        "team_ids": team_ids[:2],
        "warnings": warnings,
    }
