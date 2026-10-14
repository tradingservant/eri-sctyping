#!/usr/bin/env python3
"""Build data/characters.json and data/frequency.tsv.

Sucheng code = first and last letter of the Cangjie 5 code.
A one-letter Cangjie code stays one letter.

Sources (downloaded when you run this script):
  - Rime cangjie5.base.dict.yaml  (GNU LGPL-3.0)
  - 國家教育研究院《臺灣華語文能力基準》漢字表, 2022-09-20

Usage (from the repo root, needs network unless you pass local files):

  python3 data/build_characters.py
  python3 data/build_characters.py --cangjie /path/to/cangjie5.base.dict.yaml --tbcl /path/to/tbcl.csv
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CANGJIE_URL = "https://raw.githubusercontent.com/rime/rime-cangjie/master/cangjie5.base.dict.yaml"
TBCL_URL = "https://coct.naer.edu.tw/file/files/%E8%87%BA%E7%81%A3%E8%8F%AF%E8%AA%9E%E6%96%87%E8%83%BD%E5%8A%9B%E5%9F%BA%E6%BA%96%E6%BC%A2%E5%AD%97%E8%A1%A8_111-09-20.csv"

# Checked against the Cangjie table every time this script runs.
SPOT_CHECKS = {
    "倉": "OR",
    "我": "HI",
    "日": "A",
    "明": "AB",
}

# One-key shortcuts in the Cangjie table (的=x, 我=z). They are not Sucheng codes.
BARE_SHORTCUTS = {"x", "z"}


def download(url: str, dest: Path) -> None:
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, dest)


def parse_cangjie(text: str) -> tuple[dict[str, list[str]], str]:
    version = ""
    in_data = False
    codes: dict[str, list[str]] = defaultdict(list)
    for line in text.splitlines():
        if line.startswith("version:"):
            version = line.split(":", 1)[1].strip().strip('"')
        if line.strip() == "...":
            in_data = True
            continue
        if not in_data or not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        char, code = parts[0], parts[1].strip().lower()
        if len(char) != 1:
            continue
        if not code or any(ch not in "abcdefghijklmnopqrstuvwxyz" for ch in code):
            continue
        codes[char].append(code)
    return codes, version


def candidate_codes(codes: list[str]) -> list[str]:
    """Prefer the plain Cangjie decomposition.

    Codes that are only "x" or "z" are one-key shortcuts, not Sucheng.
    An x-prefixed code is the 難 disambiguation form when a plain code exists.
    """
    usable = [code for code in codes if code not in BARE_SHORTCUTS]
    plain = [code for code in usable if not code.startswith("x")]
    return plain or usable


def sucheng(code: str) -> str:
    code = code.lower()
    if len(code) <= 1:
        return code.upper()
    return (code[0] + code[-1]).upper()


def parse_tbcl(text: str) -> list[tuple[str, int, int, int]]:
    """Return (char, written_freq, tbcl_seq, variant_index), highest freq first."""
    rows = []
    lines = text.lstrip("\ufeff").splitlines()
    for line in lines[1:]:
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        seq = int(parts[0])
        try:
            freq = int(parts[4])
        except ValueError:
            continue
        variants = [item.strip() for item in parts[1].replace("/", "／").split("／") if item.strip()]
        for index, char in enumerate(variants):
            if len(char) == 1:
                rows.append((char, freq, seq, index))

    best: dict[str, tuple[str, int, int, int]] = {}
    for char, freq, seq, index in rows:
        current = best.get(char)
        if current is None or (freq, -seq, -index) > (current[1], -current[2], -current[3]):
            best[char] = (char, freq, seq, index)
    ranked = sorted(best.values(), key=lambda item: (-item[1], item[2], item[3], item[0]))
    return ranked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cangjie", type=Path, help="local cangjie5.base.dict.yaml")
    parser.add_argument("--tbcl", type=Path, help="local TBCL csv")
    args = parser.parse_args()

    if args.cangjie:
        cangjie_text = args.cangjie.read_text(encoding="utf-8")
    else:
        dest = ROOT / "_cache_cangjie5.base.dict.yaml"
        download(CANGJIE_URL, dest)
        cangjie_text = dest.read_text(encoding="utf-8")
        dest.unlink()

    if args.tbcl:
        tbcl_text = args.tbcl.read_text(encoding="utf-8")
    else:
        dest = ROOT / "_cache_tbcl.csv"
        download(TBCL_URL, dest)
        tbcl_text = dest.read_text(encoding="utf-8")
        dest.unlink()

    codes, version = parse_cangjie(cangjie_text)
    ranked = parse_tbcl(tbcl_text)

    for char, expected in SPOT_CHECKS.items():
        options = candidate_codes(codes[char])
        got = sucheng(options[0])
        if got != expected:
            raise SystemExit(f"spot check failed: {char} = {got}, expected {expected} from {options}")

    characters = []
    missing = []
    for char, freq, seq, _index in ranked:
        options = codes.get(char)
        if not options:
            missing.append(char)
            continue
        chosen = candidate_codes(options)
        sucheng_codes = []
        for code in chosen:
            short = sucheng(code)
            if short not in sucheng_codes:
                sucheng_codes.append(short)
        entry = {
            "char": char,
            "code": sucheng_codes[0],
            "cangjie": chosen[0],
            "freq": freq,
            "rank": len(characters) + 1,
        }
        if len(sucheng_codes) > 1:
            entry["alts"] = sucheng_codes[1:]
        characters.append(entry)

    if missing:
        raise SystemExit(f"{len(missing)} frequency-list characters have no Cangjie code, e.g. {missing[:8]}")

    payload = {
        "practiceSize": 300,
        "cangjieTable": "rime/rime-cangjie cangjie5.base.dict.yaml",
        "cangjieTableVersion": version,
        "license": "GNU LGPL-3.0",
        "suchengRule": "First and last letter of the Cangjie 5 code. A one-letter code stays one letter.",
        "frequencyList": "國家教育研究院《臺灣華語文能力基準》漢字表（2022-09-20），按書面字頻由高至低",
        "characters": characters,
    }

    out_json = ROOT / "characters.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    tsv_lines = ["rank\tchar\tfreq\ttbcl_seq\tcangjie\tsucheng"]
    seq_by_char = {char: seq for char, _freq, seq, _index in ranked}
    for entry in characters:
        tsv_lines.append(
            f"{entry['rank']}\t{entry['char']}\t{entry['freq']}\t{seq_by_char[entry['char']]}\t{entry['cangjie']}\t{entry['code']}"
        )
    (ROOT / "frequency.tsv").write_text("\n".join(tsv_lines) + "\n", encoding="utf-8")

    z_primary = [entry["char"] for entry in characters[:1000] if entry["cangjie"].startswith("z")]
    print(f"wrote {len(characters)} characters to {out_json}")
    print(f"cangjie table version {version}")
    print(f"z-primary codes in the first 1000: {len(z_primary)}")
    for char, expected in SPOT_CHECKS.items():
        print(f"  {char} = {expected}")


if __name__ == "__main__":
    main()
