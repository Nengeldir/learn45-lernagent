// The access gate for a public deployment: open without ACCESS_USERS, Basic Auth with it.
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUsers } from '../src/access.ts';
import { createApp } from '../src/app.ts';

process.env.MODEL_PROVIDER = 'none';
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

afterEach(() => {
  delete process.env.ACCESS_USERS;
});

describe('access gate', () => {
  it('leaves the app open without ACCESS_USERS', async () => {
    await request(createApp()).get('/api/content').expect(200);
  });

  it('asks for a login and lets every configured user in', async () => {
    process.env.ACCESS_USERS = 'luca:owner-pass, jury:jury-pass';
    const app = createApp();
    const denied = await request(app).get('/api/content').expect(401);
    expect(denied.headers['www-authenticate']).toMatch(/^Basic realm=/);
    await request(app).get('/').expect(401);
    await request(app).get('/videos/math-v1/manifest.json').expect(401);
    await request(app).get('/api/content').set('Authorization', basic('luca', 'owner-pass')).expect(200);
    await request(app).get('/api/content').set('Authorization', basic('jury', 'jury-pass')).expect(200);
  });

  it('sends a learner back to the app once the browser has asked for the login', async () => {
    process.env.ACCESS_USERS = 'luca:owner-pass';
    const app = createApp();
    await request(app).get('/api/auth').expect(401);
    const res = await request(app).get('/api/auth').set('Authorization', basic('luca', 'owner-pass')).expect(302);
    expect(res.headers.location).toBe('/');
  });

  it('turns away wrong passwords and unknown users', async () => {
    process.env.ACCESS_USERS = 'luca:owner-pass';
    const app = createApp();
    await request(app).get('/api/content').set('Authorization', basic('luca', 'wrong')).expect(401);
    await request(app).get('/api/content').set('Authorization', basic('jury', 'owner-pass')).expect(401);
    await request(app).get('/api/content').set('Authorization', 'Bearer owner-pass').expect(401);
  });

  it('keeps the health check open for the hosting platform', async () => {
    process.env.ACCESS_USERS = 'luca:owner-pass';
    await request(createApp()).get('/api/health').expect(200);
  });

  it('allows colons in passwords and refuses a value without any user', () => {
    expect(parseUsers('luca:a:b')?.get('luca')).toBe('a:b');
    expect(() => parseUsers('just-a-password')).toThrow();
    expect(parseUsers('  ')).toBeNull();
  });
});
