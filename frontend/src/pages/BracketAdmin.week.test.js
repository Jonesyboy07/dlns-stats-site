import { describe, expect, it } from 'vitest';
import { readJson } from './BracketAdmin.jsx';

// Only the shape `readJson` reads: content type, status and the parsed body.
const res = (body, { status = 200, ok = true, type = 'application/json' } = {}) => ({
  status,
  ok,
  headers: { get: () => type },
  json: async () => body,
});

describe('readJson', () => {
  it('returns the body of a successful response', async () => {
    await expect(readJson(res({ ok: true, event: { id: 'x' } }), 'fallback')).resolves.toEqual({
      ok: true,
      event: { id: 'x' },
    });
  });

  it('keeps the whole body reachable when the week looks wrong', async () => {
    const body = { ok: false, error: 'Week 59 already holds games played 5–8 Oct.', warning: 'Week 59 …', needs_confirm: true };
    await expect(readJson(res(body, { status: 409, ok: false }), 'fallback')).rejects.toMatchObject({
      message: body.error,
      status: 409,
      payload: body,
    });
  });

  it('falls back to the caller message and still exposes the status', async () => {
    await expect(readJson(res({ ok: false }, { status: 500, ok: false }), 'Failed to save')).rejects.toMatchObject({
      message: 'Failed to save',
      status: 500,
    });
  });

  it('explains an HTML response', async () => {
    await expect(readJson(res(null, { type: 'text/html' }), 'fallback')).rejects.toThrow(/login redirect/);
  });
});
