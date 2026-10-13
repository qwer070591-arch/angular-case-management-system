import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../api/api-config';

export type UserRole = 'admin' | 'manager' | 'staff';

export interface UserPublic {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface DataResponse<T> {
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly authUrl = `${inject(API_BASE_URL)}/auth`;

  initializeCsrf(): Observable<string> {
    return this.http.get<DataResponse<{ csrfToken: string }>>(`${this.authUrl}/csrf`).pipe(
      map((response) => response.data.csrfToken),
    );
  }

  login(input: LoginInput): Observable<UserPublic> {
    return this.http.post<DataResponse<UserPublic>>(`${this.authUrl}/login`, input).pipe(
      map((response) => response.data),
    );
  }

  getCurrentUser(): Observable<UserPublic> {
    return this.http.get<DataResponse<UserPublic>>(`${this.authUrl}/me`).pipe(
      map((response) => response.data),
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.authUrl}/logout`, null);
  }
}
