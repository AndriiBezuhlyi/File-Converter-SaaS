import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { SessionService, type AuthRequest } from './session.service.js';
import { AuthBoundaryGuard, AuthPolicy } from './auth-boundary.js';
import {
  EmailDto,
  LoginDto,
  RegisterDto,
  PasswordResetDto,
  TokenDto,
  accepted,
  EmptyDto,
} from './auth.dto.js';

@Controller('auth')
@UseGuards(AuthBoundaryGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}
  @Get('csrf')
  @AuthPolicy('csrf')
  csrf(@Req() request: Request) {
    return this.sessions.csrf(request);
  }
  @Get('session')
  session(@Req() request: AuthRequest) {
    return this.sessions.describe(request, request.authUser);
  }
  @Post('register')
  @HttpCode(202)
  @AuthPolicy('link')
  async register(@Body() body: RegisterDto) {
    await this.auth.register(body.email, body.password);
    return accepted;
  }
  @Post('login')
  @HttpCode(200)
  @AuthPolicy('login')
  async login(@Req() request: Request, @Body() body: LoginDto) {
    return this.sessions.login(request, await this.auth.login(body.email, body.password));
  }
  @Post('logout')
  @HttpCode(204)
  logout(
    @Body() _body: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.sessions.destroy(request, response);
  }
  @Post('verification/resend')
  @HttpCode(202)
  @AuthPolicy('link')
  async resend(@Body() body: EmailDto) {
    await this.auth.requestLink(body.email, 'email_verification');
    return accepted;
  }
  @Post('verify-email')
  @HttpCode(204)
  @AuthPolicy('token')
  verify(@Body() body: TokenDto) {
    return this.auth.verify(body.token);
  }
  @Post('password-reset/request')
  @HttpCode(202)
  @AuthPolicy('link')
  async requestReset(@Body() body: EmailDto) {
    await this.auth.requestLink(body.email, 'password_reset');
    return accepted;
  }
  @Post('password-reset/confirm')
  @HttpCode(204)
  @AuthPolicy('token')
  reset(@Body() body: PasswordResetDto) {
    return this.auth.reset(body.token, body.newPassword);
  }
}
