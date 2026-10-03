import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export const INTAKE_CHANNELS = ['email', 'portal', 'mobile', 'phone', 'internal'] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

/** Normalized message every channel adapter must produce, whatever its source protocol. */
export class IntakeMessageDto {
  /** The source system's unique ID for this message (email Message-ID, portal submission ID, call ID). */
  @IsString() @Length(1, 200) @Matches(/^[\x21-\x7e]+$/) messageId!: string;
  /** Opaque customer reference resolved by the adapter; never raw account, card or national-ID numbers. */
  @IsString() @Length(8, 255) senderReference!: string;
  @IsString() @Length(1, 200) subject!: string;
  /** Plain text only. HTML must be stripped by the adapter; the UI also renders it as text. */
  @IsString() @Length(1, 20000) body!: string;
  @IsOptional() @IsString() @Length(2, 80) category?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'critical']) priority?: string;
}
