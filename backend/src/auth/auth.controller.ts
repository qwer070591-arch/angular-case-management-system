import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { authConfig, CSRF_COOKIE, SESSION_ABSOLUTE_MS, SESSION_COOKIE } from './auth-config';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, cookieValue } from './auth-http';
import { CsrfService } from './csrf.service';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  private readonly config = authConfig();

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
  ) {}

  @Get('csrf')
  csrfToken(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return { data: { csrfToken: this.csrf.issue(request, response, cookieValue(request, SESSION_COOKIE)) } };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { user, token } = await this.auth.login(body, request.ip ?? 'unknown');
    await this.sessions.revoke(cookieValue(request, SESSION_COOKIE));
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: this.config.production, sameSite: 'lax', path: '/', maxAge: SESSION_ABSOLUTE_MS,
    });
    this.csrf.issue(request, response, token);
    response.setHeader('Cache-Control', 'no-store');
    return { data: user };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return { data: request.authUser };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.revoke(cookieValue(request, SESSION_COOKIE));
    response.clearCookie(SESSION_COOKIE, { path: '/', secure: this.config.production, sameSite: 'lax' });
    response.clearCookie(CSRF_COOKIE, { path: '/', secure: this.config.production, sameSite: 'lax' });
    response.setHeader('Cache-Control', 'no-store');
  }
}
