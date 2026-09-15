import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { LoadMode } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateLoadDto {
  @IsEnum(LoadMode)
  mode!: LoadMode;

  @IsOptional()
  @IsUUID()
  corridorId?: string;

  @IsOptional()
  @IsString()
  corridorCode?: string;

  @Type(() => Number)
  @IsNumber()
  originLat!: number;

  @Type(() => Number)
  @IsNumber()
  originLng!: number;

  @IsString()
  originAddress!: string;

  @Type(() => Number)
  @IsNumber()
  destLat!: number;

  @Type(() => Number)
  @IsNumber()
  destLng!: number;

  @IsString()
  destAddress!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  weightKg!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  volumeCft!: number;

  @IsString()
  cargoType!: string;

  @IsDateString()
  windowStart!: string;

  @IsDateString()
  windowEnd!: string;
}
