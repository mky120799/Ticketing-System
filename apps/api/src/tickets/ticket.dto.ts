import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
const SENSITIVITIES = ['standard', 'confidential', 'restricted'] as const;

export class ReferenceDto {
  @IsIn(['customer', 'account', 'card', 'loan', 'transaction']) referenceType!: 'customer' | 'account' | 'card' | 'loan' | 'transaction';
  @IsString() @Length(2, 80) sourceSystem!: string;
  @IsString() @Length(8, 255) opaqueReference!: string;
}

export class CreateTicketDto {
  @IsString() @Length(2, 80) category!: string;
  @IsIn(PRIORITIES) priority!: (typeof PRIORITIES)[number];
  @IsIn(SENSITIVITIES) sensitivity!: (typeof SENSITIVITIES)[number];
  @IsString() @Length(2, 80) queue!: string;
  @IsString() @Length(2, 30) branchCode!: string;
  @IsString() @Length(2, 80) department!: string;
  @IsString() @Length(2, 50) legalEntity!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsString() @Length(3, 200) subject!: string;
  @IsString() @Length(3, 10000) description!: string;
  @IsOptional() @IsObject() customFields?: Record<string, string | number | boolean | null>;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ReferenceDto) references!: ReferenceDto[];
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(PRIORITIES) priority?: (typeof PRIORITIES)[number];
  @IsOptional() @IsString() @Length(3, 10000) description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, string | number | boolean | null>;
}

export class AssignTicketDto { @IsString() @Length(2, 80) queue!: string; @IsOptional() @IsString() @Length(3, 160) assigneeId?: string; }
export class ApprovalRequestDto { @IsString() @IsNotEmpty() @Length(2, 80) actionType!: string; }
export class ApprovalDecisionDto { @IsIn(['approved', 'rejected']) decision!: 'approved' | 'rejected'; }
export const TICKET_STATUSES = ['submitted', 'triage', 'assigned', 'in_progress', 'pending_customer', 'pending_external', 'pending_approval', 'escalated', 'resolved', 'closed', 'reopened', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export class AddNoteDto { @IsIn(['internal', 'customer']) visibility!: 'internal' | 'customer'; @IsString() @Length(1, 10000) body!: string; }
export const ROOT_CAUSES = ['process_gap', 'system_error', 'staff_error', 'customer_error', 'third_party', 'fraud_or_scam', 'policy_or_product', 'communication', 'other'] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];
export class TransitionTicketDto { @IsIn(TICKET_STATUSES) toStatus!: TicketStatus; @IsString() @Length(2, 500) reason!: string; @IsOptional() @IsIn(ROOT_CAUSES) rootCause?: RootCause; /** Required to resolve a complaint (the internal dispute resolution outcome). */ @IsOptional() @IsIn(['upheld', 'partially_upheld', 'not_upheld', 'withdrawn', 'resolved_by_agreement']) idrOutcome?: string; }
export const ATTACHMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'] as const;
export class CreateAttachmentDto {
  @IsString() @Length(1, 255) filename!: string;
  @IsIn(ATTACHMENT_CONTENT_TYPES) contentType!: (typeof ATTACHMENT_CONTENT_TYPES)[number];
  @IsNumber() @Min(1) @Max(26214400) sizeBytes!: number;
  @IsIn(['confidential', 'restricted']) classification!: 'confidential' | 'restricted';
}
export class CompleteAttachmentDto { @IsString() @Matches(/^[a-f0-9]{64}$/i) checksumSha256!: string; @IsNumber() @Min(1) @Max(26214400) sizeBytes!: number; }
export class LinkTicketDto { @IsUUID() targetTicketId!: string; @IsIn(['duplicate_of', 'related_to', 'parent_of']) relationshipType!: 'duplicate_of' | 'related_to' | 'parent_of'; }
export class CreateCommunicationDto { @IsIn(['email', 'sms', 'portal']) channel!: 'email' | 'sms' | 'portal'; @IsString() @Length(2, 100) templateKey!: string; @IsString() @Length(8, 255) recipientReference!: string; }
export class SearchTicketsQuery { @IsString() @Length(1, 80) q!: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 25; }
export class UpdateRetentionControlDto { @IsBoolean() legalHold!: boolean; @IsOptional() @IsDateString() retentionUntil?: string; @IsOptional() @IsString() @Length(3, 500) holdReason?: string; }
export class AttachmentScanResultDto { @IsIn(['clean', 'malicious', 'error']) result!: 'clean' | 'malicious' | 'error'; }
