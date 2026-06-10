import re

import fitz  # PyMuPDF

MAX_WORDS = 8_000


def parse_pdf(data: bytes) -> str:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Could not open PDF: {exc}") from exc

    pages: list[str] = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        if text:
            pages.append(f"[Page {i + 1}]\n{text}")
    doc.close()

    combined = "\n\n".join(pages)
    combined = re.sub(r" {2,}", " ", combined)
    combined = re.sub(r"\n{3,}", "\n\n", combined)

    words = combined.split()
    if len(words) > MAX_WORDS:
        combined = " ".join(words[:MAX_WORDS]) + f"\n\n[Truncated — document exceeded {MAX_WORDS} words]"

    return combined.strip()
