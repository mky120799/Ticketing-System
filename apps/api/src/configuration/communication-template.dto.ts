import { IsBoolean, IsIn } from 'class-validator';

export class UpsertCommunicationTemplateDto {
  @IsIn(['email', 'sms', 'portal']) channel!: 'email' | 'sms' | 'portal';
  @IsBoolean() active!: boolean;
  @IsBoolean() requiresApproval!: boolean;
}
