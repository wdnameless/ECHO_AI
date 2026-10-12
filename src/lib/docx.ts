import mammoth from "mammoth";

/**
 * Extracts plain text from a DOCX file locally using mammoth.
 * Runs completely locally without any network access.
 */
export async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // Pass both buffer (for Node) and arrayBuffer (for browser)
  const buffer = typeof Buffer !== "undefined" ? Buffer.from(arrayBuffer) : undefined;
  const input = buffer ? { buffer } : { arrayBuffer };
  const result = await mammoth.extractRawText(input);
  return (result.value || "").trim();
}
