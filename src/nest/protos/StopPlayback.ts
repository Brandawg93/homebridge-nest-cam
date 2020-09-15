/* eslint-disable curly */
import Pbf from 'pbf';

export class StopPlayback {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(StopPlayback._readField, { session_id: 0 }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_id = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_id) pbf.writeVarintField(1, obj.session_id);
    }
  }
}
