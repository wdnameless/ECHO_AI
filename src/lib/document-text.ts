import { extractDocxText } from "./docx";

/**
 * Extracts plain text from an uploaded document (PDF, DOCX, or plain text).
 */
export async function extractDocumentText(file: File): Promise<string> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isDocx =
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx");

  if (isPdf) {
    // Exception (platform-specific): pdfjs-dist touches DOMMatrix at import
    // time, which jsdom lacks — static import breaks 30 test suites.
    const { extractPdfText } = await import("./pdf");
    return extractPdfText(file);
  }
  if (isDocx) {
    return extractDocxText(file);
  }
  return file.text();
}
