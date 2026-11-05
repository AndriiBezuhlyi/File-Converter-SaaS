import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UsersService } from './users.service.js';
import { AuthBoundaryGuard, AuthPolicy } from '../auth/auth-boundary.js';
import { SessionService, type AuthRequest } from '../auth/session.service.js';
import { PasswordChangeDto, ProfileUpdateDto } from '../auth/auth.dto.js';
import { profile } from '../auth/account.repository.js';
import { SettingsUpdateDto } from './settings.dto.js';

@Controller('users/me')
@UseGuards(AuthBoundaryGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {}
  @Get()
  @AuthPolicy('account')
  profile(@Req() request: AuthRequest) {
    return profile(request.authUser!);
  }
  @Get('settings')
  @AuthPolicy('account')
  settings(@Req() request: AuthRequest) {
    return this.users.settings(request.authUser!);
  }
  @Patch('settings')
  @AuthPolicy('account')
  updateSettings(@Req() request: AuthRequest, @Body() body: SettingsUpdateDto) {
    return this.users.updateSettings(request.authUser!, body.autoSave);
  }
  @Patch()
  @AuthPolicy('sensitive')
  update(@Req() request: AuthRequest, @Body() body: ProfileUpdateDto) {
    return this.users.update(request.authUser!, body);
  }
  @Post('password')
  @HttpCode(204)
  @AuthPolicy('sensitive')
  async password(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: PasswordChangeDto,
  ) {
    await this.users.changePassword(request.authUser!, body.currentPassword, body.newPassword);
    await this.sessions.destroy(request, response);
  }
}
