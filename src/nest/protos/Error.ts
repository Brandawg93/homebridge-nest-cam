import Pbf from 'pbf';

export enum ErrorCode {
  ERROR_CAMERA_NOT_CONNECTED = 1,
  ERROR_ILLEGAL_PACKET = 2,
  ERROR_AUTHORIZATION_FAILED = 3,
  ERROR_NO_TRANSCODER_AVAILABLE = 4,
  ERROR_TRANSCODE_PROXY_ERROR = 5,
  ERROR_INTERNAL = 6,
}

export class Error {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(Error._readField, { code: 1, message: '' }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.code = pbf.readVarint();
      else if (tag === 2) obj.message = pbf.readString();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.code) pbf.writeVarintField(1, obj.code);
      if (obj.message) pbf.writeStringField(2, obj.message);
    }
  }
}
