import Pbf from 'pbf';

export class Ok {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(Ok._readField, { udp_port: 0 }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.udp_port = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.udp_port) pbf.writeVarintField(1, obj.udp_port);
    }
  }
}
