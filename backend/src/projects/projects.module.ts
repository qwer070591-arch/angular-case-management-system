import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectAdminGuard } from '../auth/session-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({ imports: [PrismaModule, AuthModule], controllers: [ProjectsController], providers: [ProjectsService, ProjectAdminGuard] })
export class ProjectsModule {}
