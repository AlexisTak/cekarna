// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CvImport from './CvImport';
import { CvImportError, confirmProfile, extractCv } from './cv-import-api';
import type { CvExtraction } from './cv-import-api';
import { emptyWorkspace, type Profile } from './domain';

vi.mock('./cv-import-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cv-import-api')>();
  return { ...actual, extractCv: vi.fn(), confirmProfile: vi.fn() };
});

const extractMock = vi.mocked(extractCv);
const confirmMock = vi.mocked(confirmProfile);
const roots: Root[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const EXTRACTION: CvExtraction = {
  documentId: 'b3f1c0de-0000-4000-8000-000000000000',
  expiresAt: '2026-09-06T12:15:00.000Z',
  pageCount: 1,
  pages: [{ page: 1, lines: ['Marie Dupont', '75011 Paris'] }],
  fields: [
    {
      field: 'firstName',
      candidates: [
        {
          value: 'Marie',
          rule: 'nom-en-tete',
          excerpts: [
            { page: 1, line: 1, text: 'Marie Dupont', start: 0, end: 5 },
          ],
        },
      ],
    },
    {
      field: 'title',
      candidates: [],
      reason: 'Aucun intitulé de poste repéré sous le nom ni après un libellé.',
    },
    {
      field: 'city',
      candidates: [
        {
          value: 'Paris',
          rule: 'ville-code-postal',
          excerpts: [
            { page: 1, line: 2, text: '75011 Paris', start: 6, end: 11 },
          ],
        },
      ],
    },
    { field: 'contract', candidates: [] },
    { field: 'skills', candidates: [] },
    { field: 'about', candidates: [] },
  ],
};

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

async function selectFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Champ de fichier absent');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function choosePdf(container: HTMLElement): Promise<void> {
  return selectFile(
    container,
    new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
  );
}

function click(container: HTMLElement, text: string): Promise<void> {
  const target = [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.trim().startsWith(text),
  );
  if (!target) throw new Error(`Bouton introuvable : ${text}`);
  return act(async () => {
    target.click();
  });
}

describe('CvImport', () => {
  let profile: Profile;

  beforeEach(() => {
    vi.clearAllMocks();
    profile = emptyWorkspace().profile;
    extractMock.mockResolvedValue(EXTRACTION);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = '';
  });

  it('montre chaque proposition avec sa ligne source surlignée', async () => {
    const container = await render(
      <CvImport current={profile} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await choosePdf(container);

    expect(container.textContent).toContain('Marie');
    const marks = [...container.querySelectorAll('mark')].map(
      (mark) => mark.textContent,
    );
    expect(marks).toEqual(['Marie', 'Paris']);
    expect(container.querySelector('.excerpt-origin')?.textContent).toBe(
      'page 1, ligne 1',
    );
  });

  it('explique pourquoi un champ reste sans proposition', async () => {
    const container = await render(
      <CvImport current={profile} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await choosePdf(container);

    expect(container.textContent).toContain(
      'Aucun intitulé de poste repéré sous le nom ni après un libellé.',
    );
  });

  it('envoie les propositions retenues avec leur origine', async () => {
    confirmMock.mockResolvedValue({
      profile: { ...profile, firstName: 'Marie', city: 'Paris' },
      provenance: {
        firstName: 'extracted',
        title: 'empty',
        city: 'extracted',
        contract: 'empty',
        skills: 'empty',
        about: 'empty',
      },
    });
    const onApply = vi.fn();
    const container = await render(
      <CvImport current={profile} onApply={onApply} onCancel={vi.fn()} />,
    );
    await choosePdf(container);
    await click(container, 'Enregistrer ce profil');

    expect(confirmMock).toHaveBeenCalledWith(EXTRACTION.documentId, {
      firstName: { value: 'Marie', source: 'extracted' },
      city: { value: 'Paris', source: 'extracted' },
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Marie', city: 'Paris' }),
    );
  });

  it('n’envoie pas un champ que la personne laisse vide', async () => {
    confirmMock.mockResolvedValue({
      profile,
      provenance: {
        firstName: 'empty',
        title: 'empty',
        city: 'empty',
        contract: 'empty',
        skills: 'empty',
        about: 'empty',
      },
    });
    const container = await render(
      <CvImport current={profile} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await choosePdf(container);

    for (const label of container.querySelectorAll('.cv-radio'))
      if (label.textContent?.includes('Laisser vide'))
        await act(async () => {
          label.querySelector('input')?.click();
        });
    await click(container, 'Enregistrer ce profil');

    expect(confirmMock).toHaveBeenCalledWith(EXTRACTION.documentId, {});
  });

  it('affiche le refus du serveur sans appliquer le profil', async () => {
    confirmMock.mockRejectedValue(
      new CvImportError(400, 'Le champ « city » contient du texte absent du CV'),
    );
    const onApply = vi.fn();
    const container = await render(
      <CvImport current={profile} onApply={onApply} onCancel={vi.fn()} />,
    );
    await choosePdf(container);
    await click(container, 'Enregistrer ce profil');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'texte absent du CV',
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it('refuse un fichier qui n’est pas un PDF sans appeler le service', async () => {
    const container = await render(
      <CvImport current={profile} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await selectFile(
      container,
      new File(['x'], 'cv.png', { type: 'image/png' }),
    );

    expect(extractMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Choisissez un fichier PDF.',
    );
  });
});
