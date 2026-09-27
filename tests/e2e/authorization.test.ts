import { describe, expect, it } from 'vitest';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';
import {
  createProtectedTestApp,
  loginTestAgent,
  TEST_AUTH_USER_ID,
} from '../helpers/protected-test-app.js';

async function testApp() {
  return createProtectedTestApp({ userRepository: new FakeUserRepository() }, []);
}

describe('authorization API', () => {
  it('denies an authenticated Super Admin without an explicit permission grant', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);

    const response = await agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
    });
  });

  it('grants access when any one assigned role has the exact permission', async () => {
    const { app, authorizationRepository } = await testApp();
    authorizationRepository.assignRole(TEST_AUTH_USER_ID, 'AUDITOR', 'OPERATOR');
    authorizationRepository.grantRole('OPERATOR', 'user.index');
    const { agent, accessToken } = await loginTestAgent(app);

    await agent.get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(200);
  });

  it('does not treat permission names as wildcards or prefixes', async () => {
    const { app, authorizationRepository } = await testApp();
    authorizationRepository.assignRole(TEST_AUTH_USER_ID, 'OPERATOR');
    authorizationRepository.grantRole('OPERATOR', 'user.*', 'user.index.extra');
    const { agent, accessToken } = await loginTestAgent(app);

    await agent.get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(403);
  });

  it('ignores grants from soft-deleted roles and soft-deleted permissions', async () => {
    const deletedRoleApp = await testApp();
    deletedRoleApp.authorizationRepository.assignRole(TEST_AUTH_USER_ID, 'OPERATOR');
    deletedRoleApp.authorizationRepository.grantRole('OPERATOR', 'user.index');
    deletedRoleApp.authorizationRepository.setRoleDeleted('OPERATOR', true);
    const deletedRoleAgent = await loginTestAgent(deletedRoleApp.app);
    await deletedRoleAgent.agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${deletedRoleAgent.accessToken}`)
      .expect(403);

    const deletedPermissionApp = await testApp();
    deletedPermissionApp.authorizationRepository.assignRole(TEST_AUTH_USER_ID, 'OPERATOR');
    deletedPermissionApp.authorizationRepository.grantRole('OPERATOR', 'user.index');
    deletedPermissionApp.authorizationRepository.setPermissionDeleted('user.index', true);
    const deletedPermissionAgent = await loginTestAgent(deletedPermissionApp.app);
    await deletedPermissionAgent.agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${deletedPermissionAgent.accessToken}`)
      .expect(403);
  });
});
