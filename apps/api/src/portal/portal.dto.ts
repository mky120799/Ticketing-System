import { IsIn, IsString, Length } from 'class-validator';

export class CreatePortalRequestDto {
  @IsIn(['request', 'complaint', 'correction']) kind!: 'request' | 'complaint' | 'correction';
  @IsString() @Length(3, 200) subject!: string;
  @IsString() @Length(3, 5000) description!: string;
}
export class PortalMessageDto { @IsString() @Length(1, 5000) body!: string; }
