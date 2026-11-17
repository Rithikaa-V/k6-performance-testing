import http from 'k6/http';
import type { Params, RefinedResponse, ResponseType } from 'k6/http';
import { BASE_URL } from '../config/env.ts';

// Thin wrapper around k6/http so every request gets the same headers, auth format, and tags.

export interface RequestOptions {
  // Adds the Authorization header with the token.
  token?: string;
  // The value for the name tag; always set this for URLs with ids so they stay grouped.
  name?: string;
  // Status codes that are expected for this request and should not count as failures.
  expected?: number[];
  // JSON body to send.
  body?: unknown;
}

export type ApiResponse = RefinedResponse<ResponseType | undefined>;

export function buildParams(opts: RequestOptions = {}): Params {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const tags: Record<string, string> = {};

  if (opts.name) tags.name = opts.name;
  if (opts.token) headers.Authorization = `Token ${opts.token}`;

  const params: Params = { headers, tags };
  if (opts.expected) params.responseCallback = http.expectedStatuses(...opts.expected);
  return params;
}

export function api(method: string, path: string, opts: RequestOptions = {}): ApiResponse {
  const payload = opts.body === undefined ? null : JSON.stringify(opts.body);
  return http.request(method, `${BASE_URL}${path}`, payload, buildParams(opts));
}

// Same params for http.batch(), but the caller supplies the request list.
export function batchGet(path: string, opts: RequestOptions = {}): ['GET', string, null, Params] {
  return ['GET', `${BASE_URL}${path}`, null, buildParams(opts)];
}
