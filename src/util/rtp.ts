import { createSocket } from 'dgram';

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
      socket.send(msg, returnAudioPort, 'localhost');
      if (!isRtpMessage(msg)) {
        socket.send(msg, audioRTCPPort, 'localhost');
      }
    });

    socket.bind(serverPort);
  }

  close(): void {
    this.socket.close();
  }
}
