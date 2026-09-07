import { dirname, join } from 'node:path';
import { PageText } from './cv-import.types';

/** Polices standard livrées avec pdfjs, requises pour lire les PDF sans police intégrée. */
function standardFontsDirectory(): string {
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  return `${join(root, 'standard_fonts')}/`;
}

/** Signature d'un fichier PDF, vérifiée avant tout appel à l'analyseur. */
const PDF_MAGIC = '%PDF-';
/** En dessous de ce nombre de caractères, le PDF est considéré sans couche texte. */
const MIN_TEXT_CHARACTERS = 40;
/** Écart vertical au delà duquel deux fragments appartiennent à des lignes différentes. */
const LINE_TOLERANCE = 2;

export type PdfTextReason = 'not-a-pdf' | 'unreadable' | 'no-text-layer';

export class PdfTextError extends Error {
  constructor(
    message: string,
    readonly reason: PdfTextReason,
  ) {
    super(message);
    this.name = 'PdfTextError';
  }
}

interface TextItem {
  str: string;
  transform: number[];
  width?: number;
}

const COLUMN_GAP = 48;

export function isPdfBuffer(data: Buffer): boolean {
  return data.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC;
}

/** Regroupe les fragments par ordonnée puis par abscisse pour reconstituer les lignes. */
export function groupIntoLines(items: TextItem[]): string[] {
  const rows: {
    y: number;
    parts: { x: number; str: string; width?: number }[];
  }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const row = rows.find(
      (candidate) => Math.abs(candidate.y - y) <= LINE_TOLERANCE,
    );
    if (row) row.parts.push({ x, str: item.str, width: item.width });
    else rows.push({ y, parts: [{ x, str: item.str, width: item.width }] });
  }
  const columnBoundaries: number[] = [];
  const rendered = rows
    .sort((left, right) => right.y - left.y)
    .flatMap((row) => {
      const segments: (typeof row.parts)[] = [];
      for (const part of row.parts.sort((left, right) => left.x - right.x)) {
        const segment = segments.at(-1);
        const previous = segment?.at(-1);
        const previousEnd =
          previous?.width === undefined
            ? undefined
            : previous.x + previous.width;
        if (
          segment &&
          previousEnd !== undefined &&
          part.x - previousEnd > COLUMN_GAP
        )
          segments.push([part]);
        else if (segment) segment.push(part);
        else segments.push([part]);
      }
      for (let index = 1; index < segments.length; index += 1)
        columnBoundaries.push(
          (segments[index - 1][0].x + segments[index][0].x) / 2,
        );
      return segments.map((segment) => ({
        y: row.y,
        x: segment[0].x,
        text: segment
          .map((part) => part.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
      }));
    })
    .filter((line) => line.text);

  if (columnBoundaries.length < 2) return rendered.map((line) => line.text);
  columnBoundaries.sort((left, right) => left - right);
  const boundary = columnBoundaries[Math.floor(columnBoundaries.length / 2)];

  const byReadingOrder = (
    left: (typeof rendered)[number],
    right: (typeof rendered)[number],
  ) => right.y - left.y || left.x - right.x;
  const leftColumn = rendered
    .filter((line) => line.x < boundary)
    .sort(byReadingOrder);
  const rightColumn = rendered
    .filter((line) => line.x >= boundary)
    .sort(byReadingOrder);
  return [...leftColumn, ...rightColumn].map((line) => line.text);
}

export function countCharacters(pages: PageText[]): number {
  return pages
    .flatMap((page) => page.lines)
    .join('')
    .replace(/\s/g, '').length;
}

export function assertTextLayer(pages: PageText[]): void {
  if (countCharacters(pages) < MIN_TEXT_CHARACTERS)
    throw new PdfTextError(
      'Ce PDF ne contient pas de texte sélectionnable. Fournir un CV exporté en texte : aucune lecture d’image n’est effectuée.',
      'no-text-layer',
    );
}

/**
 * Lit la couche texte d'un PDF, page par page. Aucun OCR : un PDF scanné est
 * refusé plutôt que deviné.
 */
export async function readPdfText(data: Buffer): Promise<PageText[]> {
  if (!isPdfBuffer(data))
    throw new PdfTextError('Le fichier fourni n’est pas un PDF.', 'not-a-pdf');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsDirectory(),
      verbosity: 0,
    }).promise;
  } catch {
    throw new PdfTextError(
      'Le PDF n’a pas pu être lu. Vérifier qu’il n’est ni protégé ni endommagé.',
      'unreadable',
    );
  }

  const pages: PageText[] = [];
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items: TextItem[] = content.items
        .filter(
          (item): item is Extract<typeof item, { str: string }> =>
            'str' in item,
        )
        .map((item) => ({
          str: item.str,
          transform: item.transform,
          width: item.width,
        }));
      pages.push({ page: number, lines: groupIntoLines(items) });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  assertTextLayer(pages);
  return pages;
}
