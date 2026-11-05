import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import { finalize } from 'rxjs';
import { AuthError } from '../auth/auth-error.js';

export const MAX_CONCURRENT_UPLOADS = 4;
export const UPLOAD_DEADLINE_MS = 60_000;

@Injectable()
export class UploadBudgetInterceptor implements NestInterceptor {
  private active = 0;
  intercept(context: ExecutionContext, next: CallHandler<unknown>) {
    if (this.active >= MAX_CONCURRENT_UPLOADS)
      throw new AuthError(429, 'UPLOAD_CAPACITY_REACHED', 'Upload capacity is temporarily full.');
    this.active++;
    const request = context.switchToHttp().getRequest<Request>();
    const deadline = setTimeout(() => request.destroy(), UPLOAD_DEADLINE_MS);
    deadline.unref();
    // Keep the slot until Multer has cleaned up, including incomplete/aborted streams.
    return next.handle().pipe(
      finalize(() => {
        clearTimeout(deadline);
        this.active--;
      }),
    );
  }
}
