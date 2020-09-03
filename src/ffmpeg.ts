import execa from 'execa';
import { Logging, StreamRequestCallback } from 'homebridge';
import { StreamingDelegate } from './streaming-delegate';
import { Readable, Writable } from 'stream';
import pathToFfmpeg from 'ffmpeg-for-homebridge';

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
  private ff: execa.ExecaChildProcess<string> | undefined;

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
    const cmdOutput = `${title} command: ffmpeg ${command}`;
    ffmpegDebugOutput ? log.info(cmdOutput) : log.debug(cmdOutput);

    const videoProcessor = customFfmpeg || pathToFfmpeg || 'ffmpeg';
    try {
      // Create ffmpeg process
      this.ff = execa(videoProcessor, command, { env: process.env });

      this.ff.stderr?.on('data', (data) => {
        // Output debug data if you want
        const stderrOutput = `${title}: ${String(data)}`;
        ffmpegDebugOutput ? log.info(stderrOutput) : log.debug(stderrOutput);

        // Only call the callback once frames are actually flowing
        if (!started && stderrOutput.includes('frame=')) {
          started = true;
          callback && callback();
        }
      });
    } catch (error) {
      log.error(`[${title}] Failed to start stream: ` + error.message);
      if (callback) {
        callback(new Error('ffmpeg process creation failed!'));
        delegate.stopStream(sessionId);
      }
    }
  }

  public stop(): void {
    // Attempt to gracefully kill, but forcefully kill after 2 seconds
    this.ff?.kill('SIGTERM', {
      forceKillAfterTimeout: 2000,
    });
  }

  public getStdin(): Writable | null | undefined {
    return this.ff?.stdin;
  }

  public getStdout(): Readable | null | undefined {
    return this.ff?.stdout;
  }
}
