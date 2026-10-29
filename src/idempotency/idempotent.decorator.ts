import { applyDecorators, HttpCode, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiConflictResponse, ApiHeader, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENT_STATUS,
  IdempotencyInterceptor,
} from './idempotency.interceptor.js';

/**
 * Marks a route as requiring an Idempotency-Key and replaying the stored
 * response for repeats. `status` is the success status to store and replay.
 */
export function Idempotent(status = 201): MethodDecorator {
  return applyDecorators(
    HttpCode(status),
    SetMetadata(IDEMPOTENT_STATUS, status),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: IDEMPOTENCY_HEADER,
      required: true,
      description:
        'Client-generated unique key (e.g. a UUID), 1-255 printable characters. Repeating a request with the same key returns the original response with `Idempotent-Replayed: true` and never moves money twice.',
    }),
    ApiConflictResponse({
      description: 'A request with this Idempotency-Key is still being processed',
    }),
    ApiUnprocessableEntityResponse({
      description:
        'The Idempotency-Key was already used for a different request, or the operation is not possible (e.g. insufficient funds)',
    }),
  );
}
