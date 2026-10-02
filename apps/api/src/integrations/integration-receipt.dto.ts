import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class IntegrationReceiptDto {
  @IsString() @Length(2, 80) externalSystem!: string;
  @IsString() @Length(2, 160) externalReference!: string;
  @IsIn(['accepted', 'rejected']) outcome!: 'accepted' | 'rejected';
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/i) payloadHash?: string;
}
