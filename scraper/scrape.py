"""Lädt Spielpläne, Kader und Spielberichte des PBVRW von billard-blmr.de.

Aufruf:
    python scraper/scrape.py                  # normaler Lauf (inkrementell)
    python scraper/scrape.py --full           # alle Spielberichte und Kader neu laden
    python scraper/scrape.py --season 2026/2027 --samples

Erkennung nachträglicher Änderungen:
  * Spielpläne werden bei jedem Lauf vollständig neu geladen.
  * Spielberichte werden neu geladen, wenn sie neu sind, wenn sich das Ergebnis im
    Spielplan geändert hat, wenn das Spiel höchstens RECENT_DAYS Tage zurückliegt
    oder bei --full. Zusätzlich wird bei jedem Lauf ein rotierender Anteil älterer
    Berichte neu geladen, sodass jeder Bericht spätestens alle ROTATE_DAYS Tage
    geprüft wird.
  * Jeder Bericht bekommt einen Fingerabdruck (SHA-256 über den Inhalt). Weicht er
    ab, wird ein Eintrag mit Vorher/Nachher in changes.json geschrieben.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from parsers import parse_spielplan, parse_kader, parse_spielbericht  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "config" / "leagues.json").read_text(encoding="utf-8"))
BASE = CONFIG["base_url"]
VID = CONFIG["verband_id"]
RECENT_DAYS = 42
ROTATE_DAYS = 7
KADER_MAX_AGE_H = 20
DELAY = float(os.environ.get("SCRAPE_DELAY", "1.0"))
UA = "spielbericht-pruefung/1.0 (+https://github.com/he1nzharald-tu/spielbericht-pruefung)"

now = datetime.now(timezone.utc)
now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")


def slug(season: str) -> str:
    return season.replace("/", "-")


class Fetcher:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.count = 0
        self.errors: list[str] = []

    def get(self, path: str) -> str | None:
        url = BASE + path
        for attempt in range(3):
            try:
                if self.count:
                    time.sleep(DELAY)
                self.count += 1
                r = self.s.get(url, timeout=30)
                r.raise_for_status()
                if not r.encoding or r.encoding.lower() == "iso-8859-1":
                    # Seite deklariert oft kein/ein falsches Charset
                    enc = r.apparent_encoding or "utf-8"
                    r.encoding = enc
                return r.text
            except requests.RequestException as e:
                if attempt == 2:
                    self.errors.append(f"{url}: {e}")
                    return None
                time.sleep(3 * (attempt + 1))
        return None


def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False), encoding="utf-8")
    tmp.replace(path)


def report_fingerprint(r: dict) -> str:
    core = {k: r.get(k) for k in ("games", "endstand", "description", "captured_by", "captured_at", "zu_null")}
    return hashlib.sha256(json.dumps(core, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


def diff_reports(old: dict, new: dict) -> list[dict]:
    out = []
    for k in ("endstand", "description", "captured_by", "captured_at", "zu_null"):
        if old.get(k) != new.get(k):
            out.append({"field": k, "before": old.get(k), "after": new.get(k)})
    og, ng = old.get("games") or [], new.get("games") or []
    for i in range(max(len(og), len(ng))):
        a = og[i] if i < len(og) else None
        b = ng[i] if i < len(ng) else None
        if a != b:
            label = f"Partie {(b or a or {}).get('nr') or i + 1}"
            out.append({"field": label, "before": a, "after": b})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default=None)
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--samples", action="store_true", help="Roh-HTML je Seitentyp unter debug/samples ablegen")
    ap.add_argument("--leagues", default="", help="Nur diese Liga-IDs (kommagetrennt)")
    args = ap.parse_args()

    season = args.season or sorted(CONFIG["seasons"].keys())[-1]
    scfg = CONFIG["seasons"][season]
    out = ROOT / "docs" / "data" / slug(season)
    samples = ROOT / "debug" / "samples"
    only = {int(x) for x in args.leagues.split(",") if x.strip()}

    teams_old = {t["id"]: t for t in load(out / "teams.json", [])}
    matches_old = {m["id"]: m for m in load(out / "matches.json", [])}
    reports = {int(k): v for k, v in load(out / "reports.json", {}).items()}
    changes = load(out / "changes.json", [])
    kader_hist = load(out / "kader_history.json", [])
    meta_old = load(out / "meta.json", {})

    f = Fetcher()
    warnings: list[str] = []
    teams: dict[int, dict] = {}
    matches: dict[int, dict] = {}

    leagues = [lg for lg in scfg["leagues"] if not only or lg["id"] in only]

    # 1) Spielpläne
    for i, lg in enumerate(leagues):
        path = f"sb_spielplan.php?p={VID}--{season}-{lg['id']}"
        html = f.get(path)
        if html is None:
            warnings.append(f"Spielplan {lg['code']} nicht geladen – alte Daten bleiben erhalten")
            for t in teams_old.values():
                if t["league_id"] == lg["id"]:
                    teams[t["id"]] = t
            for m in matches_old.values():
                if m["league_id"] == lg["id"]:
                    matches[m["id"]] = m
            continue
        if args.samples:
            save_sample(samples / f"spielplan-{lg['id']}.html", html)
        parsed = parse_spielplan(html, lg["id"])
        warnings += parsed["warnings"]
        for t in parsed["teams"]:
            old = teams_old.get(t["id"], {})
            t["kader"] = old.get("kader", [])
            t["kader_fetched_at"] = old.get("kader_fetched_at")
            teams[t["id"]] = t
        for m in parsed["matches"]:
            matches[m["id"]] = m

    # Mannschaften, die nicht mehr verlinkt sind, aber noch in Begegnungen vorkommen, behalten
    for m in matches.values():
        for side in ("home_id", "away_id"):
            tid = m.get(side)
            if tid and tid not in teams and tid in teams_old:
                teams[tid] = teams_old[tid]

    # 2) Kader
    kader_sampled: set[int] = set()
    for t in teams.values():
        if t["id"] < 0:
            continue  # Mannschaft ohne eigene Seite
        age_ok = False
        if t.get("kader_fetched_at") and not args.full:
            fetched = datetime.strptime(t["kader_fetched_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            age_ok = now - fetched < timedelta(hours=KADER_MAX_AGE_H)
        if age_ok:
            continue
        html = f.get(f"sb_mannschaft.php?p={VID}--{season}-{t['league_id']}-0-{t['id']}")
        if html is None:
            continue
        if args.samples and t["league_id"] not in kader_sampled:
            save_sample(samples / f"kader-{t['league_id']}.html", html)
            kader_sampled.add(t["league_id"])
        pk = parse_kader(html)
        if pk["warnings"]:
            warnings += [f"{t['name']}: {w}" for w in pk["warnings"]]
        before = {p["name"] for p in t.get("kader", [])}
        after = {p["name"] for p in pk["players"]}
        if t.get("kader_fetched_at") and before != after:
            kader_hist.append({
                "team_id": t["id"], "team": t["name"], "detected_at": now_iso,
                "added": sorted(after - before), "removed": sorted(before - after),
            })
        # Erstes Auftauchen je Spieler merken (für Stammmannschaft)
        first_seen = {p["name"]: p.get("first_seen") for p in t.get("kader", [])}
        for p in pk["players"]:
            p["first_seen"] = first_seen.get(p["name"]) or now_iso
        t["kader"] = pk["players"]
        t["kader_fetched_at"] = now_iso

    # 3) Spielberichte
    today = now.date()
    rotate_bucket = today.toordinal() % ROTATE_DAYS
    report_sampled: set[int] = set()
    fetched_reports = 0
    for m in matches.values():
        played = m.get("result") is not None
        if not played or m.get("bye"):
            continue
        mid = m["id"]
        old = reports.get(mid)
        reason = None
        if args.full:
            reason = "full"
        elif old is None:
            reason = "neu"
        elif matches_old.get(mid, {}).get("result") != m.get("result"):
            reason = "ergebnis geändert"
        elif m.get("date") and (today - datetime.strptime(m["date"], "%Y-%m-%d").date()).days <= RECENT_DAYS:
            reason = "aktuell"
        elif mid % ROTATE_DAYS == rotate_bucket:
            reason = "rotation"
        if not reason:
            continue
        html = f.get(f"sb_spielbericht.php?p={VID}--{season}-{m['league_id']}-0-{mid}")
        if html is None:
            continue
        fetched_reports += 1
        if args.samples and m["league_id"] not in report_sampled:
            save_sample(samples / f"spielbericht-{m['league_id']}.html", html)
            report_sampled.add(m["league_id"])
        r = parse_spielbericht(html)
        if r["warnings"]:
            warnings += [f"Bericht {mid}: {w}" for w in r["warnings"]]
        r.pop("warnings")
        r["id"] = mid
        r["hash"] = report_fingerprint(r)
        r["fetched_at"] = now_iso
        r["first_fetched_at"] = (old or {}).get("first_fetched_at") or now_iso
        if old and old.get("hash") != r["hash"]:
            changes.append({
                "report_id": mid, "league_id": m["league_id"], "st": m.get("st"),
                "detected_at": now_iso, "before_hash": old.get("hash"), "after_hash": r["hash"],
                "diff": diff_reports(old, r),
            })
        reports[mid] = r

    if args.samples:
        # Zusätzlich die Rangliste einer Mannschaft (Einsätze inkl. Springer)
        t0 = next(iter(teams.values()), None)
        if t0:
            html = f.get(f"sb_mannschaft-rangliste.php?p={VID}--{season}-{t0['league_id']}-0-{t0['id']}")
            if html:
                save_sample(samples / "rangliste.html", html)

    save(out / "teams.json", sorted(teams.values(), key=lambda t: (t["league_id"], t["name"])))
    save(out / "matches.json", sorted(matches.values(), key=lambda m: (m["league_id"], m["st"] or 0, m["id"])))
    save(out / "reports.json", {str(k): reports[k] for k in sorted(reports)})
    save(out / "changes.json", changes)
    save(out / "kader_history.json", kader_hist)
    meta = {
        "season": season,
        "generated_at": now_iso,
        "mode": "full" if args.full else "inkrementell",
        "last_full_at": now_iso if args.full else meta_old.get("last_full_at"),
        "requests": f.count,
        "reports_fetched": fetched_reports,
        "counts": {"leagues": len(leagues), "teams": len(teams), "matches": len(matches), "reports": len(reports)},
        "errors": f.errors,
        "warnings": warnings[:500],
        "leagues": scfg["leagues"],
        "races": CONFIG["races"],
        "springer_regel": scfg.get("springer_regel", False),
    }
    save(out / "meta.json", meta)

    seasons_index = ROOT / "docs" / "data" / "seasons.json"
    idx = load(seasons_index, [])
    if slug(season) not in [s["slug"] for s in idx]:
        idx.append({"season": season, "slug": slug(season)})
    save(seasons_index, sorted(idx, key=lambda s: s["slug"]))

    print(f"{season}: {len(teams)} Mannschaften, {len(matches)} Begegnungen, "
          f"{len(reports)} Berichte ({fetched_reports} geladen), {f.count} Abrufe, "
          f"{len(warnings)} Warnungen, {len(f.errors)} Fehler")
    for w in warnings[:40]:
        print("  WARN", w)
    return 0


def save_sample(path: Path, html: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
