import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

// Only these placeholders exist, so a template can never pull other case data into a customer message.
const PLACEHOLDERS = /^(?:(?!\{\{)[\s\S]|\{\{(?:ticketRef|status)\}\})*$/;
// The body may also carry the secure upload link, which the system fills in for a document request.
const BODY_PLACEHOLDERS = /^(?:(?!\{\{)[\s\S]|\{\{(?:ticketRef|status|uploadLink)\}\})*$/;

export class UpsertCommunicationTemplateDto {
  @IsIn(['email', 'sms', 'portal']) channel!: 'email' | 'sms' | 'portal';
  @IsBoolean() active!: boolean;
  @IsBoolean() requiresApproval!: boolean;
  /** Subject line. Allowed placeholders: {{ticketRef}}, {{status}}. */
  @IsOptional() @IsString() @Length(1, 200) @Matches(PLACEHOLDERS, { message: 'Only {{ticketRef}} and {{status}} may be used as placeholders' }) subjectTemplate?: string;
  /** Message body. Allowed placeholders: {{ticketRef}}, {{status}}, {{uploadLink}}. */
  @IsOptional() @IsString() @Length(1, 5000) @Matches(BODY_PLACEHOLDERS, { message: 'Only {{ticketRef}}, {{status}} and {{uploadLink}} may be used as placeholders' }) bodyTemplate?: string;
}
