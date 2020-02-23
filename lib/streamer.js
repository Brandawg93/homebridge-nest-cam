'use strict';

const crypto = require('crypto');
const tls = require('tls');
const PBF = require('pbf');
const EventEmitter = require('events');
const ip = require('ip');
const spawn = require('child_process').spawn;

const StreamProfile = require('./protos/PlaybackBegin.js').StreamProfile;
const PlaybackPacket = require('./protos/PlaybackPacket.js').PlaybackPacket;
const PacketType = require('./protos/PlaybackPacket.js').PacketType;
const PlaybackBegin = require('./protos/PlaybackBegin.js').PlaybackBegin;
const CodecType = require('./protos/PlaybackBegin.js').CodecType;
const Redirect = require('./protos/Redirect.js').Redirect;
const StartPlayback = require('./protos/StartPlayback.js').StartPlayback;
const Hello = require('./protos/Hello.js').Hello;
const AuthorizeRequest = require('./protos/AuthorizeRequest.js').AuthorizeRequest;

class NexusStreamer extends EventEmitter {
  constructor(host, cameraUUID, accessToken, ffmpegCodec, log) {
    super();
    let self = this;
    self.isStreaming = false;
    self.authorized = false;
    self.ffmpegCodec = ffmpegCodec;
    self.log = log;
    self.sessionID = Math.floor(Math.random() * 100);
    self.host = host;
    self.cameraUUID = cameraUUID;
    self.accessToken = accessToken;
  }

  startPlaybackWithRequest(request) {
    let self = this;

    if (self.isStreaming) {
      self.log.debug('Streamer is currently streaming!!!');
      return;
    }

    self.isStreaming = true;
    self.setupFFMPEGPipe(request);
    self.requestStartPlayback();
  }

  stopPlayback() {
    let self = this;

    if (!self.isStreaming) {
      return;
    }

    self.unschedulePingMessage();

    if (self.ffmpeg) {
      self.ffmpeg.kill('SIGKILL');
      self.ffmpeg = void 0;
    }
    if (self.socket) {
      self.isStreaming = false;
      self.socket.end();
      self.socket = void 0;
    }
  }

  // Internal

  setupConnection() {
    let self = this;

    if (self.socket) {
      self.unschedulePingMessage();
      self.socket.end();
      self.socket = void 0;
    }

    let options = {
      host: self.host,
      port: 1443
    };
    self.socket = tls.connect(options, () => {
      self.log.info('[NexusStreamer] Connected');
      self.requestHello();
    });

    self.socket.on('data', (data) => {
      self.handleNexusData(data);
    });

    self.socket.on('end', () => {
      self.unschedulePingMessage();
      self.log.info('[NexusStreamer] Disconnected');
    });
  }

  _processPendingMessages() {
    let self = this;
    if (self.pendingMessages) {
      let messages = self.pendingMessages;
      self.pendingMessages = void 0;
      messages.forEach((message) => {
        self._sendMessage(message.type, message.buffer);
      });
    }
  }

  _sendMessage(type, buffer) {
    let self = this;

    if (self.socket.connecting || !self.socket.encrypted) {
      self.log.debug('waiting for socket to connect');
      if (!self.pendingMessages) {
        self.pendingMessages = [];
      }
      self.pendingMessages.push({
        type,
        buffer
      });
      return;
    }

    if (type !== PacketType.HELLO && !self.authorized) {
      self.log.debug('waiting for authorization');
      if (!self.pendingMessages) {
        self.pendingMessages = [];
      }
      self.pendingMessages.push({
        type,
        buffer
      });
      return;
    }

    let requestBuffer;
    if (type === 0xCD) {
      requestBuffer = Buffer.alloc(5);
      requestBuffer[0] = type;
      requestBuffer.writeUInt32BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    } else {
      requestBuffer = Buffer.alloc(3);
      requestBuffer[0] = type;
      requestBuffer.writeUInt16BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    }
    self.socket.write(requestBuffer);
  }

  // Ping

  sendPingMessage() {
    let self = this;
    self._sendMessage(1, Buffer.alloc(0));
  }

  schedulePingMessage() {
    let self = this;

    if (self.pingInterval) {
      return;
    }

    self.pingInterval = setInterval(() => {
      self.sendPingMessage();
    }, 15000);
  }

  unschedulePingMessage() {
    let self = this;

    let interval = self.pingInterval;
    if (!interval) {
      return;
    }

    self.pingInterval = void 0;
    clearInterval(interval);
  }

