import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CV_IMPORT_HARD_MAX_BYTES } from '../config/environment';
import type { ConfirmedProfile, CvExtraction } from './cv-import.types';
import { CvImportService } from './cv-import.service';
import type { UploadedPdf } from './cv-import.service';
import { ConfirmProfileDto } from './dto/confirm-profile.dto';
import { IdentityService } from './identity.service';

@Controller('v1/cv-import')
export class CvImportController {
  constructor(
    private readonly cvImport: CvImportService,
    private readonly identity: IdentityService,
  ) {}

  /** Analyse un CV PDF et renvoie des propositions justifiées par des extraits. */
  @Post('extraction')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CV_IMPORT_HARD_MAX_BYTES, files: 1 },
    }),
  )
  async extract(
    @UploadedFile() file?: UploadedPdf,
    @Headers('authorization') authorization?: string,
  ): Promise<CvExtraction> {
    return this.cvImport.extract(
      file,
      await this.identity.userId(authorization),
    );
  }

  /** Valide le profil corrigé avant enregistrement par l'appelant. */
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Body() body: ConfirmProfileDto,
    @Headers('authorization') authorization?: string,
  ): Promise<ConfirmedProfile> {
    return this.cvImport.confirmProfile(
      body,
      await this.identity.userId(authorization),
    );
  }
}
