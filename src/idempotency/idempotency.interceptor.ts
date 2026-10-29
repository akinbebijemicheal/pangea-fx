import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { hasPgCode, PG_LOCK_NOT_AVAILABLE } from '../database/pg-errors.js';
import { TransactionManager } from '../database/transaction-manager.js';
import { hashRequest } from './request-hash.js';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';
export const IDEMPOTENT_STATUS = Symbol('IDEMPOTENT_STATUS');

/** Printable ASCII without spaces, 1 to 255 chars: fits UUIDs, ULIDs and most client schemes. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

interface IdempotencyKeyRow {
  key: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

type Outcome =
  | { kind: 'response'; status: number; body: unknown; replayed: boolean }
  | { kind: 'error'; exception: HttpException; replayed: boolean };

/**
 * Makes a POST safe to retry. The key is claimed and the handler's writes are
 * committed in ONE database transaction:
 *
 * - First request: inserts the key (the primary key is the lock), runs the
 *   handler in a savepoint, stores the response, commits everything together.
 * - Duplicate while the first is in flight: its insert blocks on the primary
 *   key until the first commits, then it replays the stored response. After
 *   IDEMPOTENCY_LOCK_TIMEOUT_MS it gets 409 instead of waiting forever.
 * - Duplicate after completion: replays the stored status and body with an
 *   `Idempotent-Replayed: true` header. The handler does not run.
 * - Same key, different method/path/body: 422.
 * - Request is malformed (400, e.g. validation): nothing ran, so nothing is
 *   stored and the key stays free for the corrected request (as Stripe does).
 * - Handler fails with another 4xx (404, 422): its writes roll back to the
 *   savepoint, the error is stored and replayed, so a retry with the same key
 *   gets the same answer.
 * - Handler fails with a 5xx or crashes: the whole transaction rolls back,
 *   including the key, so the client can retry the same key safely.
 *
 * Because the key and the money movement commit atomically, there is no
 * "processing" state that a crash could leave behind.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly tm: TransactionManager,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const key = req.header(IDEMPOTENCY_HEADER);
    if (key === undefined) {
      throw new BadRequestException(`${IDEMPOTENCY_HEADER} header is required`);
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        `${IDEMPOTENCY_HEADER} must be 1-255 printable ASCII characters without spaces`,
      );
    }
    const successStatus = this.reflector.get<number>(IDEMPOTENT_STATUS, ctx.getHandler());
    const hash = hashRequest(req.method, req.originalUrl, req.body);
    return from(this.execute(key, hash, successStatus, next, res));
  }

  private async execute(
    key: string,
    hash: string,
    successStatus: number,
    next: CallHandler,
    res: Response,
  ): Promise<unknown> {
    const outcome = await this.claimAndRun(key, hash, successStatus, next);
    if (outcome.replayed) res.setHeader(REPLAYED_HEADER, 'true');
    if (outcome.kind === 'error') throw outcome.exception;
    res.status(outcome.status);
    return outcome.body;
  }

  private async claimAndRun(
    key: string,
    hash: string,
    successStatus: number,
    next: CallHandler,
  ): Promise<Outcome> {
    try {
      return await this.tm.run(async (trx) => {
        // Integer from validated config, so safe to inline (SET does not take bind parameters).
        const lockTimeoutMs = this.config.get('IDEMPOTENCY_LOCK_TIMEOUT_MS', { infer: true });
        await trx.raw(`set local lock_timeout = '${lockTimeoutMs}ms'`);
        const claimed = await trx('idempotency_keys')
          .insert({ key, request_hash: hash })
          .onConflict('key')
          .ignore()
          .returning('key');

        if (claimed.length === 0) {
          const stored = await trx<IdempotencyKeyRow>('idempotency_keys').where({ key }).first();
          if (!stored?.response_status) throw new Error(`Idempotency key ${key} has no response`);
          if (stored.request_hash !== hash) {
            throw new UnprocessableEntityException(
              `${IDEMPOTENCY_HEADER} has already been used for a different request`,
            );
          }
          return replay(stored.response_status, stored.response_body);
        }

        try {
          const body: unknown = await this.tm.savepoint(() =>
            lastValueFrom(next.handle() as Observable<unknown>, { defaultValue: undefined }),
          );
          await this.store(key, successStatus, body);
          return { kind: 'response', status: successStatus, body, replayed: false };
        } catch (err) {
          if (isReplayableClientError(err)) {
            await this.store(key, err.getStatus(), err.getResponse());
            return { kind: 'error', exception: err, replayed: false };
          }
          throw err;
        }
      });
    } catch (err) {
      if (hasPgCode(err, PG_LOCK_NOT_AVAILABLE)) {
        throw new ConflictException(
          `A request with this ${IDEMPOTENCY_HEADER} is still being processed; retry shortly`,
        );
      }
      throw err;
    }
  }

  private async store(key: string, status: number, body: unknown): Promise<void> {
    await this.tm
      .db('idempotency_keys')
      .where({ key })
      // Stringified explicitly: pg would turn a top-level array into a Postgres array.
      .update({ response_status: status, response_body: JSON.stringify(body ?? null) });
  }
}

/** 4xx errors other than 400 are outcomes of executing the request, so they are kept. */
function isReplayableClientError(err: unknown): err is HttpException {
  if (!(err instanceof HttpException)) return false;
  const status = err.getStatus();
  return status >= 400 && status < 500 && status !== 400;
}

function replay(status: number, body: unknown): Outcome {
  if (status >= 400) {
    return { kind: 'error', exception: new HttpException(body as object, status), replayed: true };
  }
  return { kind: 'response', status, body, replayed: true };
}
