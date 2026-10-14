#!/usr/bin/env python3
"""Check the committed Sucheng table and the 26-radical map."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RADICALS = {
    "a": ("日", 0x65E5),
    "b": ("月", 0x6708),
    "c": ("金", 0x91D1),
    "d": ("木", 0x6728),
    "e": ("水", 0x6C34),
    "f": ("火", 0x706B),
    "g": ("土", 0x571F),
    "h": ("竹", 0x7AF9),
    "i": ("戈", 0x6208),
    "j": ("十", 0x5341),
    "k": ("大", 0x5927),
    "l": ("中", 0x4E2D),
    "m": ("一", 0x4E00),
    "n": ("弓", 0x5F13),
    "o": ("人", 0x4EBA),
    "p": ("心", 0x5FC3),
    "q": ("手", 0x624B),
    "r": ("口", 0x53E3),
    "s": ("尸", 0x5C38),
    "t": ("廿", 0x5EFF),
    "u": ("山", 0x5C71),
    "v": ("女", 0x5973),
    "w": ("田", 0x7530),
    "x": ("難", 0x96E3),
    "y": ("卜", 0x535C),
    "z": ("重", 0x91CD),
}

SPOTS = {
    "倉": ("OR", "oiar"),
    "我": ("HI", "hqi"),
    "日": ("A", "a"),
    "明": ("AB", "ab"),
    "的": ("HI", "hapi"),
    "是": ("AO", "amyo"),
}


def sucheng(code: str) -> str:
    code = code.lower()
    if len(code) <= 1:
        return code.upper()
    return (code[0] + code[-1]).upper()


def main() -> None:
    errors = []
    radicals = json.loads((ROOT / "data" / "radicals.json").read_text(encoding="utf-8"))
    mapping = radicals["map"]
    if set(mapping) != set(RADICALS):
        errors.append("radical map is not exactly a-z")
    for letter, (char, point) in RADICALS.items():
        got = mapping.get(letter, "")
        if got != char or ord(got) != point:
            errors.append(f"{letter} is {got!r} U+{ord(got):04X} , expected {char} U+{point:04X}")
    if ord(mapping.get("y", " ")) == 0x30C8:
        errors.append("Y is katakana to, not 卜")

    seen = []
    for group in radicals["groups"]:
        seen.extend(group["letters"])
        if group["id"] != "special":
            built = "".join(mapping[letter] for letter in group["letters"])
            if group["sample"] != built:
                errors.append(f"{group['id']} sample {group['sample']!r} != {built!r}")
    if sorted(seen) != list("abcdefghijklmnopqrstuvwxyz") or len(seen) != 26:
        errors.append(f"groups do not partition a-z: {seen}")
    rows = "".join(radicals["rows"])
    if sorted(rows) != list("abcdefghijklmnopqrstuvwxyz"):
        errors.append(f"keyboard rows are not a-z: {rows}")

    data = json.loads((ROOT / "data" / "characters.json").read_text(encoding="utf-8"))
    characters = data["characters"]
    size = data["practiceSize"]
    if size != 300:
        errors.append(f"practiceSize is {size}, expected 300")
    if size > len(characters):
        errors.append("practiceSize is larger than the character list")
    chars = [entry["char"] for entry in characters]
    if len(chars) != len(set(chars)):
        errors.append("duplicate characters")
    freqs = [entry["freq"] for entry in characters]
    if any(freqs[i] < freqs[i + 1] for i in range(len(freqs) - 1)):
        errors.append("characters are not in frequency order")
    by_char = {entry["char"]: entry for entry in characters}
    for char, (code, cangjie) in SPOTS.items():
        entry = by_char.get(char)
        if not entry:
            errors.append(f"missing spot check {char}")
            continue
        if entry["code"] != code or entry["cangjie"] != cangjie:
            errors.append(f"{char} is {entry['code']}/{entry['cangjie']}, expected {code}/{cangjie}")
        if sucheng(entry["cangjie"]) != entry["code"]:
            errors.append(f"{char} sucheng does not match its cangjie code")
    for entry in characters:
        if sucheng(entry["cangjie"]) != entry["code"]:
            errors.append(f"{entry['char']} code {entry['code']} != {entry['cangjie']}")
            break
        for alt in entry.get("alts", []):
            if not (len(alt) in (1, 2) and alt.isalpha() and alt.isupper()):
                errors.append(f"bad alt on {entry['char']}: {alt}")
                break
        if not (len(entry["code"]) in (1, 2) and entry["code"].isalpha() and entry["code"].isupper()):
            errors.append(f"bad code on {entry['char']}: {entry['code']}")
            break

    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print(f"ok: {len(characters)} characters, practiceSize {size}, Y is U+535C")


if __name__ == "__main__":
    main()
