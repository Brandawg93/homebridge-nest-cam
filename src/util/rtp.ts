import { createSocket } from 'dgram';
import getPort from 'get-port';

function getPayloadType(message: Buffer): number {
  return message.readUInt8(1) & 0x7f;
}

function isRtpMessage(message: Buffer): boolean {
  const payloadType = getPayloadType(message);
  return payloadType > 90 || payloadType === 0;
}

export class RtpSplitter {
  public readonly socket = createSocket('udp4');

  constructor(serverPort: number, audioRTCPPort: number, returnAudioPort: number) {
    // emits when any error occurs
    const socket = this.socket;
    socket.on('error', (error) => {
      console.log('Error: ' + error);
      socket.close();
    });

    // emits on new datagram msg
    socket.on('message', (msg) => {
      if (isRtpMessage(msg)) {
        if (msg.length > 50) {
          socket.send(msg, returnAudioPort, 'localhost');
        } else {
          socket.send(msg, audioRTCPPort, 'localhost');
        }
      } else {
        socket.send(msg, audioRTCPPort, 'localhost');
        // Send RTCP to return audio as a heartbeat
        socket.send(msg, returnAudioPort, 'localhost');
      }
    });

    socket.bind(serverPort);
  }

  close(): void {
    this.socket.close();
  }
}

// Need to reserve ports in sequence because ffmpeg uses the next port up by default.  If it's taken, ffmpeg will error
export async function reservePorts(count = 1): Promise<Array<number>> {
  const port = await getPort();
  const ports = [port];
  const tryAgain = (): Promise<Array<number>> => {
    return reservePorts(count);
  };

  for (let i = 1; i < count; i++) {
    const targetConsecutivePort = port + i;
    // eslint-disable-next-line no-await-in-loop
    const openPort = await getPort({ port: targetConsecutivePort });

    if (openPort !== targetConsecutivePort) {
      // can't reserve next port, bail and get another set
      return tryAgain();
    }

    ports.push(openPort);
  }

  return ports;
}
