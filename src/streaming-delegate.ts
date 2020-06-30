import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  Logging,
  PlatformConfig,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  VideoInfo,
  AudioInfo,
} from 'homebridge';
import ip from 'ip';
import { NexusStreamer } from './streamer';
import { NestCam } from './nest-cam';
import { NestEndpoints, handleError } from './nest-endpoints';
import { RtpSplitter } from './rtp-utils';
import { FfmpegProcess, isFfmpegInstalled, doesFfmpegSupportCodec } from './ffmpeg';
import { readFile } from 'fs';
import { join } from 'path';
import querystring from 'querystring';
import getPort from 'get-port';

const pathToFfmpeg = require('ffmpeg-for-homebridge'); // eslint-disable-line @typescript-eslint/no-var-requires

type SessionInfo = {
  address: string; // address of the HAP controller

  videoPort: number;
  returnVideoPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  returnAudioPort: number;
  twoWayAudioPort: number;
  rtpSplitter: RtpSplitter;
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

export class StreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly log: Logging;
  private readonly config: PlatformConfig;
  private customFfmpeg = '';
  private ffmpegCodec: string;
  private camera: NestCam;
  private endpoints: NestEndpoints;
  controller?: CameraController;

  // keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, Array<FfmpegProcess | undefined>> = {};
  ongoingStreams: Record<string, NexusStreamer> = {};

  constructor(hap: HAP, camera: any, config: PlatformConfig, log: Logging) {
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.endpoints = new NestEndpoints(config.options?.fieldTest || false);
    this.camera = camera;
    this.customFfmpeg = config.options?.pathToFfmpeg;
    this.ffmpegCodec = config.ffmpegCodec || 'libx264';
  }

  private async getOfflineImage(callback: SnapshotRequestCallback): Promise<void> {
    const log = this.log;
    readFile(join(__dirname, `../images/offline.jpg`), function (err, data) {
      if (err) {
        log.error(err.message);
        callback(err);
      } else {
        callback(void 0, data);
      }
    });
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    const query = querystring.stringify({
      uuid: this.camera.info.uuid,
      width: request.width,
    });
    if (!this.camera.info.properties['streaming.enabled']) {
      await this.getOfflineImage(callback);
      return;
    }
    try {
      const snapshot = await this.endpoints.sendRequest(
        this.config.access_token,
        `https://${this.camera.info.nexus_api_nest_domain_host}`,
        `/get_image?${query}`,
        'GET',
        'arraybuffer',
      );
      callback(void 0, snapshot);
    } catch (error) {
      handleError(this.log, error, `Error fetching snapshot for ${this.camera.info.name}`);
      callback(error);
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    //video setup
    const video = request.video;
    const videoPort = video.port;
    const returnVideoPort = await getPort();
    const videoCryptoSuite = video.srtpCryptoSuite;
    const videoSrtpKey = video.srtp_key;
    const videoSrtpSalt = video.srtp_salt;
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    //audio setup
    const audio = request.audio;
    const audioPort = audio.port;
    const returnAudioPort = await getPort();
    const twoWayAudioPort = await getPort();
    const audioServerPort = await getPort();
    const audioCryptoSuite = video.srtpCryptoSuite;
    const audioSrtpKey = audio.srtp_key;
    const audioSrtpSalt = audio.srtp_salt;
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: targetAddress,

      videoPort: videoPort,
      returnVideoPort: returnVideoPort,
      videoCryptoSuite: videoCryptoSuite,
      videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
      videoSSRC: videoSSRC,

      audioPort: audioPort,
      returnAudioPort: returnAudioPort,
      twoWayAudioPort: twoWayAudioPort,
      rtpSplitter: new RtpSplitter(audioServerPort, returnAudioPort, twoWayAudioPort),
      audioCryptoSuite: audioCryptoSuite,
      audioSRTP: Buffer.concat([audioSrtpKey, audioSrtpSalt]),
      audioSSRC: audioSSRC,
    };

    const currentAddress = ip.address('public', request.addressVersion); // ipAddress version must match
    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: returnVideoPort,
        ssrc: videoSSRC,

        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      audio: {
        port: audioServerPort,
        ssrc: audioSSRC,

        srtp_key: audioSrtpKey,
        srtp_salt: audioSrtpSalt,
      },
    };

    this.pendingSessions[sessionId] = sessionInfo;
    callback(void 0, response);
  }

  private getVideoCommand(info: VideoInfo, sessionId: string): Array<string> {
    const sessionInfo = this.pendingSessions[sessionId];
    const videoPort = sessionInfo.videoPort;
    const returnVideoPort = sessionInfo.returnVideoPort;
    const videoSsrc = sessionInfo.videoSSRC;
    const videoSRTP = sessionInfo.videoSRTP.toString('base64');
    const address = sessionInfo.address;
    const fps = info.fps;

    const videoPayloadType = info.pt;
    const mtu = info.mtu; // maximum transmission unit

    let command = [
      '-f',
      'h264',
      '-use_wallclock_as_timestamps',
      '1',
      '-r',
      `${fps}`,
      '-i',
      'pipe:',
      '-c:v',
      this.ffmpegCodec,
      '-pix_fmt',
      'yuv420p',
    ];

    if (this.ffmpegCodec === 'libx264') {
      command.splice(10, 0, ...['-preset', 'ultrafast', '-tune', 'zerolatency']);
    }

    if (!this.camera.info.properties['streaming.enabled']) {
      command = [
        '-loop',
        '1',
        '-i',
        join(__dirname, `../images/offline.jpg`),
        '-c:v',
        this.ffmpegCodec,
        '-pix_fmt',
        'yuv420p',
      ];

      if (this.ffmpegCodec === 'libx264') {
        command.splice(8, 0, ...['-preset', 'ultrafast', '-tune', 'stillimage']);
      }
    }

    command = command.concat([
      '-payload_type',
      videoPayloadType.toString(),
      '-ssrc',
      videoSsrc.toString(),
      '-f',
      'rtp',
      '-srtp_out_suite',
      'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params',
      videoSRTP,
      `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${returnVideoPort}&pkt_size=${mtu}`,
    ]);

    return command;
  }

  private getAudioCommand(info: AudioInfo, sessionId: string): Array<string> {
    const sessionInfo = this.pendingSessions[sessionId];
    const address = sessionInfo.address;
    const audioPort = sessionInfo.audioPort;
    const returnAudioPort = sessionInfo.returnAudioPort;
    const audioSsrc = sessionInfo.audioSSRC;
    const audioSRTP = sessionInfo.audioSRTP.toString('base64');

    const audioPayloadType = info.pt;
    const audioMaxBitrate = info.max_bit_rate;
    const sampleRate = info.sample_rate;

    return [
      '-c:a',
      'libfdk_aac',
      '-i',
      'pipe:',
      '-c:a',
      'libfdk_aac',
      '-profile:a',
      'aac_eld',
      '-ac',
      '1',
      '-ar',
      `${sampleRate}k`,
      '-b:a',
      `${audioMaxBitrate}k`,
      '-flags',
      '+global_header',
      '-payload_type',
      audioPayloadType.toString(),
      '-ssrc',
      audioSsrc.toString(),
      '-f',
      'rtp',
      '-srtp_out_suite',
      'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params',
      audioSRTP,
      `srtp://${address}:${audioPort}?rtcpport=${audioPort}&localrtcpport=${returnAudioPort}&pkt_size=188`,
    ];
  }

  private getReturnAudioCommand(info: AudioInfo): Array<string> {
    const audioMaxBitrate = info.max_bit_rate;
    return [
      '-hide_banner',
      '-protocol_whitelist',
      'pipe,udp,rtp,file,crypto',
      '-f',
      'sdp',
      '-c:a',
      'libfdk_aac',
      '-i',
      'pipe:0',
      '-map',
      '0:0',
      '-c:a',
      'libspeex',
      '-frames_per_packet',
      '4',
      '-ac',
      '1',
      '-b:a',
      `${audioMaxBitrate}k`,
      '-ar',
      `16k`,
      '-f',
      'data',
      'pipe:1',
    ];
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];
        const video: VideoInfo = request.video;
        const audio: AudioInfo = request.audio;

        const address = sessionInfo.address;
        const audioSRTP = sessionInfo.audioSRTP.toString('base64');
        const twoWayAudioPort = sessionInfo.twoWayAudioPort;

        const videoProcessor = this.customFfmpeg || pathToFfmpeg || 'ffmpeg';

        if (!(await isFfmpegInstalled(videoProcessor))) {
          this.log.error('FFMPEG is not installed. Please install it before using this plugin.');
          break;
        }

        const videoffmpegCommand = this.getVideoCommand(video, sessionId);
        const ffmpegVideo = new FfmpegProcess(
          'VIDEO',
          videoffmpegCommand,
          this.log,
          callback,
          this,
          sessionId,
          false,
          this.customFfmpeg,
        );

        let ffmpegAudio: FfmpegProcess | undefined;
        let ffmpegReturnAudio: FfmpegProcess | undefined;
        if (this.camera.info.properties['audio.enabled'] && this.camera.info.properties['streaming.enabled']) {
          if (await doesFfmpegSupportCodec('libfdk_aac', videoProcessor)) {
            const audioffmpegCommand = this.getAudioCommand(audio, sessionId);
            ffmpegAudio = new FfmpegProcess(
              'AUDIO',
              audioffmpegCommand,
              this.log,
              undefined,
              this,
              sessionId,
              false,
              this.customFfmpeg,
            );

            if (await doesFfmpegSupportCodec('libspeex', videoProcessor)) {
              const returnAudioffmpegCommand = this.getReturnAudioCommand(audio);
              ffmpegReturnAudio = new FfmpegProcess(
                'RETURN AUDIO',
                returnAudioffmpegCommand,
                this.log,
                undefined,
                this,
                sessionId,
                false,
                this.customFfmpeg,
              );

              const sdpReturnAudio = [
                'v=0',
                'o=- 0 0 IN IP4 127.0.0.1',
                's=Talk',
                `c=IN IP4 ${address}`,
                't=0 0',
                'a=tool:libavformat 58.38.100',
                `m=audio ${twoWayAudioPort} RTP/AVP 110`,
                'b=AS:24',
                'a=rtpmap:110 MPEG4-GENERIC/16000/1',
                'a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=F8F0212C00BC00',
                `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${audioSRTP}`,
              ].join('\n');
              ffmpegReturnAudio.getStdin()?.write(sdpReturnAudio);
              ffmpegReturnAudio.getStdin()?.end();
            } else {
              this.log.error(
                "This version of FFMPEG does not support the audio codec 'libspeex'. You may need to recompile FFMPEG using '--enable-libspeex'.",
              );
            }
          } else {
            this.log.error(
              "This version of FFMPEG does not support the audio codec 'libfdk_aac'. You may need to recompile FFMPEG using '--enable-libfdk_aac'.",
            );
          }
        }

        if (this.camera.info.properties['streaming.enabled']) {
          const streamer = new NexusStreamer(
            this.camera.info,
            this.config.access_token,
            this.log,
            this.config,
            ffmpegVideo,
            ffmpegAudio,
            ffmpegReturnAudio,
          );
          streamer.startPlayback();
          this.ongoingStreams[sessionId] = streamer;
        }

        // Used to switch offline/online stream on-the-fly
        // this.camera.on(NestCamEvents.CAMERA_STATE_CHANGED, (state) => {
        //   ffmpegVideo.stop();
        //   ffmpegAudio?.stop();
        //   ffmpegReturnAudio?.stop();
        //   videoffmpegCommand = this.getVideoCommand(video, sessionId);
        //   ffmpegVideo = new FfmpegProcess(
        //     'VIDEO',
        //     videoffmpegCommand,
        //     this.log,
        //     undefined,
        //     this,
        //     sessionId,
        //     true,
        //     this.customFfmpeg,
        //   );
        //   this.ongoingSessions[sessionId] = [ffmpegVideo, ffmpegAudio, ffmpegReturnAudio];

        //   if (state) {
        //     const streamer = new NexusStreamer(
        //       this.camera.info,
        //       this.config.access_token,
        //       this.log,
        //       ffmpegVideo,
        //       ffmpegAudio,
        //       ffmpegReturnAudio,
        //     );
        //     streamer.startPlayback();
        //     this.ongoingStreams[sessionId] = streamer;
        //   } else {
        //     const streamer = this.ongoingStreams[sessionId];
        //     streamer.stopPlayback();
        //   }
        // });

        this.ongoingSessions[sessionId] = [ffmpegVideo, ffmpegAudio, ffmpegReturnAudio];
        break;
      case StreamRequestTypes.RECONFIGURE:
        // not implemented
        this.log.debug('(Not implemented) Received request to reconfigure to: ' + JSON.stringify(request.video));
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(sessionId);
        callback();
        break;
    }
  }

  public stopStream(sessionId: string): void {
    try {
      if (this.ongoingSessions[sessionId]) {
        const ffmpegVideoProcess = this.ongoingSessions[sessionId][0];
        ffmpegVideoProcess?.stop();
        if (this.ongoingSessions[sessionId].length > 1) {
          const ffmpegAudioProcess = this.ongoingSessions[sessionId][1];
          const ffmpegReturnAudioProcess = this.ongoingSessions[sessionId][2];
          ffmpegAudioProcess?.stop();
          ffmpegReturnAudioProcess?.stop();
        }
      }
      if (this.ongoingStreams[sessionId]) {
        const streamer = this.ongoingStreams[sessionId];
        streamer.stopPlayback();
      }

      const sessionInfo = this.pendingSessions[sessionId];
      sessionInfo.rtpSplitter.close();

      delete this.pendingSessions[sessionId];
      delete this.ongoingSessions[sessionId];
      this.log.debug('Stopped streaming session!');
    } catch (e) {
      this.log.error('Error occurred terminating the video process!');
      this.log.error(e);
    }
  }
}
