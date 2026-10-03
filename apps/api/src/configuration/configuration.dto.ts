import { IsBoolean, IsIn, IsInt, Max, Min, IsOptional, IsString, Length } from 'class-validator';

export class UpsertQueueDto {
  @IsString() @Length(2, 80) department!: string;
  @IsString() @Length(2, 50) legalEntity!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsBoolean() active!: boolean;
}

export class UpsertCategoryDto {
  @IsString() @Length(2, 80) defaultQueue!: string;
  @IsBoolean() active!: boolean;
  /** Cases in this category are complaints governed by this regulatory profile. */
  @IsOptional() @IsString() @Length(2, 60) regulatoryProfile?: string;
  /** Block customer communications by default (e.g. fraud / suspicious-matter investigations). */
  @IsOptional() @IsBoolean() blockCustomerCommunication?: boolean;
  /** Lifecycle used by tickets in this category (defaults to the standard workflow). */
  @IsOptional() @IsString() @Length(2, 60) workflowKey?: string;
  /** How long closed tickets in this category are kept before de-identification (default 7). */
  @IsOptional() @IsInt() @Min(1) @Max(99) retentionYears?: number;
}
