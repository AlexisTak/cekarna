import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENVIRONMENT } from '../config/environment';
import type { Environment } from '../config/environment';
import {
  CONTRACTS,
  ConfirmedProfile,
  Contract,
  CvExtraction,
  FieldSource,
  PROFILE_FIELDS,
  PageText,
  ProfileField,
} from './cv-import.types';
import {
  ConfirmProfileDto,
  ConfirmedFieldDto,
} from './dto/confirm-profile.dto';
import { ExtractionStore, StoredDocument } from './extraction-store';
import { PdfTextError, readPdfText } from './pdf-text';
import { extractProfileFields } from './profile-extractor';

export interface UploadedPdf {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

@Injectable()
export class CvImportService {
  constructor(
    private readonly store: ExtractionStore,
    @Inject(ENVIRONMENT) private readonly config: Environment,
  ) {}

  /**
   * Analyse un CV PDF textuel et propose des valeurs de profil, chacune
   * accompagnée de ses extraits. Rien n'est enregistré à cette étape.
   */
  async extract(file: UploadedPdf | undefined): Promise<CvExtraction> {
    const buffer = file?.buffer;
    if (!buffer?.length)
      throw new BadRequestException('Aucun fichier PDF reçu.');
    if (buffer.length > this.config.cvImportMaxBytes)
      throw new PayloadTooLargeException(
        `Le CV dépasse la taille maximale de ${this.config.cvImportMaxBytes} octets.`,
      );
    if (file?.mimetype && file.mimetype !== 'application/pdf')
      throw new BadRequestException('Seuls les fichiers PDF sont acceptés.');

    const pages = await this.readPages(buffer);
    const document = this.store.save(
      pages,
      this.config.cvImportRetentionSeconds,
    );
    return {
      documentId: document.documentId,
      expiresAt: new Date(document.expiresAt).toISOString(),
      pageCount: pages.length,
      pages,
      fields: extractProfileFields(pages),
    };
  }

  /**
   * Valide le profil corrigé par la personne. Toute valeur déclarée issue du CV
   * doit se retrouver littéralement dans le document : rien n'est complété ici.
   */
  confirmProfile(dto: ConfirmProfileDto): ConfirmedProfile {
    const document = this.store.find(dto.documentId);
    if (!document)
      throw new BadRequestException(
        'Analyse inconnue ou expirée. Importer le CV à nouveau.',
      );

    const profile = {} as Record<ProfileField, string>;
    const provenance = {} as Record<ProfileField, FieldSource | 'empty'>;
    for (const field of PROFILE_FIELDS) {
      const submitted: ConfirmedFieldDto | undefined = dto.fields[field];
      const value = submitted?.value.trim() ?? '';
      if (!submitted || !value) {
        profile[field] = '';
        provenance[field] = 'empty';
        continue;
      }
      this.assertAcceptable(field, value, submitted.source, document);
      profile[field] = value;
      provenance[field] = submitted.source;
    }

    this.store.forget(dto.documentId);
    return { profile, provenance };
  }

  private async readPages(buffer: Buffer): Promise<PageText[]> {
    try {
      return await readPdfText(buffer);
    } catch (error) {
      if (!(error instanceof PdfTextError)) throw error;
      if (error.reason === 'not-a-pdf')
        throw new BadRequestException(error.message);
      throw new UnprocessableEntityException(error.message);
    }
  }

  private assertAcceptable(
    field: ProfileField,
    value: string,
    source: FieldSource,
    document: StoredDocument,
  ): void {
    if (field === 'contract' && !CONTRACTS.includes(value as Contract))
      throw new BadRequestException(
        `Le contrat doit faire partie de : ${CONTRACTS.join(', ')}.`,
      );
    if (source !== 'extracted') return;

    const proposed =
      extractProfileFields(document.pages)
        .find((entry) => entry.field === field)
        ?.candidates.some((candidate) => candidate.value === value) ?? false;
    const supported =
      proposed ||
      document.pages.some((page) =>
        page.lines.some((line) => line.includes(value)),
      );
    if (!supported)
      throw new BadRequestException(
        `Le champ « ${field} » ne correspond pas à un extrait littéral du CV. Le déclarer en saisie manuelle si la valeur est volontaire.`,
      );
  }
}
