"""Automatische Erkennung von Saison, Ligen (inkl. Relegationen) und Abmeldungen."""
from __future__ import annotations

import re
from datetime import date

from bs4 import BeautifulSoup

from parsers import clean, split_team_name

LEVEL_WORDS = [("verbandsliga", 1), ("landesliga", 2), ("bezirksliga", 3), ("kreisliga", 4), ("kreisklasse", 5)]


def current_season(today: date | None = None) -> str:
    """Spielzeit 1.8.–31.7. (STO 2.5.1)."""
    d = today or date.today()
    y = d.year if d.month >= 8 else d.year - 1
    return f"{y}/{y + 1}"


def classify(name: str) -> tuple[str, int]:
    n = name.lower()
    level = next((lv for w, lv in LEVEL_WORDS if w in n), 9)
    if "relegation" in n:
        return "relegation", level
    if "senioren" in n:
        return "senioren", 1 if "landesliga" in n else 2
    if "pokal" in n:
        return "pokal", 1
    return "kombi", level


def parse_leagues(html: str, verband: str = "PBVRW") -> list[dict]:
    """Ligen eines Verbands aus sb_spielbetrieb.php (Linktitel 'Pool - PBVRW - Landesliga')."""
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.search(r"sb_spielplan\.php\?p=\d+-\d*-(\d{4}/\d{4})-(\d+)", href)
        if not m:
            continue
        title = clean(a.get("title") or "")
        parts = [clean(p) for p in title.split(" - ")]
        if len(parts) < 3 or parts[1].upper() != verband.upper():
            continue
        lid = int(m.group(2))
        if lid in seen:
            continue
        seen.add(lid)
        name = clean(a.get_text(" ")) or parts[-1]
        tds = [clean(td.get_text(" ")) for td in a.find_parent("tr").find_all("td")] if a.find_parent("tr") else []
        code = tds[1] if len(tds) > 1 and tds[1] else name
        comp, level = classify(name)
        out.append({"id": lid, "code": code, "name": name, "competition": comp, "level": level})
    return out


WITHDRAW_RE = re.compile(r"(abgemeldet|zurückgezogen|zurueckgezogen|disqualifiziert)", re.I)


def parse_withdrawals(html: str, verband: str = "PBVRW") -> list[dict]:
    """Meldungen 'TT.MM.JJJJ: PBVRW <Liga>' mit Abmeldung/Rückzug/Disqualifikation."""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for h3 in soup.find_all(["h3", "h2", "h4"]):
        head = clean(h3.get_text(" "))
        m = re.match(rf"(\d{{2}})\.(\d{{2}})\.(\d{{4}})\s*:\s*{verband}\s+(.+)$", head, re.I)
        if not m:
            continue
        sec = h3.find_parent("section") or h3.parent
        text = clean(sec.get_text(" ")).replace(head, "", 1).strip()
        wm = WITHDRAW_RE.search(text)
        if not wm:
            continue
        d, mo, y, league_name = m.groups()
        cm = re.search(r"\b(?:der|die|das)\s+(.+?)\s+(?:hat|haben)\s+(?:seine|ihre)\s+(?:(\d+)\.\s*)?Mannschaft", text, re.I)
        out.append({
            "date": f"{y}-{mo}-{d}",
            "league_name": clean(league_name),
            "club": clean(cm.group(1)) if cm else "",
            "team_number": int(cm.group(2)) if cm and cm.group(2) else None,
            "kind": wm.group(1).lower().replace("ue", "ü"),
            "text": text[:400],
        })
    return out


def _tokens(s: str) -> set[str]:
    s = s.lower().replace("ß", "ss")
    s = re.sub(r"[^a-z0-9äöü]+", " ", s)
    stop = {"e", "v", "ev", "der", "die", "das", "1", "2", "3", "4", "5", "6", "7", "8", "9"}
    return {t for t in s.split() if t not in stop and len(t) > 1}


def match_withdrawal(w: dict, leagues: list[dict], teams: list[dict]) -> tuple[int | None, int | None]:
    """Liefert (league_id, team_id) für eine Abmeldung."""
    ln = w["league_name"].lower()
    lg = next((l for l in leagues if l["name"].lower() == ln), None) or \
        next((l for l in leagues if l["name"].lower() in ln or ln in l["name"].lower()), None)
    if not lg:
        return None, None
    ct = _tokens(w["club"])
    best, score = None, 0.0
    for t in teams:
        if t["league_id"] != lg["id"]:
            continue
        club, num = split_team_name(t["name"])
        tt = _tokens(club)
        if not tt or not ct:
            continue
        s = len(ct & tt) / len(ct | tt)
        if w.get("team_number") and num == w["team_number"]:
            s += 0.2
        if s > score:
            best, score = t, s
    if best and score >= 0.5:
        return lg["id"], best["id"]
    return lg["id"], None
