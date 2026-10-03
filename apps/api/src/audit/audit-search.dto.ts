import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AuditSearchQuery {
  @IsOptional() @IsString() @Length(1, 160) actor?: string;
  /** Prefix match, for example `ticket.` or `ticket.status_changed`. */
  @IsOptional() @IsString() @Length(1, 100) action?: string;
  @IsOptional() @IsIn(['success', 'denied']) outcome?: 'success' | 'denied';
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  /** Cursor: return events with a sequence lower than this (events are newest first). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before?: number;
}
