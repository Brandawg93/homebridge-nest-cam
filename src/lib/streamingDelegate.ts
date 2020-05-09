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
  AudioInfo
} from 'homebridge';
import ip from 'ip';
import { ChildProcess, spawn } from 'child_process';
import { NexusStreamer } from './streamer';
import { NestCam } from './nestcam';
import { NestEndpoints } from './nest-endpoints';
import { readFile } from 'fs';
import { join } from 'path';

const querystring = require('querystring');
const pathToFfmpeg = require('ffmpeg-for-homebridge');

type SessionInfo = {
  address: string, // address of the HAP controller

  videoPort: number,
  videoCryptoSuite: SRTPCryptoSuites, // should be saved if multiple suites are supported
  videoSRTP: Buffer, // key and salt concatenated
  videoSSRC: number, // rtp synchronisation source

  audioPort: number,
  audioCryptoSuite: SRTPCryptoSuites,
  audioSRTP: Buffer,
  audioSSRC: number
}

const FFMPEGH264ProfileNames = [
  'baseline',
  'main',
  'high'
];
const FFMPEGH264LevelNames = [
  '3.1',
  '3.2',
  '4.0'
];

export class StreamingDelegate implements CameraStreamingDelegate {
  private ffmpegDebugOutput: boolean = false;
  private readonly hap: HAP;
  private readonly log: Logging;
  private readonly config: PlatformConfig;
  private customFfmpeg: string = '';
  private ffmpegCodec: string = '';
  private camera: NestCam;
  private endpoints: NestEndpoints;
  controller?: CameraController;

  // keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ChildProcess[]> = {};