  requestHello() {
    let self = this;
    let token = {
      olive_token: self.accessToken
    };
    let tokenContainer = new PBF();
    AuthorizeRequest.write(token, tokenContainer);
    let tokenBuffer = tokenContainer.finish();

    let request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: self.cameraUUID,
      require_connected_camera: true,
      user_agent: 'iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin',
      client_type: Hello.ClientType.IOS,
      authorize_request: tokenBuffer
    };
    let pbfContainer = new PBF();
    Hello.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    self._sendMessage(PacketType.HELLO, buffer);
  }

  requestStartPlayback() {
    let self = this;
    let request = {
      session_id: self.sessionID,
      profile: StreamProfile.AVPROFILE_HD_MAIN_1,
      other_profiles: [
        StreamProfile.VIDEO_H264_2MBIT_L40,
        StreamProfile.VIDEO_H264_530KBIT_L31,
        StreamProfile.AVPROFILE_MOBILE_1,
        StreamProfile.AVPROFILE_HD_MAIN_1
      ],
      profile_not_found_action: StartPlayback.ProfileNotFoundAction.REDIRECT
    };
    let pbfContainer = new PBF();
    StartPlayback.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    self._sendMessage(PacketType.START_PLAYBACK, buffer);
  }

  handleRedirect(payload) {
    let self = this;
    let packet = Redirect.read(payload);
    if (packet.new_host) {
      self.log.info('[NexusStreamer] Redirecting...');
      self.host = packet.new_host;
      self.setupConnection();
      self.requestStartPlayback();
    }
  }

  handlePlaybackBegin(payload) {
    let self = this;
    let packet = PlaybackBegin.read(payload);

    if (packet.session_id !== self.sessionID) {
      return;
    }

    for (let i = 0; i < packet.channels.length; i++) {
      var stream = packet.channels[i];
      if (stream.codec_type === CodecType.H264) {
        self.videoChannelID = stream.channel_id;
      } else if (stream.codec_type === CodecType.AAC || stream.codec_type === CodecType.OPUS) {
        self.audioChannelID = stream.channel_id;
      }
    }
  }

  handlePlaybackPacket(payload) {
    let self = this;
    let packet = PlaybackPacket.read(payload);
    if (packet.channel_id === self.videoChannelID) {
      if (!self.ffmpeg) {
        return;
      }
      self.ffmpeg.stdin.write(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.from(packet.payload)]));
    }
  }

  handleNexusPacket(type, payload) {
    let self = this;
    switch(type) {
    case PacketType.PING:
      self.log.debug('[NexusStreamer] Ping');
      break;
    case PacketType.OK:
      self.log.debug('[NexusStreamer] OK');
      self.authorized = true;
      self._processPendingMessages();
      self.schedulePingMessage();
      break;
    case PacketType.ERROR:
      self.log.debug('[NexusStreamer] Error');
      self.stopPlayback();
      break;
    case PacketType.PLAYBACK_BEGIN:
      self.log.debug('[NexusStreamer] Playback Begin');
      self.handlePlaybackBegin(payload);
      break;
    case PacketType.PLAYBACK_END:
      self.log.debug('[NexusStreamer] Playback End');
      break;
    case PacketType.PLAYBACK_PACKET:
      // self.log.debug('[NexusStreamer] Playback Packet');
      self.handlePlaybackPacket(payload);
      break;
    case PacketType.LONG_PLAYBACK_PACKET:
      // self.log.debug('[NexusStreamer] Long Playback Packet');
      self.handlePlaybackPacket(payload);
      break;
    case PacketType.CLOCK_SYNC:
      self.log.debug('[NexusStreamer] Clock Sync');
      break;
    case PacketType.REDIRECT:
      self.log.debug('[NexusStreamer] Redirect');
      self.handleRedirect(payload);
      break;
    default:
      self.log.debug('[NexusStreamer] Unhandled Type: ' + type);
    }
  }

  handleNexusData(data) {
    let self = this;
    if (self.pendingBuffer === void 0) {
      self.pendingBuffer = data;
    } else {
      self.pendingBuffer = Buffer.concat([self.pendingBuffer, data]);
    }

    const type = self.pendingBuffer.readUInt8();
    var headerLength = 0;
    var length = 0;
    if (type === PacketType.LONG_PLAYBACK_PACKET) {
      headerLength = 5;
      length = self.pendingBuffer.readUInt32BE(1);
    } else {
      headerLength = 3;
      length = self.pendingBuffer.readUInt16BE(1);
    }
    var payloadEndPosition = length + headerLength;
    if (self.pendingBuffer.length >= payloadEndPosition) {
      const rawPayload = self.pendingBuffer.slice(headerLength, payloadEndPosition);
      const payload = new PBF(rawPayload);
      self.handleNexusPacket(type, payload);
      const remainingData = self.pendingBuffer.slice(payloadEndPosition);
      self.pendingBuffer = void 0;
      if (remainingData.length !== 0) {
        self.handleNexusData(remainingData);
      }
    }
  }

  // HAP Streaming

  prepareStream(request, callback) {
    let self = this;
    self.setupConnection();

    let sessionInfo = {};
    let targetAddress = request['targetAddress'];
    sessionInfo['address'] = targetAddress;

    let response = {};

    let videoInfo = request['video'];
    if (videoInfo) {
      let port = videoInfo['port'];
      let srtp_key = videoInfo['srtp_key'];
      let srtp_salt = videoInfo['srtp_salt'];

      // SSRC is a 32 bit integer that is unique per stream
      let ssrcSource = crypto.randomBytes(4);
      ssrcSource[0] = 0;
      let ssrc = ssrcSource.readInt32BE(0, true);

      let videoResp = {
        port,
        ssrc,
        srtp_key,
        srtp_salt
      };

      response['video'] = videoResp;

      sessionInfo['video_port'] = port;
      sessionInfo['video_srtp'] = Buffer.concat([srtp_key, srtp_salt]);
      sessionInfo['video_ssrc'] = ssrc;
    }

    let audioInfo = request['audio'];
    if (audioInfo) {
      let port = audioInfo['port'];
      let srtp_key = audioInfo['srtp_key'];
      let srtp_salt = audioInfo['srtp_salt'];

      // SSRC is a 32 bit integer that is unique per stream
      let ssrcSource = crypto.randomBytes(4);
      ssrcSource[0] = 0;
      let ssrc = ssrcSource.readInt32BE(0, true);

      let audioResp = {
        port,
        ssrc,
        srtp_key,
        srtp_salt
      };

      response['audio'] = audioResp;

      sessionInfo['audio_port'] = port;
      sessionInfo['audio_srtp'] = Buffer.concat([srtp_key, srtp_salt]);
      sessionInfo['audio_ssrc'] = ssrc;
    }

    let currentAddress = ip.address();
    let addressResp = {
      address: currentAddress
    };

    if (ip.isV4Format(currentAddress)) {
      addressResp['type'] = 'v4';
    } else {
      addressResp['type'] = 'v6';
    }

    response['address'] = addressResp;
    self.sessionInfo = sessionInfo;

    callback(response);
  }

  setupFFMPEGPipe(request) {
    let self = this;
    let sessionInfo = self.sessionInfo;

    if (sessionInfo) {
      let fps = 30;

      let videoInfo = request['video'];
      if (videoInfo) {
        fps = videoInfo['fps'];
      }

      let targetAddress = sessionInfo['address'];
      let targetVideoPort = sessionInfo['video_port'];
      let videoKey = sessionInfo['video_srtp'];
      let videoSsrc = sessionInfo['video_ssrc'];

      let targetAudioPort = sessionInfo['audio_port'];
      let audioKey = sessionInfo['audio_srtp'];
      let audioSsrc = sessionInfo['audio_ssrc'];

      let x264Params = '';
      if (self.ffmpegCodec === 'libx264') {
        x264Params = '-preset ultrafast -tune zerolatency ';
      }

      let ffmpegCommand = '-i - -c:v ' + self.ffmpegCodec + ' -an -pix_fmt yuv420p -r ' + fps + ' -f rawvideo ' + x264Params + '-payload_type 99 -ssrc ' + videoSsrc + ' -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' + videoKey.toString('base64') + ' srtp://'+targetAddress+':' + targetVideoPort+'?rtcpport='+targetVideoPort+'&localrtcpport='+targetVideoPort+'&pkt_size=1316';
      //audio - https://github.com/KhaosT/homebridge-camera-ffmpeg/issues/9
      //ffmpegCommand += ' -c:a libfdk_aac -profile:a aac_eld -vn -ac 1 -ar 16000 -b:a 8000 -flags +global_header -payload_type 110 -ssrc ' + audioSsrc + ' -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params '+audioKey.toString('base64')+' -rtsp_transport tcp srtp://'+targetAddress+':'+targetAudioPort+'?rtcpport='+targetAudioPort+'&localrtcpport='+targetAudioPort+'&pkt_size=188';

      let ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});
      ffmpeg.stdin.on('error', (e) => {
        if (e.code !== 'EPIPE') {
          self.log.error(e.code);
        }
        self.stopPlayback();
      });
      ffmpeg.stderr.on('data', (data) => {
        self.log.debug(`${data}`);
      });
      self.ffmpeg = ffmpeg;
    }
  }
}

module.exports = {
  NexusStreamer
};
