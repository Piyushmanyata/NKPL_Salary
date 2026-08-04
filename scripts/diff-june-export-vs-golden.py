"""
TICKET-15 — Attribute Reference net deltas: 2026-07-07 archive vs current golden.

Reads HTML-as-.xls tables under docs/archive/2026-07-07/ and
src/__tests__/fixtures/golden-{nkpl,aptus}-june-2026.json.

Writes docs/archive/2026-07-07/JUNE-DIFF-ATTRIBUTION.md
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "docs" / "archive" / "2026-07-07"
FIXTURES = ROOT / "src" / "__tests__" / "fixtures"


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.headers: list[str] = []
        self.rows: list[list[str]] = []
        self._in_th = False
        self._in_td = False
        self._cur: list[str] | None = None
        self._cell = ""
        self._in_thead = False
        self._in_tbody = False

    def handle_starttag(self, tag, attrs):
        if tag == "thead":
            self._in_thead = True
        elif tag == "tbody":
            self._in_tbody = True
        elif tag == "tr":
            self._cur = []
        elif tag == "th":
            self._in_th = True
            self._cell = ""
        elif tag == "td":
            self._in_td = True
            self._cell = ""

    def handle_endtag(self, tag):
        if tag == "thead":
            self._in_thead = False
        elif tag == "tbody":
            self._in_tbody = False
        elif tag == "th" and self._in_th:
            self.headers.append(self._cell.strip())
            self._in_th = False
        elif tag == "td" and self._in_td:
            assert self._cur is not None
            self._cur.append(self._cell.strip())
            self._in_td = False
        elif tag == "tr" and self._cur is not None:
            if self._cur and (self._in_tbody or not self._in_thead):
                # tbody rows only; skip empty
                if any(self._cur):
                    self.rows.append(self._cur)
            self._cur = None

    def handle_data(self, data):
        if self._in_th or self._in_td:
            self._cell += data


def parse_export(path: Path) -> dict[str, dict]:
    text = path.read_text(encoding="utf-8", errors="replace")
    p = TableParser()
    p.feed(text)
    if not p.headers:
        raise SystemExit(f"no headers in {path}")
    # normalize header keys
    idx = {h: i for i, h in enumerate(p.headers)}

    def col(row, name, default=""):
        i = idx.get(name)
        if i is None or i >= len(row):
            return default
        return row[i]

    out = {}
    for row in p.rows:
        name = col(row, "Employee Name").strip()
        if not name or name.lower().startswith("total"):
            continue
        def num(key):
            raw = col(row, key, "").replace(",", "").strip()
            if raw == "" or raw == "-":
                return 0.0
            try:
                return float(raw)
            except ValueError:
                return 0.0

        basic = num("Basic Salary")
        hra = num("HRA")
        ta = num("Travel Allowance")
        perf = num("Performance Bonus")
        special = num("Special Bonus")
        out[name] = {
            "category": col(row, "Category"),
            "earnedSalary": num("Earned Salary"),
            "gross": round(basic + hra + ta + perf + special, 2),
            "esi": num("ESI Deduction"),
            "ptax": num("P-Tax"),
            "advance": num("Advance"),
            "otherDeduction": num("Other Deduction"),
            "net": num("Net Payable"),
            "pf": num("Employee PF Deduction"),
            "basic": basic,
            "hra": hra,
            "ta": ta,
            "perf": perf,
            "special": special,
            "dailyBonus": num("Daily Bonus Amount"),
        }
    return out


def load_golden(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for row in data["rows"]:
        ref = row["reference"]
        out[row["name"]] = {
            "category": row.get("category"),
            "earnedSalary": ref["earnedSalary"],
            "gross": ref["grossPayable"],
            "esi": ref["esi"],
            "ptax": ref["professionalTax"],
            "advance": ref["advance"],
            "otherDeduction": ref["otherDeduction"],
            "net": ref["netPayable"],
            "pf": ref["employeePf"],
            "basic": ref["basicSalary"],
            "unpackable": row["official"].get("unpackable"),
            "officialNet": row["official"]["netPayable"],
            "officialBasic": row["official"]["monthlyBasic"],
            "officialAttendance": row["official"]["attendance"],
        }
    return out


def r2(x: float) -> float:
    return round(float(x) + 1e-12, 2)


def attribute(name: str, old: dict, new: dict) -> list[str]:
    """Return ticket tags explaining net delta (new - old)."""
    tags: list[str] = []
    d_net = r2(new["net"] - old["net"])
    if abs(d_net) < 0.015:
        return ["(no net change)"]

    # ESI base: old ESI ≈ 0.0075 * earned; new ≈ 0.0075 * gross
    if abs(old["esi"]) > 0.01 or abs(new["esi"]) > 0.01:
        old_base = r2(old["esi"] / 0.0075) if old["esi"] else 0
        new_base = r2(new["esi"] / 0.0075) if new["esi"] else 0
        if abs(old_base - old.get("earnedSalary", 0)) < 2 and abs(
            new_base - new["gross"]
        ) < 2:
            tags.append("ESI-base→gross (ADR-0002 / statutory rework 2026-07-24)")
        elif abs(new["esi"] - old["esi"]) > 0.01:
            tags.append(f"ESI Δ {r2(new['esi']-old['esi']):+.2f} (check eligibility/base)")

    # Advance convention: archive stored negative; golden stores positive recovery
    # Export net already reflected recovery via +(-1500). Golden subtracts +1500.
    # So if only sign storage changed but recovery same, net should match for advance.
    # If old advance is negative and new is positive abs, advance recovery is same.
    old_adv_effect = old["advance"]  # stored as in export (often negative)
    new_adv = new["advance"]
    # In old engine: net = ... + advance (negative reduces). In new: net = ... - advance (positive reduces).
    # Recovery amount old = -old_adv if old_adv < 0 else ?
    # Compare absolute recovery:
    old_recovery = -old_adv_effect if old_adv_effect < 0 else (
        -old_adv_effect if False else abs(old_adv_effect) if old_adv_effect else 0
    )
    # Actually if old stored -1500 and engine ADDED advance, recovery = 1500.
    # If old stored 0, recovery 0.
    if old_adv_effect < 0:
        old_recovery = -old_adv_effect
    else:
        # export sometimes blank=0; if positive in export under old engine it would have INCREASED net
        old_recovery = -old_adv_effect  # if positive added, recovery is negative (adds to net)
    # Simpler: report advance fields
    if abs(old["advance"] - new["advance"]) > 0.01 and not (
        old["advance"] < 0 and abs(old["advance"] + new["advance"]) < 0.01
    ):
        tags.append(
            f"advance field {old['advance']} → {new['advance']} (T-06 convention; recovery should still be abs)"
        )
    elif old["advance"] < 0 and abs(old["advance"] + new["advance"]) < 0.01:
        tags.append("T-06 advance sign convention only (recovery amount unchanged)")

    # P-Tax
    if abs(new["ptax"] - old["ptax"]) > 0.01:
        tags.append(
            f"P-Tax {old['ptax']:.0f} → {new['ptax']:.0f} (T-15 open: exemption? / slab on gross)"
        )

    # PF / gross component shifts
    if abs(new["pf"] - old["pf"]) > 0.01:
        tags.append(f"PF Δ {r2(new['pf']-old['pf']):+.2f}")
    if abs(new["gross"] - old["gross"]) > 0.01:
        tags.append(f"gross Δ {r2(new['gross']-old['gross']):+.2f}")
    if abs(new["basic"] - old["basic"]) > 0.01:
        tags.append(f"basic Δ {r2(new['basic']-old['basic']):+.2f}")

    if not tags:
        tags.append("unattributed — investigate")
    return tags


def run_company(label: str, export_name: str, golden_name: str) -> tuple[str, float, float]:
    old = parse_export(ARCHIVE / export_name)
    new = load_golden(FIXTURES / golden_name)
    lines = [f"## {label}", ""]
    lines.append(
        "| Employee | Old net | New net | Δ net | Old ESI | New ESI | Old P-Tax | New P-Tax | Old adv | New adv | Attribution |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")

    old_total = 0.0
    new_total = 0.0
    only_old = sorted(set(old) - set(new))
    only_new = sorted(set(new) - set(old))
    common = sorted(set(old) & set(new))

    unexplained = []
    for name in common:
        o, n = old[name], new[name]
        old_total += o["net"]
        new_total += n["net"]
        d = r2(n["net"] - o["net"])
        tags = attribute(name, o, n)
        if "unattributed" in " ".join(tags):
            unexplained.append(name)
        lines.append(
            f"| {name} | {o['net']:.2f} | {n['net']:.2f} | {d:+.2f} | "
            f"{o['esi']:.2f} | {n['esi']:.2f} | {o['ptax']:.0f} | {n['ptax']:.0f} | "
            f"{o['advance']:g} | {n['advance']:g} | {'; '.join(tags)} |"
        )

    lines.append("")
    lines.append(
        f"**Net total:** old **{r2(old_total):.2f}** → new **{r2(new_total):.2f}** "
        f"(Δ **{r2(new_total - old_total):+.2f}**)"
    )
    if only_old:
        lines.append(f"**Only in archive:** {', '.join(only_old)}")
    if only_new:
        lines.append(f"**Only in golden:** {', '.join(only_new)}")
    if unexplained:
        lines.append(f"**Needs review:** {', '.join(unexplained)}")
    lines.append("")
    return "\n".join(lines), r2(old_total), r2(new_total)


def main() -> None:
    parts = [
        "# June 2026 — archive export vs current engine (golden)",
        "",
        "Generated by `scripts/diff-june-export-vs-golden.py` for **TICKET-15**.",
        "",
        "**Old:** HTML tables archived as `.xls` under this folder (2026-07-07).",
        "**New:** `src/__tests__/fixtures/golden-*-june-2026.json` (SPEC-aligned engine after T-01…T-14).",
        "",
        "Net equality on the Official side is asserted in goldens (`unpackable=0` for both rosters).",
        "Attribution is best-effort from field deltas; ESI-on-earned vs ESI-on-gross is the dominant Reference shift.",
        "",
    ]
    nkpl_md, nkpl_old, nkpl_new = run_company(
        "NKPL",
        "NKPL Reference Salary Sheet June 2026.xls",
        "golden-nkpl-june-2026.json",
    )
    aptus_md, aptus_old, aptus_new = run_company(
        "APTUS",
        "APTUS Reference Salary Sheet June 2026.xls",
        "golden-aptus-june-2026.json",
    )
    parts.append(nkpl_md)
    parts.append(aptus_md)
    parts.append("## Summary")
    parts.append("")
    parts.append(
        f"| Company | Old net total | New net total | Δ |\n"
        f"|---|---:|---:|---:|\n"
        f"| NKPL | {nkpl_old:.2f} | {nkpl_new:.2f} | {nkpl_new - nkpl_old:+.2f} |\n"
        f"| APTUS | {aptus_old:.2f} | {aptus_new:.2f} | {aptus_new - aptus_old:+.2f} |"
    )
    parts.append("")
    parts.append("### Notes for payroll sign-off")
    parts.append("")
    parts.append(
        "1. **Advance (T-06):** archive stored negative advances; engine now stores positive recovery. "
        "For Ashok / Kajal / Jayanta / Biswasundar / Piku the *recovery amount* is unchanged once data is migrated."
    )
    parts.append(
        "2. **ESI (ADR-0002):** Reference ESI moved from earned salary to gross payable (July 24 rework, live as `9425051`)."
    )
    parts.append(
        "3. **P-Tax (T-15 open):** PUNIT SODHANI and Nawneet Sodhani show ₹0 in archive vs slab ₹200 in engine — "
        "needs business confirmation of exemption vs arrears."
    )
    parts.append("")
    out = ARCHIVE / "JUNE-DIFF-ATTRIBUTION.md"
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {out}")
    print(f"NKPL Δ {nkpl_new - nkpl_old:+.2f}  APTUS Δ {aptus_new - aptus_old:+.2f}")


if __name__ == "__main__":
    main()
