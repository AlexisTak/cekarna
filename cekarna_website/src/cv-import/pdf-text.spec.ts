import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PdfTextError,
  assertTextLayer,
  groupIntoLines,
  isPdfBuffer,
  readPdfText,
} from './pdf-text';

export function sampleCvPdf(): Buffer {
  return Buffer.from(
    readFileSync(join(__dirname, '__fixtures__', 'cv-exemple.pdf.b64'), 'utf8'),
    'base64',
  );
}

describe('lecture de la couche texte PDF', () => {
  it('reconnaît la signature PDF', () => {
    expect(isPdfBuffer(sampleCvPdf())).toBe(true);
    expect(isPdfBuffer(Buffer.from('GIF89a'))).toBe(false);
  });

  it('ordonne les fragments de haut en bas puis de gauche à droite', () => {
    const lines = groupIntoLines([
      { str: 'monde', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Bonjour ', transform: [1, 0, 0, 1, 10, 700] },
      { str: 'Titre', transform: [1, 0, 0, 1, 10, 780] },
    ]);
    expect(lines).toEqual(['Titre', 'Bonjour monde']);
  });

  it('refuse un fichier qui n’est pas un PDF', async () => {
    await expect(readPdfText(Buffer.from('texte brut'))).rejects.toMatchObject({
      reason: 'not-a-pdf',
    });
  });

  it('refuse un PDF sans couche texte au lieu de deviner', () => {
    expect(() => assertTextLayer([{ page: 1, lines: ['court'] }])).toThrow(
      PdfTextError,
    );
  });

  it('restitue les lignes du CV dans l’ordre de lecture', async () => {
    const pages = await readPdfText(sampleCvPdf());
    expect(pages).toHaveLength(1);
    expect(pages[0].lines).toEqual([
      'Marie Dupont',
      'Developpeuse web',
      '75011 Paris',
      'Recherche CDI',
      'Competences',
      'JavaScript, TypeScript, Node.js',
      'Profil',
      'Cinq ans de developpement web.',
    ]);
  });
});
