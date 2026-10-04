import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export const COMPLAINT_OUTCOMES = ['upheld', 'partially_upheld', 'not_upheld', 'withdrawn', 'resolved_by_agreement'] as const;
export const PRIVACY_OUTCOMES = ['corrected', 'corrected_with_statement', 'refused_with_reasons'] as const;
export const IDR_OUTCOMES = [...COMPLAINT_OUTCOMES, ...PRIVACY_OUTCOMES] as const;
export type IdrOutcome = (typeof IDR_OUTCOMES)[number];

export class ClassifyComplaintDto {
  @IsBoolean() isComplaint!: boolean;
  /** Required when marking a ticket as a complaint. */
  @IsOptional() @IsString() @Length(2, 60) profileKey?: string;
  @IsOptional() @IsBoolean() vulnerabilityFlag?: boolean;
  @IsOptional() @IsBoolean() systemicIssue?: boolean;
  @IsString() @Length(3, 500) reason!: string;
}

export class AfcaDto {
  @IsIn(['referred', 'open', 'closed']) status!: 'referred' | 'open' | 'closed';
  @IsOptional() @IsString() @Length(2, 60) @Matches(/^[A-Za-z0-9._-]+$/) reference?: string;
}

export class CommunicationBlockDto {
  @IsBoolean() blocked!: boolean;
  @IsString() @Length(3, 500) reason!: string;
}

export class UpsertRegulatoryProfileDto {
  @IsString() @Length(2, 160) label!: string;
  @IsString() @Length(2, 10) jurisdiction!: string;
  @IsInt() @Min(0) @Max(30) acknowledgeBusinessDays!: number;
  @IsInt() @Min(1) @Max(365) finalResponseCalendarDays!: number;
  @IsInt() @Min(0) @Max(60) atRiskDays!: number;
  @IsBoolean() active!: boolean;
}

export class SubjectAccessDto {
  /** The opaque customer reference the access request relates to (identity must already be verified by the bank). */
  @IsString() @Length(8, 255) reference!: string;
}

export class UpsertBusinessHoursDto {
  @IsString() @Length(3, 60) timezone!: string;
  /** Minutes after midnight local time, for example 540 = 09:00. */
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(1440) endMinute!: number;
  /** 0 = Sunday ... 6 = Saturday. */
  @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workingDays!: number[];
}

export class UpsertHolidayDto { @IsString() @Length(2, 120) name!: string; }
