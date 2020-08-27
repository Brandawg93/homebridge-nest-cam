import { Logging, PlatformConfig } from 'homebridge';
import { TLSSocket, connect } from 'tls';
import { Socket } from 'net';
import { FfmpegProcess } from '../ffmpeg';
import { NestEndpoints } from './endpoints';
import { CameraInfo } from './models/camera-info';
import Pbf from 'pbf';
import { PlaybackPacket, PacketType } from './protos/PlaybackPacket';
import { Redirect } from './protos/Redirect';
import { Hello } from './protos/Hello';
import { AuthorizeRequest } from './protos/AuthorizeRequest';
import { AudioPayload } from './protos/AudioPayload';
import { StartPlayback } from './protos/StartPlayback';
import { StopPlayback } from './protos/StopPlayback';
import { StreamProfile, PlaybackBegin, CodecType } from './protos/PlaybackBegin';
import { PlaybackEnd } from './protos/PlaybackEnd';
import { Error, ErrorCode } from './protos/Error';

export class NexusStreamer {
  private ffmpegVideo: FfmpegProcess;
  private ffmpegAudio: FfmpegProcess | undefined;
  private ffmpegReturnAudio: FfmpegProcess | undefined;
  private authorized = false;
  private readonly log: Logging;
  private readonly config: PlatformConfig;
  private sessionID: number = Math.floor(Math.random() * 100);
  private cameraInfo: CameraInfo;
  private host = '';
  private accessToken = '';
  private socket: TLSSocket = new TLSSocket(new Socket());
  private pendingMessages: Array<{ type: number; buffer: Uint8Array }> = [];
  private pendingBuffer: Buffer | undefined;
  private videoChannelID = -1;
  private audioChannelID = -1;
  private returnAudioTimeout: NodeJS.Timeout | undefined;
  private started = false;

  constructor(
    cameraInfo: CameraInfo,
    accessToken: string,
    log: Logging,
    config: PlatformConfig,
    ffmpegVideo: FfmpegProcess,
    ffmpegAudio?: FfmpegProcess,
    ffmpegReturnAudio?: FfmpegProcess,
  ) {
    this.log = log;
    this.config = config;
    this.ffmpegVideo = ffmpegVideo;
    this.ffmpegAudio = ffmpegAudio;
    this.ffmpegReturnAudio = ffmpegReturnAudio;
    this.cameraInfo = cameraInfo;
    this.accessToken = accessToken;
    this.host = cameraInfo.direct_nexustalk_host;
    this.setupConnection();
  }

  /**
   * Close the socket and stop playback
   */
  stopPlayback(): void {
    this.started = false;
    if (this.socket) {
      this.sendStopPlayback();
      this.socket.end();
    }
  }

  /**
   * Create the return audio server
   */
  private createReturnAudioServer(): void {
    const self = this;
    const stdout = this.ffmpegReturnAudio?.getStdout();
    if (stdout) {
      stdout.on('data', (chunk) => {
        this.sendAudioPayload(Buffer.from(chunk));

        if (this.returnAudioTimeout) {
          clearTimeout(this.returnAudioTimeout);
        }
        this.returnAudioTimeout = setTimeout(() => {
          self.sendAudioPayload(Buffer.from([]));
        }, 1000);
      });
    }
  }

