import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Matches, Max, Min, validateSync } from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  // Explicit @Type: env values are strings and an unannotated initializer emits no type metadata.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// connection string',
  })
  DATABASE_URL!: string;

  /** Run pending migrations when the API starts. */
  // Reads the raw value from `obj`: implicit conversion has already turned the
  // string "false" into Boolean("false") === true by the time `value` arrives.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    const raw = obj.DB_MIGRATE_ON_BOOT;
    return raw === undefined ? true : raw === true || raw === 'true';
  })
  @IsBoolean()
  DB_MIGRATE_ON_BOOT: boolean = true;
}

/**
 * Validates process env at boot so a misconfigured container fails fast
 * instead of erroring on the first request.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return env;
}
