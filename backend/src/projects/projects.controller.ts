import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ProjectAdminGuard } from '../auth/session-auth.guard';
import { parseCreateProjectInput, parseUpdateProjectInput } from './project-input';
import { parseProjectId, parseProjectListQuery } from './project-query';
import { parseTransitionInput } from './project-transition';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(ProjectAdminGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.projects.findAll(parseProjectListQuery(query));
  }

  @Get('stats')
  stats() {
    return this.projects.getStats();
  }

  @Get(':id')
  async detail(@Param('id') rawId: string) {
    const project = await this.projects.findById(parseProjectId(rawId));
    if (!project) {
      throw new HttpException({ error: { code: 'PROJECT_NOT_FOUND', message: '找不到案件。' } }, HttpStatus.NOT_FOUND);
    }
    return { data: project };
  }

  @Post()
  async create(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const project = await this.projects.create(parseCreateProjectInput(body));
    response.setHeader('Location', `/api/projects/${project.id}`);
    return { data: project };
  }

  @Patch(':id')
  async update(@Param('id') rawId: string, @Body() body: unknown) {
    const project = await this.projects.update(parseProjectId(rawId), parseUpdateProjectInput(body));
    return { data: project };
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  async transition(@Param('id') rawId: string, @Body() body: unknown) {
    const project = await this.projects.transitionProjectStatus(parseProjectId(rawId), parseTransitionInput(body));
    return { data: project };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') rawId: string): Promise<void> {
    await this.projects.remove(parseProjectId(rawId));
  }
}
