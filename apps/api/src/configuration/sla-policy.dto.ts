import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertSlaPolicyDto {
  @IsInt() @Min(1) @Max(525600) firstResponseMinutes!: number;
  @IsInt() @Min(1) @Max(525600) resolutionMinutes!: number;
  @IsBoolean() active!: boolean;
  /** `business` counts working hours (see business hours and holidays); `wall` counts every minute. Default wall. */
  @IsOptional() @IsIn(['wall', 'business']) calendar?: 'wall' | 'business';
  /** Stop the clock while the case waits for the customer. */
  @IsOptional() @IsBoolean() pauseWhilePendingCustomer?: boolean;
}
