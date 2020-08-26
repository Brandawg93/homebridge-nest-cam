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
    socket.on('error', function (error) {
      console.log('Error: ' + error);
      socket.close();
    });

    // emits on new datagram msg
    socket.on('message', function (msg) {
      if (isRtpMessage(msg)) {
        socket.send(msg, returnAudioPort, 'localhost');
      } else {
        socket.send(msg, audioRTCPPort, 'localhost');
      }
    });

    socket.bind(serverPort);
  }

  close(): void {
    this.socket.close();
  }
}

// Need to reserve ports in sequence because ffmpeg uses the next port up by default.  If it's taken, ffmpeg will error
export async function reservePorts({
  count = 1,
  attemptedPorts = [],
}: {
  count?: number;
  attemptedPorts?: Array<number>;
} = {}): Promise<Array<number>> {
  const port = await getPort(),
    ports = [port],
    tryAgain = () => {
      return reservePorts({
        count,
        attemptedPorts: attemptedPorts.concat(ports),
      });
    };

  for (let i = 1; i < count; i++) {
    const targetConsecutivePort = port + i,
      openPort = await getPort({ port: targetConsecutivePort });

    if (openPort !== targetConsecutivePort) {
      // can't reserve next port, bail and get another set
      return tryAgain();
    }

    ports.push(openPort);
  }

  return ports;
}
