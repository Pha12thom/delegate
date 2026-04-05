from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "COMPLETE_DOCUMENTATION.md"
DEFAULT_OUTPUT = ROOT / "Delegate_Complete_Documentation.pdf"


def inline_markup(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2">\1</link>', text)
    text = re.sub(r"`([^`]+)`", r'<font face="Courier">\1</font>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"_(.+?)_", r"<i>\1</i>", text)
    return text


def make_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="DocTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=colors.HexColor("#111827"),
            spaceAfter=14,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionHeading",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            spaceBefore=10,
            spaceAfter=8,
            textColor=colors.HexColor("#111827"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="SubHeading",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            spaceBefore=8,
            spaceAfter=6,
            textColor=colors.HexColor("#111827"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyDoc",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletDoc",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            leftIndent=14,
            bulletIndent=4,
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CodeDoc",
            parent=styles["Code"],
            fontName="Courier",
            fontSize=8,
            leading=10,
            backColor=colors.HexColor("#f3f4f6"),
            borderColor=colors.HexColor("#d1d5db"),
            borderWidth=0.5,
            borderPadding=6,
            borderRadius=2,
            spaceBefore=4,
            spaceAfter=8,
        )
    )
    return styles


def parse_markdown(md_text: str, styles):
    story = []
    lines = md_text.splitlines()
    i = 0
    in_code = False
    code_lang = ""
    code_buf: list[str] = []

    def flush_code():
        nonlocal code_buf, code_lang
        if not code_buf:
            return
        code_text = "\n".join(code_buf).rstrip()
        if code_lang:
            story.append(Paragraph(f"<b>{html.escape(code_lang)} block</b>", styles["SubHeading"]))
        story.append(Preformatted(code_text, styles["CodeDoc"]))
        code_buf = []
        code_lang = ""

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
                code_lang = stripped[3:].strip()
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        if not stripped:
            story.append(Spacer(1, 4))
            i += 1
            continue

        if stripped == "---":
            story.append(Spacer(1, 8))
            story.append(Paragraph("<font color='#9ca3af'>────────────────────────────</font>", styles["BodyDoc"]))
            story.append(Spacer(1, 8))
            i += 1
            continue

        if stripped.startswith("# "):
            story.append(Paragraph(inline_markup(stripped[2:].strip()), styles["DocTitle"]))
            i += 1
            continue

        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:].strip()), styles["SectionHeading"]))
            i += 1
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:].strip()), styles["SubHeading"]))
            i += 1
            continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            story.append(Paragraph(inline_markup(stripped[2:].strip()), styles["BulletDoc"], bulletText="•"))
            i += 1
            continue

        numbered = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if numbered:
            story.append(
                Paragraph(
                    inline_markup(numbered.group(2).strip()),
                    styles["BulletDoc"],
                    bulletText=f"{numbered.group(1)}.",
                )
            )
            i += 1
            continue

        # Merge consecutive paragraph lines.
        para_lines = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt or nxt.startswith(("# ", "## ", "### ", "- ", "* ", "```")) or re.match(r"^\d+\.\s+", nxt):
                break
            para_lines.append(nxt)
            i += 1
        paragraph_text = " ".join(para_lines)
        story.append(Paragraph(inline_markup(paragraph_text), styles["BodyDoc"]))

    if in_code:
        flush_code()

    return story


def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawRightString(doc.pagesize[0] - 1.5 * cm, 1.0 * cm, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf(source: Path, output: Path):
    styles = make_styles()
    md_text = source.read_text(encoding="utf-8")

    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=1.6 * cm,
        leftMargin=1.6 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.4 * cm,
        title="Delegate Complete Documentation",
        author="Delegate",
        subject="Project documentation",
    )

    story = [Paragraph("Delegate Complete Documentation", styles["DocTitle"]), Spacer(1, 8)]
    story.extend(parse_markdown(md_text, styles))
    story.append(PageBreak())
    story.append(Paragraph("End of documentation", styles["SubHeading"]))

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)


def main():
    parser = argparse.ArgumentParser(description="Generate a PDF from COMPLETE_DOCUMENTATION.md")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not SOURCE.exists():
        raise FileNotFoundError(f"Source file not found: {SOURCE}")

    build_pdf(SOURCE, args.output)
    print(str(args.output))


if __name__ == "__main__":
    main()
