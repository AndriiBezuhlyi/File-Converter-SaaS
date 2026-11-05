import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthBoundaryGuard, AuthPolicy } from '../auth/auth-boundary.js';
import type { AuthRequest } from '../auth/session.service.js';
import { ApiKeysService } from './api-keys.service.js';
import { KeyConfirmationDto } from './api-key.dto.js';

@Controller('users/me/api-key')
@UseGuards(AuthBoundaryGuard)
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}
  @Get()
  @AuthPolicy('account')
  read(@Req() request: AuthRequest) {
    return this.keys.read(request.authUser!);
  }
  @Post()
  @HttpCode(201)
  @AuthPolicy('sensitive')
  create(@Req() request: AuthRequest, @Body() body: KeyConfirmationDto) {
    return this.keys.change(request.authUser!, body.currentPassword, 'create');
  }
  @Post('rotate')
  @HttpCode(200)
  @AuthPolicy('sensitive')
  rotate(@Req() request: AuthRequest, @Body() body: KeyConfirmationDto) {
    return this.keys.change(request.authUser!, body.currentPassword, 'rotate');
  }
  @Delete()
  @HttpCode(204)
  @AuthPolicy('sensitive')
  async revoke(@Req() request: AuthRequest, @Body() body: KeyConfirmationDto) {
    await this.keys.change(request.authUser!, body.currentPassword, 'revoke');
  }
}