  /**
   * Setup socket communication and send hello packet
   */
  private setupConnection(): void {
    const self = this;
    let pingInterval: NodeJS.Timeout;

    this.stopPlayback();
    this.createReturnAudioServer();
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

  /**
   * Send messages that were attempted to be sent
   * while the socket was still connecting
   */
  private processPendingMessages(): void {
    if (this.pendingMessages) {
      const messages = this.pendingMessages;
      this.pendingMessages = [];
      messages.forEach((message) => {
        this.sendMessage(message.type, message.buffer);
      });
    }
  }

  /**
   * Send data to socket
   * @param {number} type The type of packet being sent
   * @param {Uint8Array} buffer  The information to send
   */
  private sendMessage(type: number, buffer: Uint8Array): void {
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
      // Long packet
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
    if (!this.socket.destroyed && !this.socket.writableEnded) {
      this.socket.write(requestBuffer);
    }
  }

  // Ping

  /**
   * Send a ping message to keep stream alive
   */
  private sendPingMessage(): void {
    this.sendMessage(1, Buffer.alloc(0));
  }

  /**
   * Stop sending the ping message
   * @param {NodeJS.Timeout} pingInterval The interval object
   */
  private unschedulePingMessage(pingInterval: NodeJS.Timeout): void {
    clearInterval(pingInterval);
  }

  /**
   * Authenticate the socket session
   */
  private requestHello(): void {
    const token = {
      olive_token: this.accessToken,
    };
    const tokenContainer = new Pbf();
    AuthorizeRequest.write(token, tokenContainer);
    const tokenBuffer = tokenContainer.finish();

    const request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: this.cameraInfo.uuid,
      device_id: this.cameraInfo.homebridge_uuid,
      require_connected_camera: false,
      user_agent: NestEndpoints.USER_AGENT_STRING,
      client_type: Hello.ClientType.WEB,
      authorize_request: tokenBuffer,
    };
    const pbfContainer = new Pbf();
    Hello.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.HELLO, buffer);
  }

  /**
   * Update the socket authentication with the new access token
   */
  private updateAuthentication(): void {
    const token = {
      olive_token: this.accessToken,
    };
    const tokenContainer = new Pbf();
    AuthorizeRequest.write(token, tokenContainer);
    const tokenBuffer = tokenContainer.finish();
    this.sendMessage(PacketType.AUTHORIZE_REQUEST, tokenBuffer);
  }

  /**
   * Request that playback start with specific params
   */
  startPlayback(): void {
    this.started = true;
    // Attempt to use camera's stream profile or use default
    let primaryProfile = StreamProfile.VIDEO_H264_2MBIT_L40;
    const otherProfiles: Array<StreamProfile> = [];
    this.cameraInfo.capabilities.forEach((element) => {
      if (element.startsWith('streaming.cameraprofile')) {
        const profile = element.replace('streaming.cameraprofile.', '') as keyof typeof StreamProfile;
        otherProfiles.push(StreamProfile[profile]);
      }
    });

    let index = -1;
    switch (this.config.options?.streamQuality || 3) {
      case 1:
        this.log.debug('Using LOW quality stream.');
        primaryProfile = StreamProfile.VIDEO_H264_100KBIT_L30;
        index = otherProfiles.indexOf(StreamProfile.VIDEO_H264_2MBIT_L40, 0);
        if (index > -1) {
          otherProfiles.splice(index, 1);
        }
        index = otherProfiles.indexOf(StreamProfile.VIDEO_H264_530KBIT_L31, 0);
        if (index > -1) {
          otherProfiles.splice(index, 1);
        }
        break;
      case 2:
        this.log.debug('Using MEDIUM quality stream.');
        primaryProfile = StreamProfile.VIDEO_H264_530KBIT_L31;
        index = otherProfiles.indexOf(StreamProfile.VIDEO_H264_2MBIT_L40, 0);
        if (index > -1) {
          otherProfiles.splice(index, 1);
        }
        break;
      case 3:
        this.log.debug('Using HIGH quality stream.');
        break;
      default:
        this.log.debug('Using HIGH quality stream.');
        break;
    }
    this.cameraInfo.properties['audio.enabled'] && this.ffmpegAudio && otherProfiles.push(StreamProfile.AUDIO_AAC);
    const request = {
      session_id: this.sessionID,
      profile: primaryProfile,
      other_profiles: otherProfiles,
    };
    const pbfContainer = new Pbf();
    StartPlayback.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.START_PLAYBACK, buffer);
  }

  /**
   * Tell the socket to close gracefully
   */
  private sendStopPlayback(): void {
    const request = {
      session_id: this.sessionID,
    };
    const pbfContainer = new Pbf();
    StopPlayback.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.STOP_PLAYBACK, buffer);
  }

  /**
   * Send return audio to the socket
   * @param {Buffer} payload The audio data
   */
  private sendAudioPayload(payload: Buffer): void {
    const request = {
      payload: payload,
      session_id: this.sessionID,
      codec: CodecType.SPEEX,
      sample_rate: 16e3, // Same as 16000
    };

    const pbfContainer = new Pbf();
    AudioPayload.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.AUDIO_PAYLOAD, buffer);
  }

  /**
   * Handle the socket requesting a redirection to a new host
   * @param {Pbf} payload The redirect data
   */
  private handleRedirect(payload: Pbf): void {
    const packet = Redirect.read(payload);
    if (packet.new_host) {
      this.log.info('[NexusStreamer] Redirecting...');
      this.host = packet.new_host;
      this.setupConnection();
      this.startPlayback();
    }
  }

  /**
   * Get stream ready for playback via socket info
   * @param {Pbf} payload The playback data
   */
  private handlePlaybackBegin(payload: Pbf): void {
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

  /**
   * Sends playback packet from Nest to Homekit
   * @param {Pbf} payload The stream data
   */
  private handlePlaybackPacket(payload: Pbf): void {
    const packet = PlaybackPacket.read(payload);
    if (packet.channel_id === this.videoChannelID) {
      // H264 NAL Units require 0001 added to beginning
      const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const stdin = this.ffmpegVideo.getStdin();
      if (!stdin?.destroyed && !stdin?.writableEnded) {
        stdin?.write(Buffer.concat([startCode, Buffer.from(packet.payload)]));
      }
    }
    if (packet.channel_id === this.audioChannelID) {
      const stdin = this.ffmpegAudio?.getStdin();
      if (!stdin?.destroyed && !stdin?.writableEnded) {
        stdin?.write(Buffer.from(packet.payload));
      }
    }
  }

  /**
   * Handle if the stream ended in error
   * @param {Pbf} payload The playback end data
   */
  private handlePlaybackEnd(payload: Pbf): void {
    const packet = PlaybackEnd.read(payload);
    if (packet.reason === PlaybackEnd.Reason.ERROR_TIME_NOT_AVAILABLE && !this.started) {
      setTimeout(() => {
        this.startPlayback();
      }, 1000);
    }
  }

  /**
   * Handle socket errors
   * @param {Pbf} payload The error data
   */
  private handleNexusError(payload: Pbf): void {
    const packet = Error.read(payload);
    if (packet.code === ErrorCode.ERROR_AUTHORIZATION_FAILED) {
      this.log.debug('[NexusStreamer] Updating authentication');
      this.updateAuthentication();
    } else {
      this.log.error(`[NexusStreamer] Error: ${packet.message}`);
      this.stopPlayback();
    }
  }

  /**
   * Handle nexus packets
   * @param {number} type The type of packet
   * @param {Pbf} payload The packet data
   */
  private handleNexusPacket(type: number, payload: Pbf): void {
    switch (type) {
      case PacketType.PING:
        this.log.debug('[NexusStreamer] Ping');
        break;
      case PacketType.OK:
        this.log.debug('[NexusStreamer] OK');
        this.authorized = true;
        this.processPendingMessages();
        break;
      case PacketType.ERROR:
        this.handleNexusError(payload);
        break;
      case PacketType.PLAYBACK_BEGIN:
        this.log.debug('[NexusStreamer] Playback Begin');
        this.handlePlaybackBegin(payload);
        break;
      case PacketType.PLAYBACK_END:
        this.log.debug('[NexusStreamer] Playback End');
        this.handlePlaybackEnd(payload);
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
      case PacketType.TALKBACK_BEGIN:
        this.log.info('[NexusStreamer] Talkback Begin');
        break;
      case PacketType.TALKBACK_END:
        this.log.info('[NexusStreamer] Talkback End');
        break;
      default:
        this.log.debug('[NexusStreamer] Unhandled Type: ' + type);
    }
  }

  /**
   * Handle raw data from the socket
   * @param {Buffer} data The raw data
   */
  private handleNexusData(data: Buffer): void {
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
