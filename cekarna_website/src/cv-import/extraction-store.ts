import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PageText } from './cv-import.types';

/** Jeton d'injection de l'horloge, remplaçable dans les tests. */
export const CLOCK = 'CLOCK';

export type Clock = () => number;

export interface StoredDocument {
  documentId: string;
  ownerId: string;
  pages: PageText[];
  /** Texte normalisé, utilisé pour vérifier qu'une valeur retenue vient bien du document. */
  normalizedText: string;
  expiresAt: number;
}

/** Plafond du nombre de documents conservés simultanément en mémoire. */
const MAX_DOCUMENTS = 200;

/** Normalise casse, accents et espaces pour comparer un texte à son document source. */
export function normalizeForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Conserve le texte des CV analysés le temps de la correction manuelle.
 * Stockage en mémoire volontairement : rien n'est écrit sur disque ni en base,
 * et tout expire au bout du délai configuré.
 */
@Injectable()
export class ExtractionStore {
  private readonly documents = new Map<string, StoredDocument>();

  constructor(@Inject(CLOCK) private readonly now: Clock) {}

  save(
    pages: PageText[],
    retentionSeconds: number,
    ownerId = 'test-owner',
  ): StoredDocument {
    this.purge();
    if (this.documents.size >= MAX_DOCUMENTS) {
      const oldest = this.documents.keys().next();
      if (!oldest.done) this.documents.delete(oldest.value);
    }
    const document: StoredDocument = {
      documentId: randomUUID(),
      ownerId,
      pages,
      normalizedText: normalizeForComparison(
        pages.flatMap((page) => page.lines).join(' '),
      ),
      expiresAt: this.now() + retentionSeconds * 1000,
    };
    this.documents.set(document.documentId, document);
    return document;
  }

  find(documentId: string, ownerId = 'test-owner'): StoredDocument | undefined {
    this.purge();
    const document = this.documents.get(documentId);
    return document?.ownerId === ownerId ? document : undefined;
  }

  forget(documentId: string): void {
    this.documents.delete(documentId);
  }

  private purge(): void {
    const now = this.now();
    for (const [id, document] of this.documents)
      if (document.expiresAt <= now) this.documents.delete(id);
  }
}
