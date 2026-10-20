import { IsIn, IsNumber, IsString, Length, Max, Min } from 'class-validator';
import { ATTACHMENT_CONTENT_TYPES } from '../tickets/ticket.dto.js';

export class CreatePortalRequestDto {
  @IsIn(['request', 'complaint', 'correction']) kind!: 'request' | 'complaint' | 'correction';
  @IsString() @Length(3, 200) subject!: string;
  @IsString() @Length(3, 5000) description!: string;
}
export class PortalMessageDto { @IsString() @Length(1, 5000) body!: string; }
export class PortalAttachmentDto {
  @IsString() @Length(1, 255) filename!: string;
  @IsIn(ATTACHMENT_CONTENT_TYPES) contentType!: (typeof ATTACHMENT_CONTENT_TYPES)[number];
  @IsNumber() @Min(1) @Max(26214400) sizeBytes!: number;
}
