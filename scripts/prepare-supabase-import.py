"""Prepare a private, repeatable SQL import from reviewed organization candidates."""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re


def optional_text(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("An optional employee field must be text or null.")
    return value.strip() or None


def prepare_rows(payload):
    if payload.get("schema_version") != 1:
        raise ValueError("Unsupported source schema version.")
    source_name = payload.get("source_name")
    if not isinstance(source_name, str) or not source_name.strip():
        raise ValueError("Source workbook name is required.")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("No employee candidates were found.")

    rows = []
    seen = set()
    for candidate in candidates:
        name = candidate.get("full_name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Every candidate needs a name.")
        if "?" in name or re.search(r"\bTBA\b", name, re.I):
            raise ValueError("An unresolved name cannot become an employee candidate.")
        positions = candidate.get("positions")
        if not isinstance(positions, list) or not positions:
            raise ValueError("Every candidate needs source positions.")
        for position in positions:
            if not isinstance(position, dict) or not all(
                isinstance(position.get(key), str) and position[key].strip()
                for key in ("name", "org_path")
            ):
                raise ValueError("A source position is incomplete.")
        cells = candidate.get("source_cells")
        if not isinstance(cells, list) or not cells or not all(
            isinstance(cell, str) and re.fullmatch(r"Bagan Lengkap![A-Z]+[1-9][0-9]*", cell)
            for cell in cells
        ):
            raise ValueError("Source cell references are missing or invalid.")
        cells = sorted(set(cells))
        key = (source_name, tuple(cells), name)
        if key in seen:
            raise ValueError("Duplicate candidate source key.")
        seen.add(key)
        joined_on = optional_text(candidate.get("joined_on"))
        if joined_on:
            joined_on = date.fromisoformat(joined_on).isoformat()
        rows.append({
            "full_name": name,
            "employee_no": optional_text(candidate.get("employee_no")),
            "joined_on": joined_on,
            "employment_status": optional_text(candidate.get("employment_status")),
            "positions": positions,
            "source_name": source_name,
            "source_cells": cells,
            "notes": payload.get("notes") or None,
        })
    return rows


def build_sql(rows):
    data = json.dumps(rows, ensure_ascii=False, indent=2)
    digest = hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]
    tag = f"$sph_import_{digest}$"
    while tag in data:
        tag = tag[:-1] + "x$"
    source_literal = "'" + rows[0]["source_name"].replace("'", "''") + "'"
    return f"""-- Impor calon pegawai untuk ditinjau, dengan status PENDING.
-- Nomor pegawai, tanggal mulai, dan status kerja yang belum ada tetap kosong.
-- Menjalankan ulang berkas ini melewati baris yang sudah ada.
BEGIN;

WITH source_rows AS (
  SELECT * FROM jsonb_to_recordset(
{tag}
{data}
{tag}::jsonb
  ) AS x(
    full_name text, employee_no text, joined_on date, employment_status text,
    positions jsonb, source_name text, source_cells jsonb, notes text
  )
), inserted AS (
  INSERT INTO import_staging.employee_candidates (
    full_name, employee_no, joined_on, employment_status,
    positions, source_name, source_cells, notes
  )
  SELECT full_name, employee_no, joined_on, employment_status,
    positions, source_name, source_cells, notes
  FROM source_rows
  ON CONFLICT (source_name, source_cells, full_name) DO NOTHING
  RETURNING id
)
SELECT count(*) AS baris_baru_ditambahkan FROM inserted;

COMMIT;

SELECT count(*) AS jumlah_calon,
  count(*) FILTER (WHERE status = 'PENDING') AS menunggu_tinjauan
FROM import_staging.employee_candidates
WHERE source_name = {source_literal};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/imports/supabase/02-impor-pegawai.sql"))
    args = parser.parse_args()
    # Employee names belong in ignored local data, never in code migrations.
    data_root = Path(__file__).resolve().parents[1] / "data"
    if not args.out.resolve().is_relative_to(data_root) or args.out.suffix.lower() != ".sql":
        raise ValueError("Save the SQL import as a .sql file inside the local data directory.")
    payload = json.loads(args.source.read_text(encoding="utf-8"))
    rows = prepare_rows(payload)
    sql = build_sql(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(sql, encoding="utf-8")
    print(json.dumps({
        "candidates": len(rows),
        "unresolved_slots_not_imported": len(payload.get("unresolved", [])),
        "multiple_position_candidates": sum(len(row["positions"]) > 1 for row in rows),
        "output": str(args.out.resolve()),
        "bytes": len(sql.encode("utf-8")),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
