/**
 * Created by Adrian Cable on 7/16/19. - https://github.com/chrisjshull/homebridge-nest/blob/master/lib/nest-connection.js
 * Modified by Brandawg93 on 1/24/20.
 */

const Promise = require('bluebird');
const rp = require('request-promise');

'use strict';

module.exports = Connection;

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

// We want to look like a browser
const USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36';

// Endpoint URLs
const URL_NEST_AUTH = 'https://home.nest.com/session';
const URL_NEST_VERIFY_PIN = 'https://home.nest.com/api/0.1/2fa/verify_pin';

function Connection(config, log) {
    this.config = config;
    this.log = log;
    this.token = '';
}

Connection.prototype.auth = function() {
    return new Promise(resolve => {
        Promise.coroutine(function* () {
            let req, body;

            this.connected = false;
            this.token = null;

            //Only doing google auth from now on
            let issueToken = this.config.googleAuth.issueToken;
            let cookies = this.config.googleAuth.cookies;

            this.log.debug('Authenticating via Google.');
            req = {
                method: 'GET',
                followAllRedirects: true,
                timeout: API_TIMEOUT_SECONDS * 1000,
                uri: issueToken,
                headers: {
                    'Sec-Fetch-Mode': 'cors',
                    'User-Agent': USER_AGENT_STRING,
                    'X-Requested-With': 'XmlHttpRequest',
                    'Referer': 'https://accounts.google.com/o/oauth2/iframe',
                    'cookie': cookies
                },
                json: true
            };
            let result = yield rp(req);
            let googleAccessToken = result.access_token;
            req = {
                method: 'POST',
                followAllRedirects: true,
                timeout: API_TIMEOUT_SECONDS * 1000,
                uri: 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt',
                body: {
                    embed_google_oauth_access_token: true,
                    expire_after: '3600s',
                    google_oauth_access_token: googleAccessToken,
                    policy_id: 'authproxy-oauth-policy'
                },
                headers: {
                    'Authorization': 'Bearer ' + googleAccessToken,
                    'User-Agent': USER_AGENT_STRING,
                    'x-goog-api-key': this.config.googleAuth.apiKey,
                    'Referer': 'https://home.nest.com'
                },
                json: true
            };
            result = yield rp(req);
            this.config.access_token = result.jwt;

            if (this.config.access_token && this.config.googleAuth) {
                req = {
                    method: 'GET',
                    followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    uri: URL_NEST_AUTH,
                    headers: {
                        'Authorization': 'Basic ' + this.config.access_token,
                        'User-Agent': USER_AGENT_STRING
                    },
                    json: true
                };
            } else {
                resolve(false);
                return;
            }

            try {
                body = yield rp(req);
                this.connected = true;
                this.token = body.access_token;
                this.transport_url = body.urls.transport_url;
                this.userid = body.userid;
                resolve(true);
            } catch(error) {
                this.connected = false;
                if (error.statusCode == 400) {
                    this.log.error('Auth failed: access token specified in Homebridge configuration rejected');
                    resolve(false);
                } else if (error.statusCode == 429) {
                    this.log.error('Auth failed: rate limit exceeded. Please try again in 60 minutes');
                    resolve(false);
                } else {
                    this.log.error('Could not authenticate with Nest (code ' + (error.statusCode || (error.cause && error.cause.code)) + '). Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                    Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.auth()).then(connected => resolve(connected));
                }
            }
        }).call(this);
    });
};
