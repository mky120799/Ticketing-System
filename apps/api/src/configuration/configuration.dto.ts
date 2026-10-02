import { IsBoolean, IsIn, IsString, Length } from 'class-validator';

export class UpsertQueueDto {
  @IsString() @Length(2, 80) department!: string;
  @IsString() @Length(2, 50) legalEntity!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsBoolean() active!: boolean;
}

export class UpsertCategoryDto {
  @IsString() @Length(2, 80) defaultQueue!: string;
  @IsBoolean() active!: boolean;
}
