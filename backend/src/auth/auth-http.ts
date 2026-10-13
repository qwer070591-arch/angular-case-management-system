import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../generated/prisma/client';

export interface UserPublic {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  authUser?: UserPublic;
}

export function authError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

// Reject duplicate names rather than accepting an attacker-controlled shadow cookie.
export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  return values[0].slice(name.length + 1);
}
