'use strict';

const USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36';

var endpoint = {};

endpoint.init = function(fieldTestMode) {
    let apiHostname, cameraApiHostname, grpcHostname, camAuthCookie;

    if (fieldTestMode) {
        apiHostname = 'https://home.ft.nest.com';
        cameraApiHostname = 'https://webapi.camera.home.ft.nest.com';
        grpcHostname = 'grpc-web.ft.nest.com';
        camAuthCookie = 'website_ft';
    } else {
        apiHostname = 'https://home.nest.com';
        cameraApiHostname = 'https://webapi.camera.home.nest.com';
        grpcHostname = 'grpc-web.production.nest.com';
        camAuthCookie = 'website_2';
    }

    endpoint.USER_AGENT_STRING = USER_AGENT_STRING;
    endpoint.NEST_API_HOSTNAME = apiHostname;
    endpoint.CAMERA_API_HOSTNAME = cameraApiHostname;
    endpoint.CAMERA_AUTH_COOKIE = camAuthCookie;
};

module.exports = endpoint;
