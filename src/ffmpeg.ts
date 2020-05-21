import { ChildProcess, spawn } from 'child_process';
import { CameraController, Logging, StreamRequestCallback } from 'homebridge';
import { Writable } from 'stream';

const pathToFfmpeg = require('ffmpeg-for-homebridge'); // eslint-disable-line @typescript-eslint/no-var-requires

export class FfmpegProcess {
  private readonly log: Logging;
  private readonly ffmpegDebugOutput = false;
  private ff: ChildProcess;

  constructor(
    command: string,
    log: Logging,
    callback: StreamRequestCallback | undefined,
    controller: CameraController | undefined,
    sessionId: string,
    customFfmpeg?: string,
  ) {
    let started = false;
    this.log = log;

    if (this.ffmpegDebugOutput) {
      this.log('FFMPEG command: ffmpeg ' + command);
    }
    if (customFfmpeg && customFfmpeg !== '') {
      this.ff = spawn(customFfmpeg, command.split(' '), { env: process.env });
    } else if (pathToFfmpeg) {
      this.ff = spawn(pathToFfmpeg, command.split(' '), { env: process.env });
    } else {
      this.ff = spawn('ffmpeg', command.split(' '), { env: process.env });
    }

    if (this.ff.stdin) {
      this.ff.stdin.on('error', (error) => {
        if (!error.message.includes('EPIPE')) {
          this.log.error(error.message);
        }
      });
    }
    if (this.ff.stderr) {
      this.ff.stderr.on('data', (data) => {
        if (!started) {
          started = true;
          this.log.debug('FFMPEG: received first frame');
          if (callback) {
            callback(); // do not forget to execute callback once set up
          }
        }

        if (this.ffmpegDebugOutput) {
          this.log('FFMPEG: ' + String(data));
        }
      });
    }
    this.ff.on('error', (error) => {
      this.log.error('[FFMPEG] Failed to start stream: ' + error.message);
      if (callback) {
        callback(new Error('ffmpeg process creation failed!'));
      }
    });
    this.ff.on('exit', (code, signal) => {
      const message = '[FFMPEG] ffmpeg exited with code: ' + code + ' and signal: ' + signal;

      if (code == null || code === 255) {
        this.log.debug(message + ' (Stream stopped!)');
      } else {
        this.log.error(message + ' (error)');

        if (!started) {
          if (callback) {
            callback(new Error(message));
          }
        } else {
          if (controller) {
            controller.forceStopStreamingSession(sessionId);
          }
        }
      }
    });
  }

  public stop(): void {
    this.ff.kill('SIGKILL');
  }

  public getStdin(): Writable | null {
    return this.ff.stdin;
  }
}
