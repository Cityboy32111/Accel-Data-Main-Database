// Page-level text extraction from the PDF text layer. Pages with too little
// text are reported so the pipeline can route them to OCR (Milestone 2 adds
// the OCR fallback; here they are flagged, never silently dropped).

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageText {
  pageNumber: number;
  text: string;
  textMethod: "text_layer" | "none";
  charCount: number;
}

export const MIN_TEXT_LAYER_CHARS = 40;

export async function extractPdfText(bytes: Uint8Array): Promise<{ pageCount: number; pages: PageText[] }> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise;
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      if (item.str) line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) {
        line += " ";
      }
    }
    if (line) lines.push(line);
    const text = lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    pages.push({
      pageNumber: i,
      text,
      textMethod: text.length >= MIN_TEXT_LAYER_CHARS ? "text_layer" : "none",
      charCount: text.length,
    });
    page.cleanup();
  }
  await doc.destroy();
  return { pageCount: doc.numPages, pages };
}
