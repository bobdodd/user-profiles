#!/usr/bin/env python3
"""Render docs/user-profiles.md to an accessible Word document.

Pandoc gets most of the way on its own — in particular it marks the first row of
every table with <w:tblHeader/>, so header rows repeat across page breaks and are
exposed to assistive technology as headers rather than as ordinary cells. That is
the single most important thing in a document which is almost entirely tables,
and it is worth verifying rather than assuming, so this script fails loudly if
any table lacks it.

Three things pandoc does not do, all of which Word's Accessibility Checker or a
screen-reader user will notice:

  1. dc:title is left empty. The Accessibility Checker flags a missing document
     title, and a title is what a screen reader announces when the document
     opens. Set from the H1.

  2. No page size is emitted, so Word falls back to portrait. This document's
     comparison table is seven columns wide; on portrait Letter it is unreadable.
     Landscape with narrow margins gives the tables room.

  3. No document language. Without w:lang a screen reader reads the document in
     whatever voice it happens to be using, which mangles pronunciation.

Usage:
    python3 docs/tools/make-profiles-docx.py            # from the repo root
    python3 docs/tools/make-profiles-docx.py --md X --out Y

Rebuild pipeline:
    npm run docs:profiles        # regenerate the markdown from the models
    npm run docs:profiles-docx   # then this
"""
import argparse
import pathlib
import re
import shutil
import subprocess
import sys
import zipfile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# US Letter, landscape, in twentieths of a point. 15840 x 12240 = 11" x 8.5".
PG_SZ = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
# Half-inch margins all round: the tables need the width more than the page
# needs whitespace.
PG_MAR = ('<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" '
          'w:header="432" w:footer="432" w:gutter="0"/>')

LANG = "en-CA"


def build(md: pathlib.Path, out: pathlib.Path) -> None:
    cmd = [
        "pandoc", str(md),
        "--from", "gfm",
        "--toc", "--toc-depth=2",
        "--metadata", f"lang={LANG}",
        "-o", str(out),
    ]
    subprocess.run(cmd, check=True)
    print(f"pandoc -> {out}")


def set_page_landscape(doc: str) -> tuple[str, bool]:
    """Insert pgSz/pgMar into the body sectPr.

    OOXML fixes the child order of sectPr (footnotePr, endnotePr, type, pgSz,
    pgMar, ...), so these go immediately before the closing tag — after anything
    pandoc already put there.
    """
    if "<w:pgSz" in doc:
        return doc, False
    m = re.search(r"</w:sectPr>", doc)
    if not m:
        # No sectPr at all: append a minimal one inside the body.
        doc = doc.replace("</w:body>", f"<w:sectPr>{PG_SZ}{PG_MAR}</w:sectPr></w:body>")
        return doc, True
    return doc[:m.start()] + PG_SZ + PG_MAR + doc[m.start():], True


def set_title(core: str, title: str) -> str:
    if re.search(r"<dc:title>[^<]+</dc:title>", core):
        return core
    return core.replace("<dc:title></dc:title>", f"<dc:title>{title}</dc:title>")


def set_language(styles: str) -> tuple[str, bool]:
    """Force the default run language, so the whole document is announced in one
    voice rather than whatever the reader defaults to."""
    if re.search(r'<w:lang w:val="[^"]+"', styles):
        styles = re.sub(r'<w:lang w:val="[^"]+"', f'<w:lang w:val="{LANG}"', styles, count=1)
        return styles, True
    m = re.search(r"(<w:rPrDefault>\s*<w:rPr>)", styles)
    if not m:
        return styles, False
    return styles[:m.end()] + f'<w:lang w:val="{LANG}"/>' + styles[m.end():], True


def verify(doc: str) -> list[str]:
    """Everything that would make this document worse for a screen-reader user."""
    problems = []

    tables = doc.count("<w:tbl>")
    headers = doc.count("<w:tblHeader")
    if tables and headers < tables:
        problems.append(
            f"{tables} tables but only {headers} marked with <w:tblHeader/>. "
            "Header rows would not repeat and would not be exposed as headers.")

    # Alt text, for the day this document gains a figure.
    images = doc.count("<pic:pic ")
    descrs = re.findall(r'<wp:docPr [^>]*descr="([^"]*)"', doc)
    bad = [d for d in descrs if not d.strip() or d.strip().lower().endswith((".png", ".jpg", ".svg"))]
    if images and (len(descrs) < images or bad):
        problems.append(f"{images} images, {len(descrs)} with alt text, suspect: {bad}")

    # A heading level must never be skipped.
    levels = [int(m) for m in re.findall(r'<w:pStyle w:val="Heading(\d)"\s*/?>', doc)]
    prev = 0
    for lvl in levels:
        if prev and lvl > prev + 1:
            problems.append(f"heading level jumps from {prev} to {lvl}")
            break
        prev = lvl

    return problems


def post_process(path: pathlib.Path, title: str) -> None:
    backup = path.with_suffix(".docx.bak")
    shutil.copyfile(path, backup)

    zin = zipfile.ZipFile(backup)
    names = set(zin.namelist())
    doc = zin.read("word/document.xml").decode("utf8")
    core = zin.read("docProps/core.xml").decode("utf8") if "docProps/core.xml" in names else None
    styles = zin.read("word/styles.xml").decode("utf8") if "word/styles.xml" in names else None

    doc, landscaped = set_page_landscape(doc)
    print(f"page: {'landscape Letter, 0.5in margins' if landscaped else 'already set'}")

    if core is not None:
        core = set_title(core, title)
        print(f'title: "{title}"')

    if styles is not None:
        styles, langed = set_language(styles)
        print(f"language: {LANG}" if langed else "language: could not set (no rPrDefault)")

    problems = verify(doc)

    zout = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            data = doc.encode("utf8")
        elif item.filename == "docProps/core.xml" and core is not None:
            data = core.encode("utf8")
        elif item.filename == "word/styles.xml" and styles is not None:
            data = styles.encode("utf8")
        zout.writestr(item, data)
    zout.close()
    zin.close()
    backup.unlink()

    tables = doc.count("<w:tbl>")
    levels = re.findall(r'<w:pStyle w:val="Heading(\d)"\s*/?>', doc)
    counts = {n: levels.count(n) for n in sorted(set(levels))}
    shape = ", ".join(f"H{n}x{c}" for n, c in counts.items())
    print(f"verified: {tables} tables, all with repeating header rows; "
          f"{len(levels)} headings ({shape})")
    if not levels:
        # A document with no headings has no navigable structure at all, which
        # for a 22-table reference document would be a serious regression. If
        # this ever fires it means pandoc changed its style names, not that the
        # markdown lost its headings.
        problems.append("no Heading styles found — the document has no navigable structure")

    if problems:
        print("\nACCESSIBILITY PROBLEMS:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)


def main() -> None:
    root = pathlib.Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", default=str(root / "docs" / "user-profiles.md"))
    ap.add_argument("--out", default=str(root / "docs" / "User capability profiles.docx"))
    args = ap.parse_args()

    md = pathlib.Path(args.md)
    out = pathlib.Path(args.out)
    if not md.exists():
        sys.exit(f"missing {md} — run `npm run docs:profiles` first")

    first = md.read_text(encoding="utf8").lstrip().splitlines()[0]
    title = first.lstrip("# ").strip() or out.stem

    build(md, out)
    post_process(out, title)
    print(f"\nOK: {out}  ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
