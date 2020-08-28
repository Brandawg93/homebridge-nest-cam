import { Logging, PlatformConfig } from 'homebridge';
import { Logger } from 'homebridge/lib/logger';
import { NestUser } from '../src/nest/user';
import { Connection } from '../src/nest/connection';

const log: Logging = Logger.withPrefix('[test]');

test('getSessionInfo works as expected', async () => {
  expect.assertions(1);
  const config: PlatformConfig = {
    platform: 'test',
    googleAuth: {
      issueToken: process.env.ISSUE_TOKEN,
      cookies: process.env.COOKIES,
    },
    options: {
      fieldTest: false,
    },
  };
  const connection = new Connection(config, log);
  const connected = await connection.auth();
  if (connected) {
    const user = new NestUser(config, log);
    const session = await user.getSessionInfo();
    return expect(session).toBeDefined();
  } else {
    throw new Error('Could not connect');
  }
});
