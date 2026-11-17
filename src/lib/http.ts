import http from 'k6/http';
import type { Params, RefinedResponse, ResponseType } from 'k6/http';
import { BASE_URL, LOG_FAILURES } from '../config/env.ts';

// Thin wrapper over k6/http so every request in the project gets the same
// headers, auth format and tagging.

export interface RequestOptions {
  // adds "Authorization: Token <token>"
  token?: string;
  // value for the "name" tag. Always set this for URLs that contain ids,
  // otherwise every id becomes its own time series.
  name?: string;
  // status codes that are *not* failures for this request (used by the
  // negative tests so a deliberate 401 or 404 does not inflate http_req_failed)
  expected?: number[];
  // object, sent as JSON
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
  const res = http.request(method, `${BASE_URL}${path}`, payload, buildParams(opts));

  if (LOG_FAILURES && (res.status === 0 || res.status >= 400)) {
    const wanted = opts.expected || [];
    if (wanted.indexOf(res.status) === -1) {
      console.warn(`unexpected ${res.status} on ${method} ${path}: ${String(res.body).slice(0, 150)}`);
    }
  }
  return res;
}

// for http.batch(): same params, but the caller supplies the request list
export function batchGet(path: string, opts: RequestOptions = {}): ['GET', string, null, Params] {
  return ['GET', `${BASE_URL}${path}`, null, buildParams(opts)];
}