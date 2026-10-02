import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CommunicationDeliveryReceiptDto {
  @IsString() @Length(2, 80) provider!: string;
  @IsString() @Length(1, 160) providerMessageId!: string;
  @IsIn(['sent', 'delivered', 'failed']) status!: 'sent' | 'delivered' | 'failed';
  @IsOptional() @IsString() @Length(1, 80) @Matches(/^[A-Za-z0-9._:-]+$/) failureCode?: string;
}
