import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = "";
    for (const item of content.items) {
      if ("str" in item) {
        const y = (item as { transform?: number[] }).transform?.[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          parts.push(line);
          line = "";
        }
        line += item.str;
        lastY = y;
      }
    }
    if (line) parts.push(line);
  }
  return parts.join("\n");
}
