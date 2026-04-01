#!/usr/bin/env python3
"""
Patent Section Splitter
=======================
Takes a Google Patents URL and saves each major section
(Abstract, Background, Field of Invention, Brief Description
of Drawings, Detailed Description, and Claims) into separate Markdown files.

All files are saved into a single ./PatentData folder (configurable with -o).
Filenames follow the pattern: section_PATENTNUMBER.md

Usage:
    python patent_splitter.py <google_patents_url> [--output-dir DIR]

Example:
    python patent_splitter.py https://patents.google.com/patent/US12547267B2/
    python patent_splitter.py https://patents.google.com/patent/US12547267B2/ --output-dir ./MyFolder
"""

import argparse
import os
import re
import sys
import textwrap

try:
    import requests
except ImportError:
    sys.exit("Error: 'requests' is required. Install it with:  pip install requests")

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Error: 'beautifulsoup4' is required. Install it with:  pip install beautifulsoup4")


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def normalize_url(url: str) -> str:
    """Ensure the URL points to the English version of the patent page."""
    url = url.strip().rstrip("/")
    # Accept various forms:
    #   https://patents.google.com/patent/US12547267B2
    #   https://patents.google.com/patent/US12547267B2/en
    if not re.match(r"https?://patents\.google\.com/patent/[A-Z0-9]+", url):
        sys.exit(f"Error: '{url}' does not look like a Google Patents URL.\n"
                 f"Expected format: https://patents.google.com/patent/US12345678B2")
    if not url.endswith("/en"):
        url += "/en"
    return url


def extract_patent_id(url: str) -> str:
    """Pull the patent ID (e.g. US12547267B2) from the URL."""
    m = re.search(r"/patent/([A-Z0-9]+)", url)
    return m.group(1) if m else "patent"


def extract_patent_number(patent_id: str) -> str:
    """Pull just the numeric portion from a patent ID (e.g. US12547267B2 → 12547267)."""
    m = re.search(r"(\d+)", patent_id)
    return m.group(1) if m else patent_id


# ---------------------------------------------------------------------------
# Fetching & parsing
# ---------------------------------------------------------------------------

