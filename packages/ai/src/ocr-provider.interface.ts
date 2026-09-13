/**
 * OCR abstraction — locked in FINAL-INFRASTRUCTURE-ARCHITECTURE.md "OCR abstraction" (p.8).
 *
 * MVP does NOT call this: QuoteExtractionService (M4) passes documents straight to
 * AIProvider.extract() — a vision-capable LLM does OCR + structured extraction in one
 * pass, so no separate OCR container runs on the NAS (no GPU, keep it simple).
 *
 * This interface exists purely as the extension point: if real pilot-client scans turn
 * out to need a dedicated OCR pass first (e.g. Tesseract/PaddleOCR/Azure/Google OCR),
 * a new provider implements this and QuoteExtractionService gains an optional
 * pre-processing step — without changing anything else in the extraction pipeline.
 */
export interface OCRProvider {
  extractText(document: Buffer, mimeType: string): Promise<{
    text: string;
    pages?: { pageNumber: number; text: string }[];
    confidence?: number;
  }>;
}
