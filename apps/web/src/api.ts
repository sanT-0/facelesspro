/**
 * API client for the FacelessPro web app.
 *
 * All calls go to `/v1/*` on the same origin (the dev server proxies to the
 * API server). Auth uses `Authorization: Bearer vp_<key>` stored in
 * `localStorage`.
 */

const API_BASE = '/v1';

let token: string | null = null;

export function setAuthToken(value: string | null): void {
  token = value;
  if (value) {
    try {
      localStorage.setItem('facelesspro_token', value);
    } catch {
      // localStorage unavailable; ignore.
    }
  } else {
    try {
      localStorage.removeItem('facelesspro_token');
    } catch {
      // ignore.
    }
  }
}

export function clearAuthToken(): void {
  token = null;
  try {
    localStorage.removeItem('facelesspro_token');
  } catch {
    // localStorage unavailable; ignore.
  }
}

export function getAuthToken(): string | null {
  if (token !== null) return token;
  try {
    token = localStorage.getItem('facelesspro_token');
  } catch {
    // ignore.
  }
  return token;
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const t = getAuthToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  return res;
}

export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apiRequest(path, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(
      `API ${res.status}: ${errText || res.statusText}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface Video {
  id: string;
  kind: string;
  status: string;
  step: string | null;
  render: boolean;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  error: { code: string; message: string } | null;
  editorUrl: string;
  createdAt: string;
  updatedAt: string;
  scenes?: Array<{
    id: string;
    idx: number;
    text: string;
    imageUrl?: string;
    motion?: Record<string, unknown>;
    startMs: number;
    endMs: number;
  }>;
}

export async function getVideo(id: string): Promise<Video> {
  return apiJson<Video>(`/videos/${encodeURIComponent(id)}`);
}

export async function listArtStyles(): Promise<ArtStyle[]> {
  return apiJson<{ styles: ArtStyle[] }>('/art-styles').then((r) => r.styles);
}

export async function createVideoV3(body: {
  artStyleId: string;
  script?: string;
  voiceoverUrl?: string;
  size?: 'landscape' | 'portrait';
  speed?: 'slow' | 'standard';
  voiceId?: string;
  voiceStyle?: {
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
  };
  captions?: boolean;
  captionTemplateId?: number;
  render?: { resolution: number; frameRate: number; format: string };
  webhookUrl?: string;
}): Promise<{
  id: string;
  status: string;
  render: boolean;
  createdAt: string;
  editorUrl: string;
}> {
  return apiJson(`/ai-videos-v3`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function renderVideo(
  id: string,
  body: {
    resolution?: number;
    frameRate?: number;
    format?: string;
    webhookUrl?: string;
  },
): Promise<Video> {
  return apiJson<Video>(`/videos/${encodeURIComponent(id)}/render`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function retryVideo(id: string): Promise<Video> {
  return apiJson<Video>(`/videos/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  });
}

export interface Workspace {
  id: string;
  name: string;
  plan: {
    id: string;
    minutesPerMonth: number | null;
    creditsPerMonth: number | null;
    maxVideoMinutes: number;
    maxResolution: number;
    seats: number;
  };
  credits: number | null;
  owner: { id: string; email: string; name: string };
}

export async function getWorkspace(): Promise<Workspace> {
  return apiJson<Workspace>('/workspace');
}

export interface CreditLog {
  id: string;
  videoId: string | null;
  action: string;
  units: number;
  unitCost: number;
  delta: number;
  createdAt: string;
}

export async function getCreditLogs(): Promise<CreditLog[]> {
  return apiJson<{ logs: CreditLog[] }>('/credit-logs').then((r) => r.logs);
}

export interface BalanceLog {
  id: string;
  kind: string;
  amountCents: number;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export async function getBalanceLogs(): Promise<BalanceLog[]> {
  return apiJson<{ logs: BalanceLog[] }>('/balance-logs').then((r) => r.logs);
}

export interface ArtStyle {
  id: string;
  name: string;
  published: boolean;
  formats: string[];
  previewUrl: string;
  portraitPreviewUrl: string | null;
  sampleVideoUrls: string[];
  status: string;
  createdAt: string;
}

export async function getArtStyles(): Promise<ArtStyle[]> {
  return apiJson<{ styles: ArtStyle[] }>('/art-styles').then((r) => r.styles);
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  gender?: string;
  accent?: string;
  age?: string;
  useCase?: string;
  previewUrl?: string;
  languages: string[];
  mixesEnglish: boolean;
  engine: string;
  sampleRate?: number;
  wordTimings: boolean;
}

export async function getVoices(): Promise<Voice[]> {
  return apiJson<{ voices: Voice[] }>('/voices').then((r) => r.voices);
}

export interface SoundEffect {
  id: string;
  name: string;
  url: string;
  durationMs?: number;
  tags?: string[];
}

export async function getSoundEffects(): Promise<SoundEffect[]> {
  return apiJson<{ soundEffects: SoundEffect[] }>(
    '/sound-effects',
  ).then((r) => r.soundEffects);
}

export interface BackgroundVideo {
  id: string;
  name: string;
  url: string;
  durationMs?: number;
  thumbnailUrl?: string;
  tags?: string[];
}

export async function getBackgroundVideos(): Promise<BackgroundVideo[]> {
  return apiJson<{ backgroundVideos: BackgroundVideo[] }>(
    '/background-videos',
  ).then((r) => r.backgroundVideos);
}

export interface TTSRequest {
  text: string;
  voiceId?: string;
  voiceStyle?: Record<string, unknown>;
}

export interface TTSResponse {
  audioUrl: string;
  durationMs: number;
  voiceId: string;
}

export async function synthesizeTTS(body: TTSRequest): Promise<TTSResponse> {
  return apiJson<TTSResponse>('/text-to-speech', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function createApiKey(name: string): Promise<{
  key: string;
  apiKey: ApiKeyRow;
}> {
  return apiJson(`/keys`, { method: 'POST', body: JSON.stringify({ name }) });
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return apiJson<{ keys: ApiKeyRow[] }>('/keys').then((r) => r.keys);
}

export async function revokeApiKey(id: string): Promise<ApiKeyRow> {
  return apiJson(`/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface CaptionTemplate {
  id: number;
  name: string;
  spec: Record<string, unknown>;
}

export async function getCaptionTemplates(): Promise<CaptionTemplate[]> {
  return apiJson<{ templates: CaptionTemplate[] }>(
    '/caption-templates',
  ).then((r) => r.templates);
}

export async function uploadFile(file: File): Promise<{
  key: string;
  url: string;
  bytes: number;
  mime: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  return apiJson(`/files`, { method: 'POST', body: formData });
}
