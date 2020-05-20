import Pbf from 'pbf';

export class Redirect {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(Redirect._readField, { new_host: '', is_transcode: false }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.new_host = pbf.readString();
      else if (tag === 2) obj.is_transcode = pbf.readBoolean();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.new_host) pbf.writeStringField(1, obj.new_host);
      if (obj.is_transcode) pbf.writeBooleanField(2, obj.is_transcode);
    }
  }
}
