#!/usr/bin/env python3
"""
Batch Patent Splitter
=====================
Reads a Google Patents search-export CSV and runs patent_splitter.py
for every URL found in the "result link" column (column I / index 8).

A configurable pause is inserted between requests to avoid rate-limiting.

Usage:
    python run_batch.py gp-search-20260228-050924.csv
    python run_batch.py gp-search-20260228-050924.csv --output-dir ./MyFolder --delay 3
"""

import argparse
import csv
import sys
import time

# ---------------------------------------------------------------------------
# Import the single-patent logic from patent_splitter.py (must be in the
# same directory or on PYTHONPATH).
# ---------------------------------------------------------------------------
from patent_splitter import (
    normalize_url,
    extract_patent_id,
    fetch_html,
    parse_patent,
    save_sections,
)

RESULT_LINK_COL = 8  # column I (0-indexed)


def read_urls(csv_path: str) -> list[dict]:
    """Return a list of {id, url} dicts from the CSV's result-link column."""
    urls = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            # Row 0 = search-URL metadata, Row 1 = headers — skip both
            if i < 2:
                continue
            if len(row) <= RESULT_LINK_COL:
                continue
            url = row[RESULT_LINK_COL].strip()
            patent_id = row[0].strip() if row[0] else ""
            if url:
                urls.append({"id": patent_id, "url": url})
    return urls


def process_patent(url: str, output_dir: str) -> bool:
    """Fetch, parse, and save one patent. Returns True on success."""
    try:
        url = normalize_url(url)
        patent_id = extract_patent_id(url)

        print(f"  Fetching {url} ...")
        html = fetch_html(url)
        print(f"  Downloaded {len(html):,} bytes")

        sections = parse_patent(html)
        title = sections.get("title", "(no title)")
        print(f"  Title: {title}")

        print("  Writing files:")
        save_sections(sections, output_dir, patent_id)
        return True

    except Exception as exc:
        print(f"  ✗ ERROR: {exc}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Run patent_splitter for every URL in a Google Patents CSV export."
    )
    parser.add_argument("csv", help="Path to the Google Patents search CSV")
    parser.add_argument(
        "-o", "--output-dir",
        default="./PatentData",
        help="Output directory for all section files (default: ./PatentData/)",
    )
    parser.add_argument(
        "-d", "--delay",
        type=float,
        default=2.0,
        help="Seconds to pause between patents (default: 2)",
    )
    args = parser.parse_args()

    entries = read_urls(args.csv)
    total = len(entries)
    if total == 0:
        sys.exit("No URLs found in the CSV.")

    print(f"\n{'='*60}")
    print(f"  Batch Patent Splitter")
    print(f"{'='*60}")
    print(f"  CSV:       {args.csv}")
    print(f"  Patents:   {total}")
    print(f"  Output:    {args.output_dir}/")
    print(f"  Delay:     {args.delay}s between requests")
    print(f"{'='*60}\n")

    successes = 0
    failures = []

    for idx, entry in enumerate(entries, start=1):
        print(f"[{idx}/{total}] {entry['id']}")
        ok = process_patent(entry["url"], args.output_dir)
        if ok:
            successes += 1
        else:
            failures.append(entry["id"])

        # Pause before the next request (skip after the last one)
        if idx < total:
            print(f"  (waiting {args.delay}s ...)\n")
            time.sleep(args.delay)
        else:
            print()

    # Summary
    print(f"{'='*60}")
    print(f"  Done!  {successes}/{total} succeeded.")
    if failures:
        print(f"  Failed: {', '.join(failures)}")
    print(f"  Files saved to: {args.output_dir}/")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
