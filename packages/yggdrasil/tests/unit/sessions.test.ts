/**
 * Tests for the Yggdrasil orchestration controller session API endpoints.
 *
 * The session lifecycle now goes through:
 *   RealmScheduler (decides) → RealmProvisioner (executes) → Session
 *
 * Yggdrasil owns all scheduling decisions. Ratatoskr reports facts,
 * executes commands, and may veto — but never decides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/naming-convention
import { app, sessions, runners, realmRegistry } from '../../src/orchestration-controller';

function registerRunner(
  runnerId: string,
  type: 'computer-use' | 'phone-use',
): void {
  const templateType = type === 'phone-use' ? 'android' : 'ubuntu';
  runners.set(runnerId, {
    runnerId,
    name: `test-runner-${runnerId}`,
    endpoint: `http://localhost:9999`,
    version: '0.1.0',
    capabilities: ['agent'],
    realmTemplates: [
      { id: `${templateType}-template`, type: templateType, capabilities: ['observe', 'mouse', 'keyboard'] },
    ],
    labels: {},
    lastHeartbeat: new Date(),
    status: 'online',
    tasks: [],
  });
  realmRegistry.setTemplates(runnerId, [
    { id: `${templateType}-template`, type: templateType, capabilities: ['observe', 'mouse', 'keyboard'] },
  ]);
}

describe('Session API — POST /api/v1/sessions', () => {
  beforeEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
    registerRunner('runner-1', 'computer-use');
  });

  afterEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
  });

  it('should create a computer-use session', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.descriptor).toBeDefined();
    expect(res.body.descriptor.type).toBe('computer-use');
    expect(res.body.descriptor.state).toBe('active');
    expect(res.body.descriptor.capabilities).toEqual(['mouse', 'keyboard', 'scroll', 'clipboard']);
    expect(res.body.descriptor.observationMethod).toBe('screenshot');
    // realmId is a real realm ID provisioned by RealmProvisioner
    expect(res.body.descriptor.realmId).toBeDefined();
    expect(res.body.descriptor.realmId).not.toBe('');
    // Endpoints are populated (placeholder) by RealmProvisioner
    expect(res.body.descriptor.observationEndpoint).toBeDefined();
    expect(res.body.descriptor.inputEndpoint).toBeDefined();
    // Optional fields absent when not provided
    expect(res.body.descriptor.ownerId).toBeUndefined();
    expect(res.body.descriptor.participantIds).toBeUndefined();
    // Metadata contains runnerId
    expect(res.body.descriptor.metadata?.runnerId).toBe('runner-1');
  });

  it('should create a phone-use session', async () => {
    registerRunner('runner-android', 'phone-use');
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'phone-use' });

    expect(res.status).toBe(201);
    expect(res.body.descriptor.type).toBe('phone-use');
    expect(res.body.descriptor.capabilities).toEqual(['touch', 'keyboard', 'scroll']);
    expect(res.body.descriptor.metadata?.runnerId).toBe('runner-android');
  });

  it('should attach metadata when provided', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({
        type: 'computer-use',
        metadata: { goal: 'open chrome', userId: 'u-123' },
      });

    expect(res.status).toBe(201);
    expect(res.body.descriptor.metadata).toMatchObject({
      goal: 'open chrome',
      userId: 'u-123',
    });
  });

  it('should pass through ownerId and participantIds', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({
        type: 'computer-use',
        ownerId: 'user-abc',
        participantIds: ['user-def', 'user-ghi'],
      });

    expect(res.status).toBe(201);
    expect(res.body.descriptor.ownerId).toBe('user-abc');
    expect(res.body.descriptor.participantIds).toEqual(['user-def', 'user-ghi']);
  });

  it('should accept capabilities filter', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({
        type: 'computer-use',
        capabilities: ['observe', 'keyboard'],
      });

    expect(res.status).toBe(201);
    expect(res.body.descriptor.capabilities).toEqual(['observe', 'keyboard']);
  });

  it('should reject invalid session type', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'browser-use' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or missing session type');
  });

  it('should reject missing type field', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or missing session type');
  });

  it('should return 503 when no runner is registered', async () => {
    runners.clear();
    realmRegistry.clear();

    const res = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Unable to create session');
  });

  it('should return 503 when no matching template is available', async () => {
    realmRegistry.clear();
    // Register a runner with a non-matching template type
    runners.set('runner-windows', {
      runnerId: 'runner-windows',
      name: 'windows-runner',
      endpoint: 'http://localhost:9999',
      version: '0.1.0',
      capabilities: ['agent'],
      realmTemplates: [
        { id: 'windows-template', type: 'windows', capabilities: ['observe', 'mouse', 'keyboard'] },
      ],
      labels: {},
      lastHeartbeat: new Date(),
      status: 'online',
      tasks: [],
    });
    realmRegistry.setTemplates('runner-windows', [
      { id: 'windows-template', type: 'windows', capabilities: ['observe', 'mouse', 'keyboard'] },
    ]);

    // phone-use requires 'android' template type, but we only have 'windows'
    const res = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'phone-use' });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Unable to create session');
  });
});

describe('Session API — GET /api/v1/sessions/:sessionId', () => {
  beforeEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
    registerRunner('runner-1', 'computer-use');
  });

  afterEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
  });

  it('should retrieve a session by ID', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });

    const sessionId = createRes.body.sessionId;

    const res = await request(app).get(`/api/v1/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.type).toBe('computer-use');
  });

  it('should return 404 for unknown session', async () => {
    const res = await request(app).get('/api/v1/sessions/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });
});

describe('Session API — GET /api/v1/sessions', () => {
  beforeEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
    registerRunner('runner-1', 'computer-use');
    registerRunner('runner-android', 'phone-use');
  });

  afterEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
  });

  it('should list all sessions', async () => {
    await request(app).post('/api/v1/sessions').send({ type: 'computer-use' });
    await request(app).post('/api/v1/sessions').send({ type: 'phone-use' });

    const res = await request(app).get('/api/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.sessions).toHaveLength(2);
  });

  it('should filter sessions by type', async () => {
    await request(app).post('/api/v1/sessions').send({ type: 'computer-use' });
    await request(app).post('/api/v1/sessions').send({ type: 'phone-use' });
    await request(app).post('/api/v1/sessions').send({ type: 'computer-use' });

    const res = await request(app).get('/api/v1/sessions?type=computer-use');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    for (const s of res.body.sessions) {
      expect(s.type).toBe('computer-use');
    }
  });

  it('should filter sessions by state', async () => {
    // Create a session then terminate it
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    await request(app).delete(`/api/v1/sessions/${createRes.body.sessionId}`);

    const res = await request(app).get('/api/v1/sessions?state=terminated');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.sessions[0].state).toBe('terminated');
  });

  it('should return empty list when no sessions exist', async () => {
    sessions.clear();
    const res = await request(app).get('/api/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.sessions).toEqual([]);
  });
});

describe('Session API — PATCH /api/v1/sessions/:sessionId', () => {
  beforeEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
    registerRunner('runner-1', 'computer-use');
  });

  afterEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
  });

  it('should pause an active session', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ state: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('paused');
  });

  it('should resume a paused session', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    await request(app).patch(`/api/v1/sessions/${sessionId}`).send({ state: 'paused' });
    const res = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ state: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('active');
  });

  it('should complete an active session', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ state: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('completed');
  });

  it('should reject invalid state transitions', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ state: 'creating' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid state transition');
  });

  it('should update metadata on patch', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ metadata: { note: 'test note' } });

    expect(res.status).toBe(200);
    expect(res.body.metadata?.note).toBe('test note');
  });

  it('should return 404 for unknown session', async () => {
    const res = await request(app)
      .patch('/api/v1/sessions/nonexistent')
      .send({ state: 'terminated' });

    expect(res.status).toBe(404);
  });
});

describe('Session API — DELETE /api/v1/sessions/:sessionId', () => {
  beforeEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
    registerRunner('runner-1', 'computer-use');
  });

  afterEach(() => {
    sessions.clear();
    runners.clear();
    realmRegistry.clear();
  });

  it('should terminate a session', async () => {
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .send({ type: 'computer-use' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app).delete(`/api/v1/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('terminated');
    expect(res.body.sessionId).toBe(sessionId);

    const getRes = await request(app).get(`/api/v1/sessions/${sessionId}`);
    expect(getRes.body.state).toBe('terminated');
  });

  it('should return 404 for unknown session', async () => {
    const res = await request(app).delete('/api/v1/sessions/nonexistent');
    expect(res.status).toBe(404);
  });
});
