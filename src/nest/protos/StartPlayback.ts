/* eslint-disable curly */
import Pbf from 'pbf';

enum ProfileNotFoundAction {
  REDIRECT = 0,
  USE_NEXT_AVAILABLE = 1,
}

export class StartPlayback {
  public static ProfileNotFoundAction = ProfileNotFoundAction;

  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      StartPlayback._readField,
      {
        session_id: 0,
        profile: 3,
        start_time: 0,
        external_ip: null,
        external_port: 0,
        other_profiles: [],
        profile_not_found_action: 0,
      },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_id = pbf.readVarint();
      else if (tag === 2) obj.profile = pbf.readVarint();
      else if (tag === 3) obj.start_time = pbf.readDouble();
      else if (tag === 4) obj.external_ip = pbf.readBytes();
      else if (tag === 5) obj.external_port = pbf.readVarint();
      else if (tag === 6) obj.other_profiles.push(pbf.readVarint());
      else if (tag === 7) obj.profile_not_found_action = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_id) pbf.writeVarintField(1, obj.session_id);
      if (obj.profile) pbf.writeVarintField(2, obj.profile);
      if (obj.start_time) pbf.writeDoubleField(3, obj.start_time);
      if (obj.external_ip) pbf.writeBytesField(4, obj.external_ip);
      if (obj.external_port) pbf.writeVarintField(5, obj.external_port);
      if (obj.other_profiles)
        for (let i = 0; i < obj.other_profiles.length; i++) pbf.writeVarintField(6, obj.other_profiles[i]);
      if (obj.profile_not_found_action) pbf.writeVarintField(7, obj.profile_not_found_action);
    }
  }
}