  constructor(hap: HAP, camera: any, config: PlatformConfig, log: Logging) {
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.endpoints = new NestEndpoints(config.options.fieldTest);
    this.camera = camera;
    if (config.options) {
      this.customFfmpeg = config.options['pathToFfmpeg'];
    }
    if (config.ffmpegCodec) {
      this.ffmpegCodec = config.ffmpegCodec;
    }
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
    let self = this;
    let query = querystring.stringify({
      uuid: self.camera.uuid,
      width: request.width
    });
    try {
      let snapshot = await this.endpoints.sendRequest(this.config.access_token, self.camera.apiHost, `/get_image?${query}`, 'GET', 'arraybuffer');
      callback(void 0, snapshot);
    } catch(error) {
      if (error.response.status === 404) {
        readFile(join(__dirname, `../../images/offline.jpg`), function (err, data) {
          if (err) {
            self.log.error(err.message);
            callback(err);
          } else {
            callback(void 0, data);
          }
        });
      } else {
        self.log.error(`Error fetching snapshot - ${error.response.status}`);
        callback(error);
      }
    }
  }

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    if (this.camera.enabled) {
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
        audioCryptoSuite: audioCryptoSuite,
        audioSRTP: Buffer.concat([audioSrtpKey, audioSrtpSalt]),
        audioSSRC: audioSSRC
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
          port: audioPort,
          ssrc: audioSSRC,

          srtp_key: audioSrtpKey,
          srtp_salt: audioSrtpSalt,
        },
      };

      this.pendingSessions[sessionId] = sessionInfo;
      callback(void 0, response);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;
    let self = this;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];
        const video: VideoInfo = request.video;
        const audio: AudioInfo = request.audio;

        const profile = FFMPEGH264ProfileNames[video.profile];
        const level = FFMPEGH264LevelNames[video.level];
        const width = video.width;
        const height = video.height;
        const fps = video.fps;

        const videoPayloadType = video.pt;
        const audioPayloadType = audio.pt;
        const videoMaxBitrate = video.max_bit_rate;
        const audioMaxBitrate = audio.max_bit_rate;
        const rtcpInterval = video.rtcp_interval; // usually 0.5
        const sampleRate = audio.sample_rate;
        const mtu = video.mtu; // maximum transmission unit

        const address = sessionInfo.address;
        const videoPort = sessionInfo.videoPort;
        const audioPort = sessionInfo.audioPort;
        const videoSsrc = sessionInfo.videoSSRC;
        const audioSsrc = sessionInfo.audioSSRC;
        const cryptoSuite = sessionInfo.videoCryptoSuite;
        const videoSRTP = sessionInfo.videoSRTP.toString('base64');
        const audioSRTP = sessionInfo.audioSRTP.toString('base64');
        this.log.debug(`Starting video stream (${width}x${height}, ${fps} fps, ${videoMaxBitrate} kbps, ${mtu} mtu)...`);

        let x264Params = '';
        if (this.ffmpegCodec === 'libx264') {
          x264Params = '-preset ultrafast -tune zerolatency ';
        }

        let videoffmpegCommand = `-use_wallclock_as_timestamps 1 -i - -map 0:0 ` +
          `-c:v ${this.ffmpegCodec} -pix_fmt yuv420p ${x264Params}-r ${fps} ` +
          `-an -sn -dn -b:v ${videoMaxBitrate}k -bufsize ${2*videoMaxBitrate}k -maxrate ${videoMaxBitrate}k ` +
          `-payload_type ${videoPayloadType} -ssrc ${videoSsrc} -f rtp `; // -profile:v ${profile} -level:v ${level}

        if (cryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80) { // actually ffmpeg just supports AES_CM_128_HMAC_SHA1_80
          videoffmpegCommand += `-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${videoSRTP} s`;
        }

        videoffmpegCommand += `rtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`;

        let audioffmpegCommand = `-f aac -i - -map 0:0 -c:a libfdk_aac -profile:a aac_eld -vn -ac 1 -ar ${sampleRate}k -b:a ${audioMaxBitrate} ` +
          `-flags +global_header -payload_type ${audioPayloadType} -ssrc ${audioSsrc} -f rtp `;

        if (cryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80) { // actually ffmpeg just supports AES_CM_128_HMAC_SHA1_80
          audioffmpegCommand += `-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${audioSRTP} -rtsp_transport tcp s`;
        }

        audioffmpegCommand += `rtp://${address}:${audioPort}?rtcpport=${audioPort}&localrtcpport=${audioPort}&pkt_size=188`;

        if (this.ffmpegDebugOutput) {
          self.log('FFMPEG command: ffmpeg ' + videoffmpegCommand);
        }

        let ffmpegVideo: ChildProcess;

        if (this.customFfmpeg && this.customFfmpeg !== '') {
          ffmpegVideo = spawn(this.customFfmpeg, videoffmpegCommand.split(' '), {env: process.env});
        } else if (pathToFfmpeg) {
          ffmpegVideo = spawn(pathToFfmpeg, videoffmpegCommand.split(' '), {env: process.env});
        } else {
          ffmpegVideo = spawn('ffmpeg', videoffmpegCommand.split(' '), {env: process.env});
        }

        let started = false;
        if (ffmpegVideo.stdin) {
          ffmpegVideo.stdin.on('error', error => {
            if (!error.message.includes('EPIPE')) {
              self.log.error(error.message);
            }
          });
        }
        if (ffmpegVideo.stderr) {
          ffmpegVideo.stderr.on('data', data => {
            if (!started) {
              started = true;
              self.log.debug('FFMPEG: received first frame');

              callback(); // do not forget to execute callback once set up
            }

            if (this.ffmpegDebugOutput) {
              self.log('VIDEO: ' + String(data));
            }
          });
        }
        ffmpegVideo.on('error', error => {
          self.log.error('[Video] Failed to start video stream: ' + error.message);
          callback(new Error('ffmpeg process creation failed!'));
        });
        ffmpegVideo.on('exit', (code, signal) => {
          const message = '[Video] ffmpeg exited with code: ' + code + ' and signal: ' + signal;
          streamer.stopPlayback();

          if (code == null || code === 255) {
            self.log.debug(message + ' (Video stream stopped!)');
          } else {
            self.log.error(message + ' (error)');

            if (!started) {
              callback(new Error(message));
            } else {
              this.controller!.forceStopStreamingSession(sessionId);
            }
          }
        });

        let streamer: NexusStreamer;

        if (!this.config.options.disableAudio) {
          let ffmpegAudio: ChildProcess;

          if (this.customFfmpeg && this.customFfmpeg !== '') {
              ffmpegAudio = spawn(this.customFfmpeg, audioffmpegCommand.split(' '), {env: process.env});
          } else if (pathToFfmpeg) {
            ffmpegAudio = spawn(pathToFfmpeg, audioffmpegCommand.split(' '), {env: process.env});
          } else {
            ffmpegAudio = spawn('ffmpeg', audioffmpegCommand.split(' '), {env: process.env});
          }

          if (ffmpegAudio.stdin) {
            ffmpegAudio.stdin.on('error', (e: NodeJS.ErrnoException) => {
              if (e.code !== 'EPIPE' && e.code !== 'ERR_STREAM_DESTROYED') {
                self.log.error(e.code || 'unknown');
              }
              streamer.stopPlayback();
            });
          }

          if (ffmpegAudio.stderr) {
            ffmpegAudio.stderr.on('data', data => {
              if (this.ffmpegDebugOutput) {
                self.log('AUDIO: ' + String(data));
              }
            });
          }

          ffmpegAudio.on('error', error => {
            self.log.error('[Audio] Failed to start audio stream: ' + error.message);
            callback(new Error('ffmpeg process creation failed!'));
          });
          streamer = new NexusStreamer(this.camera.nexusTalkHost, this.camera.uuid, this.config.access_token, this.log, ffmpegVideo, ffmpegAudio);
          this.ongoingSessions[sessionId] = [ffmpegVideo, ffmpegAudio];

        } else {
          streamer = new NexusStreamer(this.camera.nexusTalkHost, this.camera.uuid, this.config.access_token, this.log, ffmpegVideo);
          this.ongoingSessions[sessionId] = [ffmpegVideo];
        }


        delete this.pendingSessions[sessionId];
        streamer.requestStartPlayback();
        break;
      case StreamRequestTypes.RECONFIGURE:
        // not implemented
        self.log.debug('Received (unsupported) request to reconfigure to: ' + JSON.stringify(request.video));
        callback();
        break;
      case StreamRequestTypes.STOP:

        try {
          const ffmpegVideoProcess = this.ongoingSessions[sessionId][0];
          if (ffmpegVideoProcess) {
            ffmpegVideoProcess.kill('SIGKILL');
          }
          if (this.ongoingSessions[sessionId].length > 1) {
            const ffmpegAudioProcess = this.ongoingSessions[sessionId][1];
            if (ffmpegAudioProcess && !this.config.options.disableAudio) {
              ffmpegAudioProcess.kill('SIGKILL');
            }
          }
        } catch (e) {
          self.log.error('Error occurred terminating the video process!');
          self.log.error(e);
        }

        delete this.ongoingSessions[sessionId];

        self.log.debug('Stopped streaming session!');
        callback();
        break;
    }
  }
}
