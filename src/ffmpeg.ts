import { ChildProcess, spawn } from 'child_process';
import execa from 'execa';
import { Logging, StreamRequestCallback } from 'homebridge';
import { StreamingDelegate } from './streaming-delegate';
import { Readable, Writable } from 'stream';

const pathToFfmpeg = require('ffmpeg-for-homebridge'); // eslint-disable-line @typescript-eslint/no-var-requires

export async function doesFfmpegSupportCodec(codec: string, ffmpegPath: string): Promise<boolean> {
  const output = await execa(ffmpegPath, ['-codecs']);
  return output.stdout.includes(codec);
}

export async function getDefaultEncoder(ffmpegPath: string): Promise<string> {
  const output = await execa(ffmpegPath, ['-codecs']);
  const validEncoders = ['h264_omx', 'h264_videotoolbox'];
  validEncoders.forEach((encoder) => {
    if (output.stdout.includes(encoder)) {
      return encoder;
    }
  });
  return 'libx264';
}

export async function isFfmpegInstalled(ffmpegPath: string): Promise<boolean> {
  try {
    await execa(ffmpegPath, ['-codecs']);
    return true;
  } catch (_) {
    return false;
  }
}

export class FfmpegProcess {
  private ff: ChildProcess;

  constructor(
    title: string,
    command: Array<string>,
    log: Logging,
    callback: StreamRequestCallback | undefined,
    delegate: StreamingDelegate,
    sessionId: string,
    ffmpegDebugOutput: boolean,
    customFfmpeg?: string,
  ) {
    let started = false;
    const controller = delegate.controller;

    if (ffmpegDebugOutput) {
      log.info(`${title} command: ffmpeg ${command}`);
    } else {
      log.debug(`${title} command: ffmpeg ${command}`);
    }

    const videoProcessor = customFfmpeg || pathToFfmpeg || 'ffmpeg';
    this.ff = spawn(videoProcessor, command, { env: process.env });

    if (this.ff.stdin) {
      this.ff.stdin.on('error', (error) => {
        if (!error.message.includes('EPIPE')) {
          log.error(error.message);
        }
      });
    }
    if (this.ff.stderr) {
      this.ff.stderr.on('data', (data) => {
        if (!started) {
          started = true;
          log.debug(`${title}: received first frame`);
          if (callback) {
            callback(); // do not forget to execute callback once set up
          }
        }

        if (ffmpegDebugOutput) {
          log.info(`${title}: ${String(data)}`);
        } else {
          log.debug(`${title}: ${String(data)}`);
        }
      });
    }
    this.ff.on('error', (error) => {
      log.error(`[${title}] Failed to start stream: ` + error.message);
      if (callback) {
        callback(new Error('ffmpeg process creation failed!'));
        delegate.stopStream(sessionId);
      }
    });
    this.ff.on('exit', (code, signal) => {
      const message = `[${title}] ffmpeg exited with code: ${code} and signal: ${signal}`;

      if (code == null || code === 255) {
        log.debug(message + ` (${title} Stream stopped gracefully.)`);
      } else {
        if (title.toLowerCase().includes('return')) {
          log.debug(message + ' (error)');
        } else {
          log.error(message + ' (error)');
        }
        if (callback) {
          if (!started) {
            callback(new Error(message));
          } else {
            delegate.stopStream(sessionId);
            controller?.forceStopStreamingSession(sessionId);
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

  public getStdout(): Readable | null {
    return this.ff.stdout;
  }
}
