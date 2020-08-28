import { Logging, PlatformConfig } from 'homebridge';
import { Logger } from 'homebridge/lib/logger';
import { Connection } from '../src/nest/connection';

test('works as expected', () => {
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
  const log: Logging = Logger.withPrefix('[test]');
  const connection = new Connection(config, log);
  expect.assertions(1);
  return expect(connection.auth()).resolves.toBeTruthy();
});
