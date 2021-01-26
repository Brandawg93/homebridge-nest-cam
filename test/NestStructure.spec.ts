import { NestStructure } from '../src/nest/structure';
import { NestConfig } from '../src/nest/models/config';
import { auth, getCameras } from '../src/nest/connection';

const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};

test('getFaces works as expected', async () => {
  expect.assertions(1);
  const refreshToken = getRefreshToken();
  const accessToken = await auth(refreshToken);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const cameraInfo = (await getCameras(config))[0];
    const structure = new NestStructure(cameraInfo, config);
    const faces = await structure.getFaces();
    return expect(faces.length > 0).toBeTruthy();
  } else {
    throw new Error('Could not connect');
  }
});

test('getMembers works as expected', async () => {
  expect.assertions(1);
  const refreshToken = getRefreshToken();
  const accessToken = await auth(refreshToken);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const cameraInfo = (await getCameras(config))[0];
    const structure = new NestStructure(cameraInfo, config);
    const members = await structure.getMembers();
    return expect(members.length > 0).toBeTruthy();
  } else {
    throw new Error('Could not connect');
  }
});
