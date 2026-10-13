import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';

@Module({ imports: [AuthModule, ProjectsModule] })
export class AppModule {}
