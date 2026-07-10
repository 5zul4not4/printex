
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parses a page range string (e.g., "1-3, 5, 8-10") into an array of page numbers (0-indexed).
 * @param rangeString The string representing the page ranges.
 * @param maxPage The total number of pages in the document. Can be Infinity for unknown counts.
 * @returns An array of 0-indexed page numbers.
 */
export function parsePageRanges(rangeString: string, maxPage: number): number[] {
  const pages = new Set<number>();
  if (!rangeString) {
    if (maxPage === Infinity) return [];
    return Array.from({ length: maxPage }, (_, i) => i);
  }

  const parts = rangeString.split(',');

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (trimmedPart.includes('-')) {
      const [startStr, endStr] = trimmedPart.split('-').map(s => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          if (i > 0 && i <= maxPage) {
            pages.add(i - 1); // 0-indexed
          }
        }
      }
    } else {
      const page = parseInt(trimmedPart, 10);
      if (!isNaN(page) && page > 0 && page <= maxPage) {
        pages.add(page - 1); // 0-indexed
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}
