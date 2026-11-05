import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EmptyDto } from '../auth.dto.js';
import { AuthError } from '../auth-error.js';
import { GuestBoundaryGuard } from './guest-boundary.guard.js';
import { GuestCredentialsService } from './guest-credentials.service.js';

@Controller('guest-session')
@UseGuards(GuestBoundaryGuard)
export class GuestController {
  constructor(private readonly credentials: GuestCredentialsService) {}
  @Post()
  @HttpCode(200)
  bootstrap(
    @Body() _body: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const body: unknown = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new AuthError(400, 'VALIDATION_FAILED', 'Invalid request fields.');
    return this.credentials.bootstrap(this.credentials.read(request), response);
  }
}
