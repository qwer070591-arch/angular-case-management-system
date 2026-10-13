import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { SESSION_COOKIE } from './auth-config';
import { authError, AuthenticatedRequest, cookieValue } from './auth-http';
import { SessionService } from './session.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(protected readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const identity = await this.sessions.resolve(cookieValue(request, SESSION_COOKIE));
    if (!identity) throw authError(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', '請先登入。');
    request.authUser = identity.user;
    return true;
  }
}

@Injectable()
export class ProjectAdminGuard extends SessionAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.authUser?.role !== 'admin') {
      throw authError(HttpStatus.FORBIDDEN, 'FORBIDDEN', '沒有存取案件的權限。');
    }
    return true;
  }
}
