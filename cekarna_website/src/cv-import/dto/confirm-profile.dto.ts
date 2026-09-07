import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { FieldSource } from '../cv-import.types';

/** Longueur maximale acceptée pour une valeur de profil corrigée. */
export const MAX_FIELD_LENGTH = 2000;

export class ConfirmedFieldDto {
  @IsString()
  @MaxLength(MAX_FIELD_LENGTH)
  value!: string;

  /**
   * `extracted` : valeur issue du CV, vérifiée contre le document.
   * `manual` : valeur saisie par la personne, conservée telle quelle.
   */
  @IsIn(['extracted', 'manual'])
  source!: FieldSource;
}

export class ProfileFieldsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  firstName?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  lastName?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  email?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  phone?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  title?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  city?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  contract?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  skills?: ConfirmedFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmedFieldDto)
  about?: ConfirmedFieldDto;
}

export class ConfirmProfileDto {
  @IsUUID()
  documentId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ProfileFieldsDto)
  fields!: ProfileFieldsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  experiences?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  education?: number[];
}
