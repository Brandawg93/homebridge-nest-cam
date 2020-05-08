import {
  Logging,
  StreamingRequest
} from 'homebridge';
import { TLSSocket, connect } from 'tls';
import { Socket } from 'net';
import { APIError } from './errors';
import { ChildProcess } from 'child_process';
import { NestEndpoints } from './nest-endpoints';

const PBF = require('pbf');

const StreamProfile = require('./protos/PlaybackBegin.js').StreamProfile;
const PlaybackPacket = require('./protos/PlaybackPacket.js').PlaybackPacket;
const PacketType = require('./protos/PlaybackPacket.js').PacketType;
const PlaybackBegin = require('./protos/PlaybackBegin.js').PlaybackBegin;
const CodecType = require('./protos/PlaybackBegin.js').CodecType;
const Redirect = require('./protos/Redirect.js').Redirect;
const StartPlayback = require('./protos/StartPlayback.js').StartPlayback;
const Hello = require('./protos/Hello.js').Hello;
const AuthorizeRequest = require('./protos/AuthorizeRequest.js').AuthorizeRequest;

export class NexusStreamer {
  private ffmpeg: ChildProcess;
  private authorized: boolean = false;
  private readonly log: Logging;
  private sessionID: number = Math.floor(Math.random() * 100);
  private host: string = '';
  private cameraUUID: string = '';
  private accessToken: string = '';
  private socket: TLSSocket = new TLSSocket(new Socket());
  private pendingMessages: any[] = [];
  private pendingBuffer: any;
  private videoChannelID: number = -1;
  private audioChannelID: number = -1;

  constructor(ffmpeg: ChildProcess, host: string, cameraUUID: string, accessToken: string, log: Logging) {
    this.log = log;
    this.ffmpeg = ffmpeg;
    this.host = host;
    this.cameraUUID = cameraUUID;
    this.accessToken = accessToken;
    this.setupConnection();
  }

  stopPlayback() {
    if (this.socket) {
      this.socket.end();
    }
  }

  // Internal

  setupConnection() {
    let self = this;
    let pingInterval: NodeJS.Timeout;

    self.stopPlayback();
    let options = {
      host: self.host,
      port: 1443
    };
    self.socket = connect(options, () => {
      self.log.info('[NexusStreamer] Connected');
      self.requestHello();
      pingInterval = setInterval(() => {
        self.sendPingMessage();
      }, 15000);
    });

    self.socket.on('data', (data) => {
      self.handleNexusData(data);
    });

    self.socket.on('end', () => {
      self.unschedulePingMessage(pingInterval);
      self.log.info('[NexusStreamer] Disconnected');
    });
  }

  _processPendingMessages() {
    let self = this;
    if (self.pendingMessages) {
      let messages = self.pendingMessages;
      self.pendingMessages = [];
      messages.forEach((message) => {
        self._sendMessage(message.type, message.buffer);
      });
    }
  }

  _sendMessage(type: number, buffer: any) {
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
    this._sendMessage(1, Buffer.alloc(0));
  }

  unschedulePingMessage(pingInterval: NodeJS.Timeout) {
    clearInterval(pingInterval);
  }

  requestHello() {
    let token = {
      olive_token: this.accessToken
    };
    let tokenContainer = new PBF();
    AuthorizeRequest.write(token, tokenContainer);
    let tokenBuffer = tokenContainer.finish();

    let request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: this.cameraUUID,
      require_connected_camera: true,
      user_agent: NestEndpoints.USER_AGENT_STRING,
      client_type: Hello.ClientType.IOS,
      authorize_request: tokenBuffer
    };
    let pbfContainer = new PBF();
    Hello.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    this._sendMessage(PacketType.HELLO, buffer);
  }

  requestStartPlayback() {
    let profiles = [
      StreamProfile.VIDEO_H264_2MBIT_L40,
      StreamProfile.VIDEO_H264_530KBIT_L31,
      StreamProfile.VIDEO_H264_100KBIT_L30,
      StreamProfile.AUDIO_AAC
    ];
    let request = {
      session_id: this.sessionID,
      profile: profiles[0],
      other_profiles: profiles
    };
    let pbfContainer = new PBF();
    StartPlayback.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    this._sendMessage(PacketType.START_PLAYBACK, buffer);
  }

  handleRedirect(payload: any) {
    let packet = Redirect.read(payload);
    if (packet.new_host) {
      this.log.info('[NexusStreamer] Redirecting...');
      this.host = packet.new_host;
      this.setupConnection();
      this.requestStartPlayback();
    }
  }

  handlePlaybackBegin(payload: any) {
    let packet = PlaybackBegin.read(payload);

    if (packet.session_id !== this.sessionID) {
      return;
    }

    for (let i = 0; i < packet.channels.length; i++) {
      let stream = packet.channels[`${i}`];
      if (stream.codec_type === CodecType.H264) {
        this.videoChannelID = stream.channel_id;
      } else if (stream.codec_type === CodecType.AAC) {
        this.audioChannelID = stream.channel_id;
      }
    }
  }

  handlePlaybackPacket(payload: any) {
    let packet = PlaybackPacket.read(payload);
    if (packet.channel_id === this.videoChannelID) {
      if (this.ffmpeg.stdin) {
        // H264 NAL Units require 0001 added to beginning
        this.ffmpeg.stdin.write(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.from(packet.payload)]));
      }
    }
  }

  handleNexusPacket(type: number, payload: any) {
    let self = this;
    switch(type) {
    case PacketType.PING:
      self.log.debug('[NexusStreamer] Ping');
      break;
    case PacketType.OK:
      self.log.debug('[NexusStreamer] OK');
      self.authorized = true;
      self._processPendingMessages();
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

  handleNexusData(data: any) {
    let self = this;
    if (self.pendingBuffer === void 0) {
      self.pendingBuffer = data;
    } else {
      self.pendingBuffer = Buffer.concat([self.pendingBuffer, data]);
    }

    const type = self.pendingBuffer.readUInt8();
    let headerLength = 0;
    let length = 0;
    if (type === PacketType.LONG_PLAYBACK_PACKET) {
      headerLength = 5;
      length = self.pendingBuffer.readUInt32BE(1);
    } else {
      headerLength = 3;
      length = self.pendingBuffer.readUInt16BE(1);
    }
    let payloadEndPosition = length + headerLength;
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
}
