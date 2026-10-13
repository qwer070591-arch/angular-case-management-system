import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

interface ApiErrorBody {
  error: { code: string; message: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
    && typeof error.code === 'string' && typeof error.message === 'string';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;

    if (status >= 500) {
      // Error messages/stacks from drivers may contain connection details. Keep them out of HTTP and default logs.
      this.logger.error(`Request failed: ${request.method} ${request.url}`);
    }

    if (isApiErrorBody(body)) {
      response.status(status).json(body);
      return;
    }

    const fallback = status === HttpStatus.NOT_FOUND
      ? { code: 'NOT_FOUND', message: '找不到資源。' }
      : status === HttpStatus.BAD_REQUEST
        ? { code: 'MALFORMED_REQUEST', message: '請求格式不正確。' }
        : { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求。' };
    response.status(status).json({ error: fallback });
  }
}
