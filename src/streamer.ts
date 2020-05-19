import { Logging } from 'homebridge';
import { TLSSocket, connect } from 'tls';
import { Socket } from 'net';
import { ChildProcess } from 'child_process';
import { NestEndpoints } from './nest-endpoints';
import Pbf from 'pbf';

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
  private ffmpegVideo: ChildProcess;
  private ffmpegAudio: ChildProcess | undefined;
  private authorized = false;
  private readonly log: Logging;
  private sessionID: number = Math.floor(Math.random() * 100);
  private host = '';
  private cameraUUID = '';
  private accessToken = '';
  private socket: TLSSocket = new TLSSocket(new Socket());
  private pendingMessages: Array<any> = [];
  private pendingBuffer: Buffer | undefined;
  private videoChannelID = -1;
  private audioChannelID = -1;

  constructor(
    host: string,
    cameraUUID: string,
    accessToken: string,
    log: Logging,
    ffmpegVideo: ChildProcess,
    ffmpegAudio?: ChildProcess,
  ) {
    this.log = log;
    this.ffmpegVideo = ffmpegVideo;
    this.ffmpegAudio = ffmpegAudio;
    this.host = host;
    this.cameraUUID = cameraUUID;
    this.accessToken = accessToken;
    this.setupConnection();
  }

  /**
   * Close the socket and stop playback
   */
  stopPlayback(): void {
    if (this.socket) {
      this.socket.end();
    }
  }

  // Internal

  /**
   * Setup socket communication and send hello packet
   */
  setupConnection(): void {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    let pingInterval: NodeJS.Timeout;

    this.stopPlayback();
    const options = {
      host: this.host,
      port: 1443,
    };
    this.socket = connect(options, () => {
      self.log.info('[NexusStreamer] Connected');
      self.requestHello();
      pingInterval = setInterval(() => {
        self.sendPingMessage();
      }, 15000);
    });

    this.socket.on('data', (data) => {
      self.handleNexusData(data);
    });

    this.socket.on('end', () => {
      self.unschedulePingMessage(pingInterval);
      self.log.info('[NexusStreamer] Disconnected');
    });
  }

  _processPendingMessages(): void {
    if (this.pendingMessages) {
      const messages = this.pendingMessages;
      this.pendingMessages = [];
      messages.forEach((message) => {
        this._sendMessage(message.type, message.buffer);
      });
    }
  }

  /**
   * Send data to socket
   * @param {number} type The type of packet being sent
   * @param {any} buffer  The information to send
   */
  _sendMessage(type: number, buffer: any): void {
    if (this.socket.connecting || !this.socket.encrypted) {
      this.log.debug('waiting for socket to connect');
      if (!this.pendingMessages) {
        this.pendingMessages = [];
      }
      this.pendingMessages.push({
        type,
        buffer,
      });
      return;
    }

    if (type !== PacketType.HELLO && !this.authorized) {
      this.log.debug('waiting for authorization');
      if (!this.pendingMessages) {
        this.pendingMessages = [];
      }
      this.pendingMessages.push({
        type,
        buffer,
      });
      return;
    }

    let requestBuffer;
    if (type === 0xcd) {
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
    this.socket.write(requestBuffer);
  }

  // Ping

  sendPingMessage(): void {
    this._sendMessage(1, Buffer.alloc(0));
  }

  unschedulePingMessage(pingInterval: NodeJS.Timeout): void {
    clearInterval(pingInterval);
  }

  /**
   * Authenticate the socket session
   */
  requestHello(): void {
    const token = {
      olive_token: this.accessToken,
    };
    const tokenContainer = new Pbf();
    AuthorizeRequest.write(token, tokenContainer);
    const tokenBuffer = tokenContainer.finish();

    const request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: this.cameraUUID,
      require_connected_camera: true,
      user_agent: NestEndpoints.USER_AGENT_STRING,
      client_type: Hello.ClientType.IOS,
      authorize_request: tokenBuffer,
    };
    const pbfContainer = new Pbf();
    Hello.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this._sendMessage(PacketType.HELLO, buffer);
  }

  requestStartPlayback(): void {
    const profiles = [
      StreamProfile.VIDEO_H264_2MBIT_L40,
      StreamProfile.VIDEO_H264_530KBIT_L31,
      StreamProfile.VIDEO_H264_100KBIT_L30,
      StreamProfile.AUDIO_AAC,
    ];
    if (!this.ffmpegAudio) {
      profiles.pop();
    }
    const request = {
      session_id: this.sessionID,
      profile: profiles[0],
      other_profiles: profiles,
    };
    const pbfContainer = new Pbf();
    StartPlayback.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this._sendMessage(PacketType.START_PLAYBACK, buffer);
  }

  handleRedirect(payload: any): void {
    const packet = Redirect.read(payload);
    if (packet.new_host) {
      this.log.info('[NexusStreamer] Redirecting...');
      this.host = packet.new_host;
      this.setupConnection();
      this.requestStartPlayback();
    }
  }

  handlePlaybackBegin(payload: any): void {
    const packet = PlaybackBegin.read(payload);

    if (packet.session_id !== this.sessionID) {
      return;
    }

    for (let i = 0; i < packet.channels.length; i++) {
      const stream = packet.channels[`${i}`];
      if (stream.codec_type === CodecType.H264) {
        this.videoChannelID = stream.channel_id;
      } else if (stream.codec_type === CodecType.AAC) {
        this.audioChannelID = stream.channel_id;
      }
    }
  }

  handlePlaybackPacket(payload: any): void {
    const packet = PlaybackPacket.read(payload);
    if (packet.channel_id === this.videoChannelID) {
      if (this.ffmpegVideo.stdin && !this.ffmpegVideo.stdin?.destroyed) {
        // H264 NAL Units require 0001 added to beginning
        this.ffmpegVideo.stdin.write(
          Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.from(packet.payload)]),
        );
      }
    }
    if (packet.channel_id === this.audioChannelID) {
      if (this.ffmpegAudio && this.ffmpegAudio.stdin && !this.ffmpegAudio.stdin?.destroyed) {
        this.ffmpegAudio.stdin.write(Buffer.from(packet.payload));
      }
    }
  }

  handleNexusPacket(type: number, payload: any): void {
    switch (type) {
      case PacketType.PING:
        this.log.debug('[NexusStreamer] Ping');
        break;
      case PacketType.OK:
        this.log.debug('[NexusStreamer] OK');
        this.authorized = true;
        this._processPendingMessages();
        break;
      case PacketType.ERROR:
        this.log.debug('[NexusStreamer] Error');
        this.stopPlayback();
        break;
      case PacketType.PLAYBACK_BEGIN:
        this.log.debug('[NexusStreamer] Playback Begin');
        this.handlePlaybackBegin(payload);
        break;
      case PacketType.PLAYBACK_END:
        this.log.debug('[NexusStreamer] Playback End');
        break;
      case PacketType.PLAYBACK_PACKET:
        // this.log.debug('[NexusStreamer] Playback Packet');
        this.handlePlaybackPacket(payload);
        break;
      case PacketType.LONG_PLAYBACK_PACKET:
        // this.log.debug('[NexusStreamer] Long Playback Packet');
        this.handlePlaybackPacket(payload);
        break;
      case PacketType.CLOCK_SYNC:
        this.log.debug('[NexusStreamer] Clock Sync');
        break;
      case PacketType.REDIRECT:
        this.log.debug('[NexusStreamer] Redirect');
        this.handleRedirect(payload);
        break;
      default:
        this.log.debug('[NexusStreamer] Unhandled Type: ' + type);
    }
  }

  handleNexusData(data: Buffer): void {
    if (this.pendingBuffer === void 0) {
      this.pendingBuffer = data;
    } else {
      this.pendingBuffer = Buffer.concat([this.pendingBuffer, data]);
    }

    const type = this.pendingBuffer.readUInt8();
    let headerLength = 0;
    let length = 0;
    if (type === PacketType.LONG_PLAYBACK_PACKET) {
      headerLength = 5;
      length = this.pendingBuffer.readUInt32BE(1);
    } else {
      headerLength = 3;
      length = this.pendingBuffer.readUInt16BE(1);
    }
    const payloadEndPosition = length + headerLength;
    if (this.pendingBuffer.length >= payloadEndPosition) {
      const rawPayload = this.pendingBuffer.slice(headerLength, payloadEndPosition);
      const payload = new Pbf(rawPayload);
      this.handleNexusPacket(type, payload);
      const remainingData = this.pendingBuffer.slice(payloadEndPosition);
      this.pendingBuffer = void 0;
      if (remainingData.length !== 0) {
        this.handleNexusData(remainingData);
      }
    }
  }
}
