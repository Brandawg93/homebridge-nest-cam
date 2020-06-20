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
import { NestEndpoints } from './nest-endpoints';
import { FfmpegProcess, isFfmpegInstalled, doesFfmpegSupportCodec } from './ffmpeg';
import { readFile } from 'fs';
import { join } from 'path';
import querystring from 'querystring';
import getPort from 'get-port';

const pathToFfmpeg = require('ffmpeg-for-homebridge'); // eslint-disable-line @typescript-eslint/no-var-requires

type SessionInfo = {
  address: string; // address of the HAP controller

  videoPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  returnAudioPort: number;
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

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    const query = querystring.stringify({
      uuid: this.camera.info.uuid,
      width: request.width,
    });
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
      if (error.response) {
        const status = parseInt(error.response.status);
        const message = 'Error fetching snapshot';
        if (status >= 500) {
          this.log.debug(`${message}: ${status}`);
        } else if (status === 404) {
          const log = this.log;
          readFile(join(__dirname, `../images/offline.jpg`), function (err, data) {
            if (err) {
              log.error(err.message);
              callback(err);
            } else {
              callback(void 0, data);
            }
          });
        } else {
          this.log.error(`${message}: ${status}`);
          callback(error);
        }
      } else {
        this.log.error(error);
        callback(error);
      }
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    if (this.camera.info.is_streaming_enabled) {
      const sessionId: StreamSessionIdentifier = request.sessionID;
      const targetAddress = request.targetAddress;

      //video stuff
      const video = request.video;
      const videoPort = video.port;

      const videoCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
      const videoSrtpKey = video.srtp_key;
      const videoSrtpSalt = video.srtp_salt;

      const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

      //audio stuff
      const audio = request.audio;
      const audioPort = audio.port;
      const returnAudioPort = await getPort();

      const audioCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
      const audioSrtpKey = audio.srtp_key;
      const audioSrtpSalt = audio.srtp_salt;

      const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

      const sessionInfo: SessionInfo = {
        address: targetAddress,

        videoPort: videoPort,
        videoCryptoSuite: videoCryptoSuite,
        videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
        videoSSRC: videoSSRC,

        audioPort: audioPort,
        returnAudioPort: returnAudioPort,
        audioCryptoSuite: audioCryptoSuite,
        audioSRTP: Buffer.concat([audioSrtpKey, audioSrtpSalt]),
        audioSSRC: audioSSRC,
      };

      const currentAddress = ip.address('public', request.addressVersion); // ipAddress version must match
      const response: PrepareStreamResponse = {
        address: currentAddress,
        video: {
          port: videoPort,
          ssrc: videoSSRC,

          srtp_key: videoSrtpKey,
          srtp_salt: videoSrtpSalt,
        },
        audio: {
          port: returnAudioPort,
          ssrc: audioSSRC,

          srtp_key: audioSrtpKey,
          srtp_salt: audioSrtpSalt,
        },
      };

      this.pendingSessions[sessionId] = sessionInfo;
      callback(void 0, response);
    }
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];
        const video: VideoInfo = request.video;
        const audio: AudioInfo = request.audio;

        const videoPayloadType = video.pt;
        const audioPayloadType = audio.pt;
        const audioMaxBitrate = audio.max_bit_rate;
        const sampleRate = audio.sample_rate;
        const mtu = video.mtu; // maximum transmission unit

        const address = sessionInfo.address;
        const videoPort = sessionInfo.videoPort;
        const audioPort = sessionInfo.audioPort;
        const returnAudioPort = sessionInfo.returnAudioPort;
        const videoSsrc = sessionInfo.videoSSRC;
        const audioSsrc = sessionInfo.audioSSRC;
        const videoSRTP = sessionInfo.videoSRTP.toString('base64');
        const audioSRTP = sessionInfo.audioSRTP.toString('base64');

        const videoffmpegCommand = [
          '-f',
          'h264',
          '-use_wallclock_as_timestamps',
          '1',
          '-probesize',
          '100000',
          '-i',
          'pipe:',
          '-c:v',
          this.ffmpegCodec,
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
          `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`,
        ];

        if (this.ffmpegCodec === 'libx264') {
          videoffmpegCommand.splice(8, 0, ...['-preset', 'ultrafast', '-tune', 'zerolatency']);
        }

        const audioffmpegCommand = [
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
          `srtp://${address}:${audioPort}?rtcpport=${audioPort}&localrtcpport=${audioPort}&pkt_size=188`,
        ];

        const returnAudioffmpegCommand = [
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

        const videoProcessor = this.customFfmpeg || pathToFfmpeg || 'ffmpeg';

        if (!(await isFfmpegInstalled(videoProcessor))) {
          this.log.error('FFMPEG is not installed. Please install it before using this plugin.');
          break;
        }

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
        if (this.camera.info.properties['audio.enabled']) {
          if (await doesFfmpegSupportCodec('libfdk_aac', videoProcessor)) {
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
                `c=IN IP4 ${address}`,
                `m=audio ${returnAudioPort} RTP/AVP 110`,
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

        const streamer = new NexusStreamer(
          this.camera.info,
          this.config.access_token,
          this.log,
          ffmpegVideo,
          ffmpegAudio,
          ffmpegReturnAudio,
        );
        this.ongoingSessions[sessionId] = [ffmpegVideo, ffmpegAudio, ffmpegReturnAudio];
        this.ongoingStreams[sessionId] = streamer;

        delete this.pendingSessions[sessionId];
        streamer.startPlayback();
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
        const streamer = this.ongoingStreams[sessionId];
        streamer.stopPlayback();
        const ffmpegVideoProcess = this.ongoingSessions[sessionId][0];
        ffmpegVideoProcess?.stop();
        if (this.ongoingSessions[sessionId].length > 1) {
          const ffmpegAudioProcess = this.ongoingSessions[sessionId][1];
          const ffmpegReturnAudioProcess = this.ongoingSessions[sessionId][2];
          ffmpegAudioProcess?.stop();
          ffmpegReturnAudioProcess?.stop();
        }
      }

      delete this.ongoingSessions[sessionId];
      this.log.debug('Stopped streaming session!');
    } catch (e) {
      this.log.error('Error occurred terminating the video process!');
      this.log.error(e);
    }
  }
}
