import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

export class AuthError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ error: { code, message } }, status);
  }
}
export const unavailable = () =>
  new AuthError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable.');
export const invalidToken = () =>
  new AuthError(400, 'TOKEN_INVALID', 'This link is invalid or has expired.');

@Catch()
export class AuthErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (response.headersSent) return;
    const account = /^\/api\/v1\/(auth(?:\/|$)|users\/me(?:\/|$))/.test(request.path);
    if (!account && error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof AuthError) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    const status =
      error instanceof HttpException && error.getStatus() < 500 ? error.getStatus() : 503;
    response.status(status).json({
      error: {
        code:
          status === 400
            ? 'VALIDATION_FAILED'
            : status === 404
              ? 'NOT_FOUND'
              : 'SERVICE_UNAVAILABLE',
        message:
          status === 400
            ? 'Invalid request fields.'
            : status === 404
              ? 'Route not found.'
              : 'Service temporarily unavailable.',
      },
    });
  }
}
