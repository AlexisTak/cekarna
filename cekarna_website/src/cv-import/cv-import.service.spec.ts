import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Environment } from '../config/environment';
import { CvImportService } from './cv-import.service';
import { ExtractionStore } from './extraction-store';
import { sampleCvPdf } from './pdf-text.spec';

const CONFIG: Environment = {
  port: 3000,
  host: '127.0.0.1',
  corsOrigins: [],
  cvImportMaxBytes: 1_000_000,
  cvImportRetentionSeconds: 900,
};

function build(config: Environment = CONFIG): CvImportService {
  return new CvImportService(new ExtractionStore(Date.now), config);
}

describe('import de CV', () => {
  it('refuse une requête sans fichier', async () => {
    await expect(build().extract(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuse un fichier plus grand que la limite configurée', async () => {
    const service = build({ ...CONFIG, cvImportMaxBytes: 100 });
    await expect(
      service.extract({ buffer: sampleCvPdf(), mimetype: 'application/pdf' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('refuse un document sans couche texte plutôt que de deviner', async () => {
    await expect(
      build().extract({ buffer: Buffer.from('%PDF-1.4 sans texte') }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('renvoie des propositions accompagnées de leurs extraits', async () => {
    const extraction = await build().extract({
      buffer: sampleCvPdf(),
      mimetype: 'application/pdf',
    });
    expect(extraction.pageCount).toBe(1);
    expect(extraction.pages[0].lines[0]).toBe('Marie Dupont');
    const city = extraction.fields.find((field) => field.field === 'city');
    expect(city?.candidates[0]).toMatchObject({
      value: 'Paris',
      rule: 'ville-code-postal',
    });
    expect(city?.candidates[0].excerpts[0]).toMatchObject({
      page: 1,
      text: '75011 Paris',
    });
  });

  describe('confirmation du profil corrigé', () => {
    let service: CvImportService;
    let documentId: string;

    beforeEach(async () => {
      service = build();
      const extraction = await service.extract({
        buffer: sampleCvPdf(),
        mimetype: 'application/pdf',
      });
      documentId = extraction.documentId;
    });

    it('accepte une valeur présente dans le CV', () => {
      const result = service.confirmProfile({
        documentId,
        fields: { city: { value: 'Paris', source: 'extracted' } },
      });
      expect(result.profile.city).toBe('Paris');
      expect(result.provenance.city).toBe('extracted');
      expect(result.provenance.about).toBe('empty');
    });

    it('rejette une valeur annoncée comme extraite mais absente du CV', () => {
      expect(() =>
        service.confirmProfile({
          documentId,
          fields: { city: { value: 'Lyon', source: 'extracted' } },
        }),
      ).toThrow(BadRequestException);
    });

    it('rejette une liste de compétences dont un élément est ajouté', () => {
      expect(() =>
        service.confirmProfile({
          documentId,
          fields: {
            skills: { value: 'JavaScript, Kubernetes', source: 'extracted' },
          },
        }),
      ).toThrow(BadRequestException);
    });

    it('accepte une valeur assumée comme saisie manuelle', () => {
      const result = service.confirmProfile({
        documentId,
        fields: { city: { value: 'Lyon', source: 'manual' } },
      });
      expect(result.profile.city).toBe('Lyon');
      expect(result.provenance.city).toBe('manual');
    });

    it('refuse un contrat hors de la liste connue', () => {
      expect(() =>
        service.confirmProfile({
          documentId,
          fields: { contract: { value: 'Vacation', source: 'manual' } },
        }),
      ).toThrow(BadRequestException);
    });

    it('oublie le document après confirmation', () => {
      service.confirmProfile({ documentId, fields: {} });
      expect(() => service.confirmProfile({ documentId, fields: {} })).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('conservation du texte analysé', () => {
  it('oublie un document expiré', () => {
    let now = 1_000;
    const store = new ExtractionStore(() => now);
    const document = store.save([{ page: 1, lines: ['Marie Dupont'] }], 60);
    expect(store.find(document.documentId)).toBeDefined();
    now += 61_000;
    expect(store.find(document.documentId)).toBeUndefined();
  });

  it('normalise le texte pour comparer accents et casse', () => {
    const store = new ExtractionStore(Date.now);
    const document = store.save(
      [{ page: 1, lines: ['Accessibilité web'] }],
      60,
    );
    expect(document.normalizedText).toBe('accessibilite web');
  });
});
