#!/usr/bin/env python3
"""Scraper live per diretta.it (feed interno FlashScore).

Recupera partite live, statistiche, eventi (gol/cartellini), formazioni e quote.
Solo standard library: nessuna dipendenza esterna.

Uso rapido:
    python3 diretta_scraper.py                      # partite live (calcio)
    python3 diretta_scraper.py --today              # tutte le partite di oggi
    python3 diretta_scraper.py --enrich all         # live + stats + eventi + formazioni + quote
    python3 diretta_scraper.py --watch 15           # aggiornamento live ogni 15s
    python3 diretta_scraper.py --match 21mxSPJb --enrich stats odds
    python3 diretta_scraper.py --sport 2            # tennis
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

BASE_URL = "https://www.diretta.it"
FEED_URL = BASE_URL + "/x/feed/{feed}"
ODDS_URL = "https://global.ds.lsapp.eu/odds/pq_graphql"
FSIGN = "SW9D1eZo"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

RECORD_SEP = "~"
FIELD_SEP = "\u00ac"
KV_SEP = "\u00f7"

SPORTS = {
    1: "calcio",
    2: "tennis",
    3: "basket",
    4: "hockey",
    6: "handball",
    7: "volley",
}

STATUS_NAMES = {
    1: "PROGRAMMATA",
    2: "LIVE",
    3: "FINITA",
    4: "RINVIATA",
    5: "ANNULLATA",
    6: "SUPPLEMENTARI",
    7: "RIGORI",
    8: "RITIRATA",
    9: "WALKOVER",
    10: "DOPO SUPPLEMENTARI",
    11: "DOPO RIGORI",
    12: "1° TEMPO",
    13: "2° TEMPO",
    36: "INTERROTTA",
    37: "ABBANDONATA",
    38: "INTERVALLO",
    39: "TIME OUT",
    42: "IN ATTESA",
    43: "RINVIATA",
}

LIVE_STATUSES = {2, 6, 7, 10, 11, 12, 13, 36, 39}

STAGE_OFFSETS = {12: 0, 13: 45, 6: 90}
HALFTIME_STAGES = {38}

INCIDENT_TYPES = {
    1: "CARTELLINO_GIALLO",
    2: "CARTELLINO_ROSSO",
    3: "GOL",
    4: "AUTOGOL",
    5: "RIGORE",
    6: "SOSTITUZIONE_OUT",
    7: "SOSTITUZIONE_IN",
    8: "ASSIST",
    9: "SOSPENSIONE",
    10: "RIGORE_SEGNATO",
    11: "RIGORE_SBAGLIATO",
    22: "CARTELLINI_ROSSI",
    23: "CARTELLINI_GIALLO",
}

def _norm_handicap(value):
    if isinstance(value, dict):
        return value.get("value")
    return value


def _selection_label(bet_type: str, count: int, item: dict, index: int) -> str | None:
    if bet_type == "HOME_DRAW_AWAY":
        if item.get("eventParticipantId") is None:
            return "X"
        return "1" if index == 0 else "2"
    if bet_type == "HOME_AWAY":
        return "1" if index == 0 else "2"
    if bet_type == "BOTH_TEAMS_TO_SCORE":
        return "SI" if index == 0 else "NO"
    if bet_type == "DOUBLE_CHANCE":
        return ["1X", "12", "X2"][index] if index < 3 else None
    if bet_type == "DRAW_NO_BET":
        return "1" if index == 0 else "2"
    if bet_type == "OVER_UNDER":
        return "OVER" if index < count / 2 else "UNDER"
    return None

class FeedError(RuntimeError):
    pass


def _http_get(url: str, headers: dict | None = None, timeout: int = 15) -> str:
    base_headers = {
        "x-fsign": FSIGN,
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Referer": BASE_URL + "/",
    }
    if headers:
        base_headers.update(headers)
    req = urllib.request.Request(url, headers=base_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise FeedError(f"HTTP {exc.code} per {url}: {detail[:120]}") from exc
    except urllib.error.URLError as exc:
        raise FeedError(f"Errore di rete per {url}: {exc.reason}") from exc


def _to_records(text: str) -> list[dict[str, str]]:
    records = []
    for chunk in text.split(RECORD_SEP):
        fields = {}
        for part in chunk.split(FIELD_SEP):
            if KV_SEP in part:
                key, value = part.split(KV_SEP, 1)
                fields[key] = value
        if fields:
            records.append(fields)
    return records


def _int(value: str | None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_feed(feed: str) -> list[dict[str, str]]:
    return _to_records(_http_get(FEED_URL.format(feed=feed)))


def fetch_matches(sport: int = 1) -> list[dict]:
    """Restituisce tutte le partite del giorno corrente per uno sport."""
    records = fetch_feed(f"f_{sport}_0_3_it_1")
    matches: list[dict] = []
    tournament: dict | None = None
    for rec in records:
        if "ZA" in rec:
            tournament = {
                "name": rec.get("ZA", ""),
                "country": rec.get("ZY", ""),
                "tournament_id": rec.get("ZEE", ""),
                "stage_id": rec.get("ZC", ""),
                "url": rec.get("ZL", ""),
            }
            continue
        if "AA" not in rec:
            continue
        status = _int(rec.get("AB"))
        stage_id = _int(rec.get("AC"))
        match = {
            "id": rec.get("AA"),
            "sport": sport,
            "tournament": (tournament or {}).get("name", ""),
            "country": (tournament or {}).get("country", ""),
            "tournament_id": (tournament or {}).get("tournament_id", ""),
            "league_url": (tournament or {}).get("url", ""),
            "start_time": _int(rec.get("AD")),
            "status_code": status,
            "status": STATUS_NAMES.get(status, str(status)),
            "stage_id": stage_id,
            "is_live": status in LIVE_STATUSES or rec.get("AI") == "y",
            "stage_start": _int(rec.get("AO")),
            "home": rec.get("AE") or rec.get("CX") or rec.get("FH", ""),
            "away": rec.get("AF") or rec.get("FK", ""),
            "home_short": rec.get("WM", ""),
            "away_short": rec.get("WN", ""),
            "home_score": _int(rec.get("AG")),
            "away_score": _int(rec.get("AH")),
            "home_id": rec.get("PX", ""),
            "away_id": rec.get("PY", ""),
            "home_logo": _logo(rec.get("OA")),
            "away_logo": _logo(rec.get("OB")),
            "minute": None,
        }
        match["minute"] = live_minute(match)
        matches.append(match)
    return matches


def _logo(value: str | None) -> str | None:
    if not value:
        return None
    return f"https://static.flashscore.com/res/image/data/{value}"


def live_minute(match: dict, now: float | None = None) -> str | None:
    """Calcola il minuto corrente di una partita live."""
    if not match.get("is_live"):
        return None
    stage = match.get("stage_id")
    if stage in HALFTIME_STAGES:
        return "Intervallo"
    if stage == 7:
        return "Rigori"
    if stage in (10, 11):
        return "DTS"
    if stage not in STAGE_OFFSETS:
        return None
    start = match.get("stage_start")
    if not start:
        return None
    now = now or time.time()
    minute = int(STAGE_OFFSETS[stage] + (now - start) / 60 + 1)
    if minute < 1:
        minute = 1
    return f"{minute}'"


def fetch_detail(match_id: str) -> dict:
    """Feed `dc_1`: metadati comuni e feed disponibili per un match."""
    records = fetch_feed(f"dc_1_{match_id}")
    if not records:
        return {}
    rec = records[0]
    return {
        "stage_type": _int(rec.get("DA")),
        "stage_id": _int(rec.get("DB")),
        "stage_start": _int(rec.get("DD")),
        "start_time": _int(rec.get("DC")),
        "end_time": _int(rec.get("DS")),
        "home_score": _int(rec.get("DE")),
        "away_score": _int(rec.get("DF")),
        "home_ht_score": _int(rec.get("DG")),
        "away_ht_score": _int(rec.get("DH")),
        "game_time": _int(rec.get("DI")),
        "last_update": _int(rec.get("DK")),
        "available_feeds": [f for f in (rec.get("DX") or "").split(",") if f],
    }


def fetch_statistics(match_id: str) -> dict:
    """Feed `df_st`: statistiche raggruppate per periodo."""
    records = fetch_feed(f"df_st_1_{match_id}")
    groups: list[dict] = []
    current: dict | None = None
    for rec in records:
        if "SF" in rec or "SE" in rec:
            title = rec.get("SF") or rec.get("SE") or "Statistiche"
            current = {"period": title, "stats": []}
            groups.append(current)
            if "SD" not in rec:
                continue
        if "SD" in rec and current is not None:
            current["stats"].append(
                {
                    "id": _int(rec.get("SD")),
                    "name": rec.get("SG", ""),
                    "home": rec.get("SH", ""),
                    "away": rec.get("SI", ""),
                }
            )
    return {"groups": groups}


def fetch_events(match_id: str) -> list[dict]:
    """Feed `df_sui`: cronologia eventi (gol, cartellini, sostituzioni)."""
    raw = _http_get(FEED_URL.format(feed=f"df_sui_1_{match_id}"))
    events: list[dict] = []
    period = None
    for chunk in raw.split(RECORD_SEP):
        tokens = [part.split(KV_SEP, 1) for part in chunk.split(FIELD_SEP) if KV_SEP in part]
        keys = {key for key, _ in tokens}
        if "III" not in keys:
            for key, value in tokens:
                if key == "AC":
                    period = value
            continue
        row = {key: value for key, value in tokens if key in ("IA", "IB", "INX", "IOX")}
        side = _int(row.get("IA"))
        minute = row.get("IB")
        home_score = _int(row.get("INX"))
        away_score = _int(row.get("IOX"))
        incidents: list[dict] = []
        current = None
        for key, value in tokens:
            if key == "IE":
                current = {"type_code": _int(value)}
                incidents.append(current)
            elif key in ("IF", "IK", "IM", "IU") and current is not None:
                current[key] = value
        for incident in incidents:
            type_name = incident.get("IK")
            events.append(
                {
                    "minute": minute,
                    "period": period,
                    "side": "home" if side == 1 else "away" if side == 2 else None,
                    "type": INCIDENT_TYPES.get(incident.get("type_code"), type_name or ""),
                    "type_name": type_name,
                    "player": incident.get("IF"),
                    "player_id": incident.get("IM", ""),
                    "score": (
                        f"{home_score}-{away_score}"
                        if home_score is not None and away_score is not None
                        else None
                    ),
                }
            )
    return events


def fetch_lineups(match_id: str) -> dict:
    """Feed `df_li`: formazioni, panchina e allenatori."""
    records = fetch_feed(f"df_li_1_{match_id}")
    result = {
        "formation": {},
        "home": [],
        "away": [],
        "home_bench": [],
        "away_bench": [],
        "coaches": {},
    }
    side = "home"
    section = "starters"
    for rec in records:
        if "LP" in rec and "LI" in rec:
            player = {
                "id": rec.get("LP"),
                "name": rec.get("LI"),
                "number": _int(rec.get("LJ")),
                "nationality": rec.get("LQ", ""),
            }
            if section == "starters" and "LD" in rec:
                result["formation"][side] = rec.get("LD")
            if section == "bench":
                result[f"{side}_bench"].append(player)
            elif section == "coaches":
                result["coaches"][side] = player
            else:
                result[side].append(player)
        elif "LB" in rec:
            label = rec.get("LB", "")
            if "Panchina" in label:
                section = "bench"
            elif "Allenator" in label:
                section = "coaches"
            else:
                section = "starters"
            side = "home"
        elif "LC" in rec and "LA" not in rec and "LB" not in rec:
            side = "away" if side == "home" else "home"
    return result


def fetch_odds(match_id: str, geo: str = "IT", project_id: int = 2) -> dict:
    """Quote dal servizio GraphQL (query persistita `oce`)."""
    params = urllib.parse.urlencode(
        {
            "_hash": "oce",
            "eventId": match_id,
            "projectId": str(project_id),
            "geoIpCode": geo,
            "geoIpSubdivisionCode": "",
        }
    )
    headers = {"Origin": BASE_URL, "Accept": "application/json"}
    raw = _http_get(f"{ODDS_URL}?{params}", headers=headers)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"bookmakers": [], "markets": []}
    event = (payload.get("data") or {}).get("findOddsByEventId") or {}
    if not event:
        return {"bookmakers": [], "markets": []}

    bookmakers = {}
    for entry in (event.get("settings") or {}).get("bookmakers", []):
        bookmaker = entry.get("bookmaker") or {}
        bookmakers[str(bookmaker.get("id"))] = bookmaker.get("name", "")

    markets = []
    for entry in event.get("odds", []):
        odds_items = entry.get("odds", [])
        if not odds_items:
            continue
        bet_type = entry.get("bettingType", "")
        count = len(odds_items)
        outcomes = []
        for index, item in enumerate(odds_items):
            outcomes.append(
                {
                    "label": _selection_label(bet_type, count, item, index),
                    "value": item.get("value"),
                    "opening": item.get("opening"),
                    "handicap": _norm_handicap(item.get("handicap")),
                    "active": item.get("active"),
                }
            )
        markets.append(
            {
                "bookmaker_id": str(entry.get("bookmakerId")),
                "bookmaker": bookmakers.get(str(entry.get("bookmakerId")), ""),
                "bet_type": bet_type,
                "scope": entry.get("bettingScope"),
                "live": entry.get("hasLiveBettingOffers"),
                "outcomes": outcomes,
            }
        )
    active_books = sorted({m["bookmaker"] for m in markets if m["bookmaker"]})
    return {"bookmakers": active_books, "markets": markets}


def enrich_match(match: dict, options: set[str], geo: str) -> None:
    match_id = match["id"]
    try:
        if "stats" in options:
            match["statistics"] = fetch_statistics(match_id)
        if "events" in options:
            match["events"] = fetch_events(match_id)
        if "lineups" in options:
            match["lineups"] = fetch_lineups(match_id)
        if "odds" in options:
            match["odds"] = fetch_odds(match_id, geo=geo)
        if "detail" in options:
            match["detail"] = fetch_detail(match_id)
    except FeedError as exc:
        match["enrich_error"] = str(exc)

    detail = match.get("detail")
    if detail and detail.get("home_score") is not None and detail.get("away_score") is not None:
        match["home_score"] = detail["home_score"]
        match["away_score"] = detail["away_score"]
        if detail.get("stage_id") is not None:
            match["stage_id"] = detail["stage_id"]
        if detail.get("stage_start"):
            match["stage_start"] = detail["stage_start"]
        match["minute"] = live_minute(match)


def collect(
    sport: int,
    scope: str,
    filter_text: str | None,
    options: set[str],
    geo: str,
    workers: int,
) -> list[dict]:
    matches = fetch_matches(sport)
    if scope == "live":
        matches = [m for m in matches if m["is_live"]]
    if filter_text:
        needle = filter_text.lower()
        matches = [
            m
            for m in matches
            if needle in m["home"].lower()
            or needle in m["away"].lower()
            or needle in m["tournament"].lower()
        ]
    if options and matches:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(enrich_match, m, options, geo) for m in matches]
            for _ in as_completed(futures):
                pass
    return matches


def _use_color() -> bool:
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(text: str, code: str) -> str:
    if not _use_color():
        return text
    return f"\033[{code}m{text}\033[0m"


def _fmt_time(epoch: int | None) -> str:
    if not epoch:
        return "--:--"
    return datetime.fromtimestamp(epoch).strftime("%H:%M")


def render_table(matches: list[dict]) -> str:
    if not matches:
        return "Nessuna partita trovata."
    lines = []
    by_tournament: dict[str, list[dict]] = {}
    for match in matches:
        by_tournament.setdefault(match["tournament"], []).append(match)

    header = f"{'Stato/Min':<14} {'Casa':<26} {'Ris':^7} {'Ospite':<26}"
    for tournament, group in by_tournament.items():
        lines.append("")
        lines.append(_c(tournament or "-", "1;36"))
        lines.append(header)
        lines.append("-" * len(header))
        for match in group:
            status = match.get("minute") if match["is_live"] else match["status"]
            status = status or match["status"]
            if match["home_score"] is not None and match["away_score"] is not None:
                score = f"{match['home_score']}-{match['away_score']}"
            else:
                score = _fmt_time(match["start_time"])
            home = (match["home"] or "")[:26]
            away = (match["away"] or "")[:26]
            row = f"{status:<14} {home:<26} {score:^7} {away:<26}"
            if match["is_live"]:
                row = _c(row, "1;32")
            lines.append(row)
    lines.append("")
    lines.append(f"Totale: {len(matches)} partite ({len(by_tournament)} tornei)")
    return "\n".join(lines)


def _outcome_str(outcome: dict) -> str:
    text = f"{outcome['value']}"
    if outcome.get("handicap") not in (None, "0"):
        text += f"({outcome['handicap']})"
    return text


def render_odds(odds: dict) -> str:
    markets = odds.get("markets") or []
    if not markets:
        return "  (nessuna quota disponibile)"
    by_book: dict[str, dict] = {}
    total = 0
    for market in markets:
        total += 1
        book = market["bookmaker"] or market["bookmaker_id"]
        entry = by_book.setdefault(book, {})
        key = (market["bet_type"], market["scope"])
        entry.setdefault(key, []).append(market)

    lines = []
    for book in sorted(by_book):
        entry = by_book[book]
        parts = []
        hda = entry.get(("HOME_DRAW_AWAY", "FULL_TIME"))
        if hda:
            picks = {o["label"]: o["value"] for o in hda[0]["outcomes"]}
            parts.append(f"1X2 {picks.get('1','?')}/{picks.get('X','?')}/{picks.get('2','?')}")
        ou = entry.get(("OVER_UNDER", "FULL_TIME"))
        if ou:
            for market in ou:
                for o in market["outcomes"]:
                    if o["handicap"] == "2.5":
                        tag = "O2.5" if o["label"] == "OVER" else "U2.5"
                        parts.append(f"{tag} {o['value']}")
        btts = entry.get(("BOTH_TEAMS_TO_SCORE", "FULL_TIME"))
        if btts:
            picks = {o["label"]: o["value"] for o in btts[0]["outcomes"]}
            parts.append(f"GG {picks.get('SI','?')}/{picks.get('NO','?')}")
        if parts:
            lines.append(f"    {book:<14} " + "  ".join(parts))
    lines.append(f"    ({total} mercati totali; dettaglio completo in JSON)")
    return "\n".join(lines)


def print_match(match: dict) -> None:
    title = f"{match['home']} {match.get('home_score')}-{match.get('away_score')} {match['away']}"
    print(_c(f"\n=== {title} ===", "1"))
    print(f"ID: {match['id']}  Torneo: {match['tournament']}  Stato: {match.get('minute') or match['status']}")
    if "detail" in match:
        detail = match["detail"]
        feeds = ", ".join(detail.get("available_feeds", []))
        print(f"Feed disponibili: {feeds}")
    if "statistics" in match:
        print(_c("Statistiche:", "1;36"))
        for group in match["statistics"]["groups"]:
            for stat in group["stats"]:
                print(f"    {group['period']:<14} {stat['name']:<32} {stat['home']:>12} {stat['away']:>12}")
    if "events" in match:
        print(_c("Eventi:", "1;36"))
        for event in match["events"]:
            score = event["score"] or ""
            print(
                f"    {event['minute'] or '':>5} {event['side'] or '':<5} "
                f"{event['type'] or event['type_name'] or '':<20} {event['player'] or ''} {score}"
            )
    if "lineups" in match:
        lineups = match["lineups"]
        print(_c("Formazioni:", "1;36"))
        for side in ("home", "away"):
            players = lineups.get(side, [])
            names = ", ".join(p["name"] or "" for p in players)
            print(f"    {side:<5} ({lineups['formation'].get(side, '')}): {names}")
            bench = lineups.get(f"{side}_bench", [])
            if bench:
                print(f"          panchina: {', '.join(p['name'] or '' for p in bench)}")
            coach = lineups.get("coaches", {}).get(side)
            if coach:
                print(f"          allenatore: {coach['name']}")
    if "odds" in match:
        print(_c("Quote:", "1;36"))
        print(render_odds(match["odds"]))


def _single_match(match_id: str, sport: int, options: set[str], geo: str) -> dict:
    """Costruisce il dettaglio di una singola partita dato il suo ID."""
    match = None
    try:
        for candidate in fetch_matches(sport):
            if candidate["id"] == match_id:
                match = candidate
                break
    except FeedError:
        pass
    if match is None:
        match = {
            "id": match_id,
            "sport": sport,
            "tournament": "",
            "country": "",
            "home": "",
            "away": "",
            "home_score": None,
            "away_score": None,
            "start_time": None,
            "status": "",
            "status_code": None,
            "stage_id": None,
            "is_live": False,
            "minute": None,
        }
    enrich_match(match, options | {"detail"}, geo)
    return match


def run_once(args) -> list[dict]:
    options = set(args.enrich) if args.enrich else set()
    if args.match:
        matches = [_single_match(args.match, args.sport, options, args.geo)]
    else:
        matches = collect(
            sport=args.sport,
            scope=args.scope,
            filter_text=args.filter,
            options=options,
            geo=args.geo,
            workers=args.workers,
        )

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(matches, handle, ensure_ascii=False, indent=2)
        print(f"Dati salvati in {args.json}")

    if not args.quiet:
        if options or args.match:
            for match in matches:
                print_match(match)
        else:
            print(render_table(matches))
    return matches


def run_watch(args) -> None:
    options = set(args.enrich) if args.enrich else set()
    previous: dict[str, tuple] = {}
    print(_c(f"Live watch su diretta.it (sport={args.sport}) - intervallo {args.watch}s. Ctrl+C per uscire.", "1;36"))
    while True:
        try:
            matches = collect(
                sport=args.sport,
                scope=args.scope,
                filter_text=args.filter,
                options=options,
                geo=args.geo,
                workers=args.workers,
            )
        except FeedError as exc:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] errore: {exc}")
            time.sleep(args.watch)
            continue

        stamp = datetime.now().strftime("%H:%M:%S")
        changes = []
        for match in matches:
            state = (
                match.get("home_score"),
                match.get("away_score"),
                match.get("status_code"),
                match.get("stage_id"),
                match.get("minute"),
            )
            old = previous.get(match["id"])
            if old is None:
                changes.append(f"[{stamp}] NUOVA {match['home']} {state[0]}-{state[1]} {match['away']} ({match.get('minute') or match['status']})")
            elif old != state:
                score = f"{state[0]}-{state[1]}"
                changes.append(
                    f"[{stamp}] AGGIORNAMENTO {match['home']} {score} {match['away']} "
                    f"({match.get('minute') or match['status']})"
                )
            previous[match["id"]] = state

        if args.watch_full and not options:
            print(render_table(matches))
        else:
            for line in changes:
                print(line)
            if not changes:
                print(f"[{stamp}] nessun cambiamento ({len(matches)} partite monitorate)")

        if args.json:
            with open(args.json, "w", encoding="utf-8") as handle:
                json.dump(matches, handle, ensure_ascii=False, indent=2)
        time.sleep(args.watch)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scraper live per diretta.it (partite, statistiche, eventi, formazioni, quote).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sport_help = ", ".join(f"{sid}={name}" for sid, name in SPORTS.items())
    parser.add_argument("--sport", type=int, default=1, help=f"ID sport ({sport_help}). Default 1.")
    parser.add_argument("--today", action="store_true", help="Mostra tutte le partite del giorno (default: solo live).")
    parser.add_argument("--scope", choices=["live", "today"], default=None, help="Scope partite.")
    parser.add_argument("--enrich", choices=["detail", "stats", "events", "lineups", "odds", "all"], nargs="+", help="Dati aggiuntivi da recuperare per ogni partita.")
    parser.add_argument("--filter", help="Filtra per nome squadra o torneo (substring).")
    parser.add_argument("--match", help="ID di una singola partita da analizzare nel dettaglio.")
    parser.add_argument("--json", help="Salva l'output in un file JSON.")
    parser.add_argument("--geo", default="IT", help="Codice paese per le quote (default IT).")
    parser.add_argument("--workers", type=int, default=8, help="Richieste parallele per i dati di dettaglio (default 8).")
    parser.add_argument("--watch", type=float, metavar="SEC", help="Modalita' live: aggiorna ogni SEC secondi.")
    parser.add_argument("--watch-full", action="store_true", help="In watch mostra la tabella completa ad ogni ciclo.")
    parser.add_argument("--quiet", action="store_true", help="Non stampare l'output (utile con --json).")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.enrich and "all" in args.enrich:
        args.enrich = ["detail", "stats", "events", "lineups", "odds"]
    if args.scope is None:
        args.scope = "today" if args.today else "live"
    if args.watch:
        run_watch(args)
        return 0
    run_once(args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrotto.")
        raise SystemExit(130)
