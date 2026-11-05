import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), put: vi.fn(), get: vi.fn(), remove: vi.fn(), first: vi.fn(), bind: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authenticateRequest: mocks.authenticate }));
vi.mock('@/lib/activity-store', () => ({ activityFiles: () => ({ put: mocks.put, get: mocks.get, delete: mocks.remove }) }));
import { POST, GET, DELETE } from '@/app/api/profile/photo/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bind.mockReturnValue({ first: mocks.first });
  mocks.authenticate.mockResolvedValue({ ok: true, db: { prepare: () => ({ bind: mocks.bind }) }, session: { user: { id: 'user-1' }, workspace: { id: 'workspace-1' } } });
});

describe('profile photo boundaries', () => {
  it('rejects unauthenticated uploads without touching storage', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, response: new Response('', { status: 401 }) });
    expect((await POST(new Request('https://scout.test/api/profile/photo', { method: 'POST' }))).status).toBe(401);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('rejects disguised non-image files', async () => {
    const form = new FormData(); form.set('file', new File(['<script>'], 'photo.jpg', { type: 'image/jpeg' }));
    expect((await POST(new Request('https://scout.test/api/profile/photo', { method: 'POST', body: form }))).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('stores uploads under the authenticated user with an immutable URL', async () => {
    const form = new FormData(); form.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo.jpg', { type: 'image/jpeg' }));
    const response = await POST(new Request('https://scout.test/api/profile/photo', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    expect((await response.json() as { url: string }).url).toMatch(/^\/api\/profile\/photo\?key=profiles%2Fuser-1%2F/);
    expect(mocks.put.mock.calls[0][0]).toMatch(/^profiles\/user-1\//);
  });
  it('prevents cross-user deletion and protects the saved avatar', async () => {
    expect((await DELETE(new Request('https://scout.test/api/profile/photo?key=profiles%2Fother%2Fabc.jpg'))).status).toBe(404);
    const url = '/api/profile/photo?key=profiles%2Fuser-1%2Fabc.jpg';
    mocks.first.mockResolvedValue({ avatar_url: url });
    expect((await DELETE(new Request(`https://scout.test${url}`))).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('serves photos only within the current workspace', async () => {
    mocks.first.mockResolvedValue(null);
    expect((await GET(new Request('https://scout.test/api/profile/photo?key=profiles%2Fother%2Fabc.jpg'))).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
