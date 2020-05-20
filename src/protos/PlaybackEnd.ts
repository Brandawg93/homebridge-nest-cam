import Pbf from 'pbf';

enum Reason {
  ERROR_TIME_NOT_AVAILABLE = 1,
  ERROR_PROFILE_NOT_AVAILABLE = 2,
  ERROR_TRANSCODE_NOT_AVAILABLE = 3,
  PLAY_END_SESSION_COMPLETE = 128,
}

export class PlaybackEnd {
  public static Reason = Reason;

  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(PlaybackEnd._readField, { session_id: 0, reason: 1 }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_id = pbf.readVarint();
      else if (tag === 2) obj.reason = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_id) pbf.writeVarintField(1, obj.session_id);
      if (obj.reason) pbf.writeVarintField(2, obj.reason);
    }
  }
}
