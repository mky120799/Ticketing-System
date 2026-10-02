import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UpsertSlaPolicyDto {
  @IsInt() @Min(1) @Max(525600) firstResponseMinutes!: number;
  @IsInt() @Min(1) @Max(525600) resolutionMinutes!: number;
  @IsBoolean() active!: boolean;
}
