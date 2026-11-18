import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool, migrate } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/auth.js';

export const app = buildApp();
export const PASS = 'TestPass12345';

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(false);
}

export async function makeUser(name: string, username: string, role: string, mustChange = false) {
  const r = await pool.query(
    `INSERT INTO users(name, username, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [name, username, role, await hashPassword(PASS), mustChange],
  );
  return r.rows[0].id as string;
}

export type Api = ReturnType<typeof agentFor> extends Promise<infer T> ? T : never;

export async function agentFor(username: string, password = PASS) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set('X-Requested-With', 'yagami').send({ username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  const h = (req: request.Test) => req.set('X-Requested-With', 'yagami');
  return {
    get: (u: string) => agent.get(u),
    post: (u: string, b?: object) => h(agent.post(u)).send(b ?? {}),
    patch: (u: string, b?: object) => h(agent.patch(u)).send(b ?? {}),
    upload: (u: string, buf: Buffer, name: string) => h(agent.post(u)).attach('file', buf, name),
  };
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
