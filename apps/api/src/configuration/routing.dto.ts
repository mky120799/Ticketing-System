import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpsertQueueMemberDto {
  @IsBoolean() active!: boolean;
}

export class UpsertAssignmentRuleDto {
  @IsString() @Length(2, 80) queue!: string;
  @IsOptional() @IsString() @Length(2, 80) category?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'critical']) priority?: string;
  @IsIn(['least_loaded', 'round_robin']) strategy!: string;
  @IsInt() @Min(1) @Max(10000) sortOrder!: number;
  @IsBoolean() active!: boolean;
}

export class UpsertEscalationRuleDto {
  @IsString() @Length(2, 80) queue!: string;
  @IsIn(['first_response_overdue', 'breached']) trigger!: string;
  @IsString() @Length(2, 80) escalateToQueue!: string;
  @IsBoolean() raisePriority!: boolean;
  @IsBoolean() active!: boolean;
}
