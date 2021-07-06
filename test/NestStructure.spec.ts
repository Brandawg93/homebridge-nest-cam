import { NestStructure } from '../src/nest/structure';
import { NestConfig } from '../src/nest/types/config';
import { auth, getCameras } from '../src/nest/connection';

const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};

test('getFaces and getMembers works as expected', async () => {
  expect.assertions(2);
  const refreshToken = getRefreshToken();
  const accessToken = await auth(refreshToken);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const cameraInfo = (await getCameras(config))[0];
    if (cameraInfo) {
      const structure = new NestStructure(cameraInfo, config);
      const faces = await structure.getFaces();
      expect(faces.length > 0).toBeTruthy();
      const members = await structure.getMembers();
      expect(members.length > 0).toBeTruthy();
    }
  } else {
    throw new Error('Could not connect');
  }
});
