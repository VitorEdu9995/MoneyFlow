import { logger } from '../utils/logger.js';

// Armazena requests na memria. Em produo deveria ser Redis.
const store = new Map();

export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const globalLimit = options.globalLimit || 1000;
  const userIpLimit = options.userIpLimit || 100;

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Limpeza de janelas antigas
    for (const [key, timestamps] of store.entries()) {
      const validTimestamps = timestamps.filter(t => t > windowStart);
      if (validTimestamps.length === 0) {
        store.delete(key);
      } else {
        store.set(key, validTimestamps);
      }
    }

    // 1. Limite Global
    const globalTimestamps = store.get('global') || [];
    if (globalTimestamps.length >= globalLimit) {
      logger.info('Global rate limit exceeded', { 
        ip: req.ip || req.connection?.remoteAddress,
        url: req.url 
      });
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      res.statusCode = 429;
      res.end('Too Many Requests - Global Limit');
      return;
    }

    // 2. Limite por IP/User
    let userOrIp = 'unknown';
    if (req.user && req.user.id) {
      userOrIp = `user_${req.user.id}`;
    } else if (req.headers && req.headers['x-forwarded-for']) {
      userOrIp = `ip_${req.headers['x-forwarded-for'].split(',')[0].trim()}`;
    } else if (req.connection && req.connection.remoteAddress) {
      userOrIp = `ip_${req.connection.remoteAddress}`;
    } else if (req.ip) {
      userOrIp = `ip_${req.ip}`;
    }
    
    const key = `user_ip:${userOrIp}`;
    const userTimestamps = store.get(key) || [];
    
    if (userTimestamps.length >= userIpLimit) {
      logger.info('User/IP rate limit exceeded', { 
        identifier: userOrIp, 
        url: req.url 
      });
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      res.setHeader('X-RateLimit-Limit', userIpLimit);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((userTimestamps[0] + windowMs) / 1000));
      
      res.statusCode = 429;
      res.end('Too Many Requests');
      return;
    }

    // Registra request atual
    globalTimestamps.push(now);
    store.set('global', globalTimestamps);

    userTimestamps.push(now);
    store.set(key, userTimestamps);

    // Configura os cabealhos de sucesso
    res.setHeader('X-RateLimit-Limit', userIpLimit);
    res.setHeader('X-RateLimit-Remaining', userIpLimit - userTimestamps.length);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

    if (typeof next === 'function') {
      next();
    }
  };
}

export function clearRateLimitStore() {
  store.clear();
}
