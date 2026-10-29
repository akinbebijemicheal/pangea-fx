import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateBy,
  validateSync,
} from 'class-validator';
import { validateCronExpression } from 'cron';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Boolean env var with a default. Reads the raw value from `obj`: implicit
 * conversion has already turned the string "false" into Boolean("false") ===
 * true by the time `value` arrives.
 */
function EnvBoolean(defaultValue: boolean): PropertyDecorator {
  return Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    return raw === undefined ? defaultValue : raw === true || raw === 'true';
  });
}

/** A cron expression, or "off" to disable the job. */
function IsCronOrOff(): PropertyDecorator {
  return ValidateBy({
    name: 'isCronOrOff',
    validator: {
      validate: (value: unknown) =>
        value === 'off' || (typeof value === 'string' && validateCronExpression(value).valid),
      defaultMessage: (args) => `${args?.property} must be a cron expression or "off"`,
    },
  });
}

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
  @EnvBoolean(true)
  @IsBoolean()
  DB_MIGRATE_ON_BOOT: boolean = true;

  /** USD-based rates endpoint; must return the open.er-api.com v6 shape. */
  @IsString()
  @Matches(/^https?:\/\//, { message: 'FX_PROVIDER_URL must be an http(s) URL' })
  FX_PROVIDER_URL: string = 'https://open.er-api.com/v6/latest/USD';

  /** Live rates younger than this are served without calling the provider. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  FX_CACHE_TTL_SECONDS: number = 3600;

  /** Provider request timeout. */
  @Type(() => Number)
  @IsInt()
  @Min(100)
  FX_TIMEOUT_MS: number = 3000;

  /** After a failed refresh, wait this long before calling the provider again. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  FX_RETRY_BACKOFF_SECONDS: number = 60;

  /**
   * Scheduled refresh, in UTC. The default runs at 00:10 UTC, just after
   * open.er-api.com publishes its daily rates. "off" disables it.
   */
  @IsString()
  @IsCronOrOff()
  FX_REFRESH_CRON: string = '10 0 * * *';

  /** Refresh rates in the background when the API starts. */
  @EnvBoolean(true)
  @IsBoolean()
  FX_REFRESH_ON_BOOT: boolean = true;

  /** Idempotency keys are honoured for at least this long, then deleted. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  IDEMPOTENCY_KEY_TTL_HOURS: number = 24;

  /** When expired idempotency keys are deleted (cron, UTC), or "off". */
  @IsString()
  @IsCronOrOff()
  IDEMPOTENCY_CLEANUP_CRON: string = '15 * * * *';

  /** How long a duplicate request waits for the in-flight original before a 409. */
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60_000)
  IDEMPOTENCY_LOCK_TIMEOUT_MS: number = 5000;
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