def fetch_html(url: str) -> str:
    """Download the patent page HTML."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    # Google Patents serves UTF-8 but doesn't always declare it in headers,
    # causing requests to guess wrong (e.g. ISO-8859-1). Force UTF-8.
    resp.encoding = "utf-8"
    return resp.text


def clean_text(text: str) -> str:
    """Collapse whitespace runs, rejoin inline reference numbers, and strip blanks."""
    # Fix reference-number line breaks:  "touch screen \n112\n, display" → "touch screen 112, display"
    # Pattern: newline(s) + a short token (number, FIG. ref, letter) + newline(s)
    # surrounded by word chars or punctuation on either side.
    text = re.sub(
        r"[ \t]*\n+[ \t]*((?:FIG\.\s*)?\d+[A-Z]?(?:[a-z])?)\s*\n+[ \t]*",
        r" \1 ",
        text,
    )
    # Also catch trailing patterns like "module \n134\n" at sentence boundaries
    text = re.sub(
        r"[ \t]*\n+[ \t]*(\d+[A-Z]?(?:[a-z])?)[ \t]*\n+",
        r" \1\n",
        text,
    )
    # Collapse runs of spaces (but not newlines) into single space
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse 3+ newlines into double
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Clean up spaces around newlines
    text = re.sub(r" *\n *", "\n", text)
    # Remove spaces before punctuation (artifact of rejoined inline tags)
    text = re.sub(r" +([,;:.)\]])", r"\1", text)
    return text.strip()


def element_text(tag) -> str:
    """Get visible text from a BeautifulSoup tag, preserving paragraph breaks
    but keeping inline reference numbers (in <b>, <span>, etc.) on the same line."""
    from bs4 import NavigableString

    if tag is None:
        return ""
    BLOCK_TAGS = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6",
                  "li", "tr", "blockquote", "section", "article"}
    parts = []
    for child in tag.descendants:
        if child.name in BLOCK_TAGS and parts and parts[-1] != "\n\n":
            parts.append("\n\n")
        if isinstance(child, NavigableString) and child.strip():
            parts.append(child.strip())
            parts.append(" ")
    raw = "".join(parts)
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r" *\n *", "\n", raw)
    return clean_text(raw)


def parse_patent(html: str) -> dict:
    """
    Extract the key sections from a Google Patents HTML page.

    Returns a dict with keys:
        title, patent_id, abstract, field_of_invention,
        background, brief_description_of_drawings, claims
    Each value is a string (possibly empty if the section wasn't found).
    """
    soup = BeautifulSoup(html, "html.parser")

    result = {
        "title": "",
        "patent_id": "",
        "abstract": "",
        "field_of_invention": "",
        "background": "",
        "brief_description_of_drawings": "",
        "detailed_description": "",
        "claims": "",
    }

    # --- Title -----------------------------------------------------------
    title_tag = soup.find("meta", attrs={"name": "DC.title"})
    if title_tag:
        result["title"] = title_tag.get("content", "").strip()
    else:
        h1 = soup.find("h1")
        if h1:
            result["title"] = h1.get_text(strip=True)

    # --- Patent ID -------------------------------------------------------
    pub_tag = soup.find("meta", attrs={"name": "DC.identifier"})
    if pub_tag:
        result["patent_id"] = pub_tag.get("content", "").strip()

    # --- Abstract --------------------------------------------------------
    abstract_div = soup.find("div", class_="abstract")
    if abstract_div is None:
        # Fallback: look for a <section> or heading labeled "Abstract"
        for heading in soup.find_all(re.compile(r"^h[1-4]$")):
            if "abstract" in heading.get_text(strip=True).lower():
                abstract_div = heading.find_next_sibling()
                break
    if abstract_div:
        result["abstract"] = element_text(abstract_div)

    # --- Description (contains field, background, brief desc, etc.) ------
    desc_div = soup.find("div", class_="description")
    if desc_div is None:
        # Try <section itemprop="description">
        desc_div = soup.find(attrs={"itemprop": "description"})

    if desc_div:
        # Use a smarter text extraction that only breaks on block elements,
        # keeping inline reference numbers (in <b>/<span>) on the same line.
        desc_text = _block_aware_text(desc_div)
        result["field_of_invention"] = _extract_subsection(
            desc_text,
            start_headings=[
                "TECHNICAL FIELD",
                "FIELD OF THE INVENTION",
                "FIELD OF INVENTION",
                "FIELD",
            ],
            stop_headings=[
                "BACKGROUND",
                "SUMMARY",
                "BRIEF DESCRIPTION",
                "DETAILED DESCRIPTION",
                "DESCRIPTION OF",
            ],
        )
        result["background"] = _extract_subsection(
            desc_text,
            start_headings=[
                "BACKGROUND OF THE INVENTION",
                "BACKGROUND",
            ],
            stop_headings=[
                "SUMMARY",
                "BRIEF DESCRIPTION",
                "DETAILED DESCRIPTION",
                "DESCRIPTION OF",
            ],
        )
        result["brief_description_of_drawings"] = _extract_subsection(
            desc_text,
            start_headings=[
                "BRIEF DESCRIPTION OF THE DRAWINGS",
                "BRIEF DESCRIPTION OF DRAWINGS",
                "DESCRIPTION OF THE DRAWINGS",
                "DESCRIPTION OF DRAWINGS",
            ],
            stop_headings=[
                "DETAILED DESCRIPTION",
                "DESCRIPTION OF THE PREFERRED",
                "DESCRIPTION OF EMBODIMENTS",
                "DESCRIPTION OF THE EMBODIMENTS",
                "DETAILED DESCRIPTION OF",
                "SUMMARY",
            ],
        )
        result["detailed_description"] = _extract_subsection(
            desc_text,
            start_headings=[
                "DETAILED DESCRIPTION",
                "DETAILED DESCRIPTION OF THE INVENTION",
                "DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS",
                "DETAILED DESCRIPTION OF EMBODIMENTS",
                "DESCRIPTION OF THE PREFERRED EMBODIMENTS",
                "DESCRIPTION OF EMBODIMENTS",
            ],
            stop_headings=[
                "CLAIMS",
                "What is claimed is:",
                "What is claimed:",
                "I claim:",
                "We claim:",
            ],
        )

    # --- Claims ----------------------------------------------------------
    claims_div = soup.find("div", class_="claims")
    if claims_div is None:
        claims_div = soup.find(attrs={"itemprop": "claims"})
    if claims_div is None:
        for heading in soup.find_all(re.compile(r"^h[1-4]$")):
            if "claims" in heading.get_text(strip=True).lower():
                claims_div = heading.find_next_sibling()
                break
    if claims_div:
        result["claims"] = element_text(claims_div)

    # --- Fallback: full-text regex parsing if structured divs missing -----
    if not any([result["abstract"], result["claims"]]):
        full_text = soup.get_text("\n")
        if not result["abstract"]:
            result["abstract"] = _extract_subsection(
                full_text,
                start_headings=["Abstract"],
                stop_headings=["Description", "Claims", "Images", "Classifications"],
            )
        if not result["field_of_invention"]:
            result["field_of_invention"] = _extract_subsection(
                full_text,
                start_headings=["TECHNICAL FIELD", "FIELD OF THE INVENTION", "FIELD OF INVENTION"],
                stop_headings=["BACKGROUND", "SUMMARY", "BRIEF DESCRIPTION"],
            )
        if not result["background"]:
            result["background"] = _extract_subsection(
                full_text,
                start_headings=["BACKGROUND"],
                stop_headings=["SUMMARY", "BRIEF DESCRIPTION", "DETAILED DESCRIPTION"],
            )
        if not result["brief_description_of_drawings"]:
            result["brief_description_of_drawings"] = _extract_subsection(
                full_text,
                start_headings=["BRIEF DESCRIPTION OF THE DRAWINGS", "BRIEF DESCRIPTION OF DRAWINGS"],
                stop_headings=["DETAILED DESCRIPTION", "DESCRIPTION OF THE PREFERRED"],
            )
        if not result["detailed_description"]:
            result["detailed_description"] = _extract_subsection(
                full_text,
                start_headings=[
                    "DETAILED DESCRIPTION",
                    "DETAILED DESCRIPTION OF THE INVENTION",
                    "DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS",
                    "DESCRIPTION OF THE PREFERRED EMBODIMENTS",
                ],
                stop_headings=["CLAIMS", "What is claimed is:", "What is claimed:"],
            )
        if not result["claims"]:
            result["claims"] = _extract_subsection(
                full_text,
                start_headings=["Claims"],
                stop_headings=["Description", "Referenced by", "Patent Citations"],
            )

    return result


def _block_aware_text(tag) -> str:
    """Extract text from a tag, inserting newlines only at block-level boundaries.
    Inline elements (like <b> wrapping reference numbers) stay on the same line."""
    from bs4 import NavigableString

    BLOCK_TAGS = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6",
                  "li", "tr", "blockquote", "section", "article", "figcaption",
                  "heading"}
    parts = []
    for child in tag.descendants:
        if child.name in BLOCK_TAGS:
            parts.append("\n")
        # Only collect actual text nodes, not Tag.string (which would duplicate)
        if isinstance(child, NavigableString) and child.strip():
            parts.append(child.strip())
            parts.append(" ")
    raw = "".join(parts)
    # Collapse multiple spaces into one (but not newlines)
    raw = re.sub(r"[ \t]+", " ", raw)
    # Clean up spaces around newlines: " \n " → "\n"
    raw = re.sub(r" *\n *", "\n", raw)
    return clean_text(raw)


def _extract_subsection(text: str, start_headings: list, stop_headings: list) -> str:
    """
    Pull a subsection from free text using heading markers.

    Finds the first occurrence of any start_heading (case-insensitive line match)
    and collects text until the first occurrence of any stop_heading or end-of-text.
    """
    lines = text.split("\n")
    start_idx = None

    # Build regex patterns for start and stop
    start_pats = [re.compile(r"^\s*" + re.escape(h) + r"\s*$", re.IGNORECASE) for h in start_headings]
    stop_pats = [re.compile(r"^\s*" + re.escape(h), re.IGNORECASE) for h in stop_headings]

    for i, line in enumerate(lines):
        if start_idx is None:
            for pat in start_pats:
                if pat.match(line.strip()):
                    start_idx = i + 1  # skip the heading line itself
                    break
        elif start_idx is not None:
            for pat in stop_pats:
                if pat.match(line.strip()):
                    section = "\n".join(lines[start_idx:i])
                    return clean_text(section)

    if start_idx is not None:
        section = "\n".join(lines[start_idx:])
        return clean_text(section)

    return ""


# ---------------------------------------------------------------------------
# Markdown output
# ---------------------------------------------------------------------------

def write_section(filepath: str, body: str):
    """Write a single section to a markdown file (content only, no header)."""
    with open(filepath, "w", encoding="utf-8") as f:
        if body:
            f.write(body + "\n")
        else:
            f.write("*Section not found in the patent document.*\n")


def save_sections(sections: dict, output_dir: str, patent_id: str):
    """Save each patent section as a separate markdown file."""
    os.makedirs(output_dir, exist_ok=True)

    num = extract_patent_number(patent_id)

    files_map = {
        f"abstract_{num}.md": sections["abstract"],
        f"field_of_invention_{num}.md": sections["field_of_invention"],
        f"background_{num}.md": sections["background"],
        f"brief_description_of_drawings_{num}.md": sections["brief_description_of_drawings"],
        f"detailed_description_{num}.md": sections["detailed_description"],
        f"claims_{num}.md": sections["claims"],
    }

    created = []
    for filename, body in files_map.items():
        filepath = os.path.join(output_dir, filename)
        write_section(filepath, body)
        status = "✓" if body else "⚠ (empty)"
        created.append((filename, status))
        print(f"  {status}  {filepath}")

    return created


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Split a Google Patents page into separate Markdown files per section.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Example:
              python patent_splitter.py https://patents.google.com/patent/US12547267B2/
              python patent_splitter.py https://patents.google.com/patent/US12547267B2/ -o ./MyFolder
        """),
    )
    parser.add_argument("url", help="Google Patents URL (e.g. https://patents.google.com/patent/US12547267B2/)")
    parser.add_argument(
        "-o", "--output-dir",
        default="./PatentData",
        help="Output directory (default: ./PatentData/)",
    )
    args = parser.parse_args()

    url = normalize_url(args.url)
    patent_id = extract_patent_id(url)
    output_dir = args.output_dir

    print(f"\n{'='*60}")
    print(f"  Patent Section Splitter")
    print(f"{'='*60}")
    print(f"  URL:       {url}")
    print(f"  Patent ID: {patent_id}")
    print(f"  Output:    {output_dir}/")
    print(f"{'='*60}\n")

    print("Fetching patent page...")
    html = fetch_html(url)
    print(f"  Downloaded {len(html):,} bytes\n")

    print("Parsing sections...")
    sections = parse_patent(html)
    print(f"  Title: {sections['title']}\n")

    print("Writing files:")
    save_sections(sections, output_dir, patent_id)

    print(f"\nDone! Files saved to: {output_dir}/\n")


if __name__ == "__main__":
    main()
