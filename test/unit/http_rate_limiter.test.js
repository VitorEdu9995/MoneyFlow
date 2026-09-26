import test from 'node:test';
import assert from 'node:assert';
import { createRateLimiter, clearRateLimitStore } from '../../src/gateway/httpRateLimiter.js';
import { logger } from '../../src/utils/logger.js';

test('HTTP Rate Limiter Middleware', async (t) => {
  t.beforeEach(() => {
    clearRateLimitStore();
  });

  await t.test('deve permitir requisies abaixo do limite (user/ip)', (t) => {
    const middleware = createRateLimiter({ userIpLimit: 2, windowMs: 1000 });
    let nextCalled = 0;
    
    const req = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/api/test' };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; }
    };
    const next = () => { nextCalled++; };

    middleware(req, res, next);
    assert.strictEqual(nextCalled, 1);
    assert.strictEqual(res.headers['X-RateLimit-Remaining'], 1);

    middleware(req, res, next);
    assert.strictEqual(nextCalled, 2);
    assert.strictEqual(res.headers['X-RateLimit-Remaining'], 0);
  });

  await t.test('deve bloquear e retornar 429 quando limite de user/ip  excedido', (t) => {
    const middleware = createRateLimiter({ userIpLimit: 2, windowMs: 1000 });
    let nextCalled = 0;
    
    const req = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/api/test' };
    const res = {
      headers: {},
      statusCode: 200,
      ended: false,
      endedWith: '',
      setHeader(k, v) { this.headers[k] = v; },
      end(msg) { this.ended = true; this.endedWith = msg; }
    };
    const next = () => { nextCalled++; };

    // Request 1
    middleware(req, res, next);
    // Request 2
    middleware(req, res, next);
    // Request 3 - should block
    middleware(req, res, next);

    assert.strictEqual(nextCalled, 2);
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(res.ended, true);
    assert.strictEqual(res.endedWith, 'Too Many Requests');
    assert.ok(res.headers['Retry-After'] >= 0);
  });

  await t.test('deve bloquear e retornar 429 quando limite global  excedido', (t) => {
    const middleware = createRateLimiter({ globalLimit: 3, userIpLimit: 10, windowMs: 1000 });
    let nextCalled = 0;
    
    const resBase = () => ({
      headers: {},
      statusCode: 200,
      ended: false,
      endedWith: '',
      setHeader(k, v) { this.headers[k] = v; },
      end(msg) { this.ended = true; this.endedWith = msg; }
    });
    const next = () => { nextCalled++; };

    // User A - 1
    middleware({ headers: { 'x-forwarded-for': '1.1.1.1' }, url: '/api' }, resBase(), next);
    // User B - 2
    middleware({ headers: { 'x-forwarded-for': '2.2.2.2' }, url: '/api' }, resBase(), next);
    // User C - 3
    middleware({ headers: { 'x-forwarded-for': '3.3.3.3' }, url: '/api' }, resBase(), next);
    
    // User D - 4 (should block due to global limit)
    const resD = resBase();
    middleware({ headers: { 'x-forwarded-for': '4.4.4.4' }, url: '/api' }, resD, next);

    assert.strictEqual(nextCalled, 3);
    assert.strictEqual(resD.statusCode, 429);
    assert.strictEqual(resD.endedWith, 'Too Many Requests - Global Limit');
  });

  await t.test('deve resetar a contagem aps a janela expirar', async (t) => {
    const middleware = createRateLimiter({ userIpLimit: 1, windowMs: 100 });
    let nextCalled = 0;
    
    const req = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/api/test' };
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      end() {}
    };
    const next = () => { nextCalled++; };

    // Request 1 - passa
    middleware(req, res, next);
    assert.strictEqual(nextCalled, 1);

    // Request 2 - falha (mesma janela)
    middleware(req, res, next);
    assert.strictEqual(nextCalled, 1);
    assert.strictEqual(res.statusCode, 429);

    // Espera a janela expirar
    await new Promise(r => setTimeout(r, 150));

    // Request 3 - passa (nova janela)
    res.statusCode = 200;
    middleware(req, res, next);
    assert.strictEqual(nextCalled, 2);
  });

  await t.test('nao deve vazar query string no log do rate limiter', (t) => {
    const middleware = createRateLimiter({ userIpLimit: 1, windowMs: 1000 });
    let nextCalled = 0;
    
    const req = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/api/login?password=secreta' };
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      end() {}
    };
    const next = () => { nextCalled++; };

    let loggedUrl = '';
    const originalInfo = logger.info;
    logger.info = (msg, data) => { loggedUrl = data.url; };

    // Request 1 - passa
    middleware(req, res, next);
    // Request 2 - bloqueia e loga
    middleware(req, res, next);

    logger.info = originalInfo;

    assert.strictEqual(loggedUrl, '/api/login');
    assert.ok(!loggedUrl.includes('password=secreta'));
  });
});
