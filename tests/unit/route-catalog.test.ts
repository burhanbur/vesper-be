import { describe, expect, it } from 'vitest';
import { declarations, mounts } from '../../scripts/route-catalog.js';

describe('source route catalog', () => {
  it('reads multiline declarations without confusing comments or middleware', () => {
    expect(
      declarations(
        `// router.get('/fake', handler)
      router.use(auth); router.post(
        '/login', validate, handler);
      router.get('/:id', handler);`,
        'router',
      ),
    ).toEqual([
      { method: 'POST', path: '/login' },
      { method: 'GET', path: '/:id' },
    ]);
  });
  it('resolves router factories from imports, including conditional mounts', () => {
    expect(
      mounts(`import { createAuthRouter } from './modules/auth/auth.route.js';
      if (enabled) app.use('/api/v1/auth', createAuthRouter(service));
      app.use('/api/v1', limiter);`),
    ).toEqual([{ prefix: '/api/v1/auth', module: './modules/auth/auth.route.js' }]);
  });
});
