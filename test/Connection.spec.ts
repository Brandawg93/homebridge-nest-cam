import { Logger, Logging, PlatformConfig } from 'homebridge';
import { Connection } from '../src/nest-connection';

test('Nest Connection', () => {
  const config: PlatformConfig = {
    platform: 'test',
    googleAuth: {
      issueToken: process.env.ISSUE_TOKEN,
      cookies: process.env.COOKIES,
      apiKey: process.env.API_KEY,
    },
    options: {
      fieldTest: false,
    },
  };
  const log: Logging = Logger.withPrefix('[test]');
  const connection = new Connection(config, log);
  connection.auth().then((connected) => {
    expect(connected).toBe(true);
  });
});
