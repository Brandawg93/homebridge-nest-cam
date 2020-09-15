/* eslint-disable curly */
import Pbf from 'pbf';

export class TalkbackEnd {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      TalkbackEnd._readField,
      { user_id: '', session_id: 0, quick_action_id: 0, device_id: '' },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.user_id = pbf.readString();
      else if (tag === 2) obj.session_id = pbf.readVarint();
      else if (tag === 3) obj.quick_action_id = pbf.readVarint();
      else if (tag === 4) obj.device_id = pbf.readString();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.user_id) pbf.writeStringField(1, obj.user_id);
      if (obj.session_id) pbf.writeVarintField(2, obj.session_id);
      if (obj.quick_action_id) pbf.writeVarintField(3, obj.quick_action_id);
      if (obj.device_id) pbf.writeStringField(4, obj.device_id);
    }
  }
}
