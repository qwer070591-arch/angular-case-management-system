import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, CsrfService } from './csrf.service';
import { LoginLimiterService } from './login-limiter.service';
import { ProjectAdminGuard, SessionAuthGuard } from './session-auth.guard';
import { SessionService } from './session.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService, CsrfService, SessionService, LoginLimiterService,
    SessionAuthGuard, ProjectAdminGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
