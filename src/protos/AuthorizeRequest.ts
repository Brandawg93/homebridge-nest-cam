import Pbf from 'pbf';

export class AuthorizeRequest {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      AuthorizeRequest._readField,
      { session_token: '', wwn_access_token: '', service_access_key: '', olive_token: '' },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_token = pbf.readString();
      else if (tag === 2) obj.wwn_access_token = pbf.readString();
      else if (tag === 2) obj.service_access_key = pbf.readString();
      else if (tag === 2) obj.olive_token = pbf.readString();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_token) pbf.writeStringField(1, obj.session_token);
      if (obj.wwn_access_token) pbf.writeStringField(2, obj.wwn_access_token);
      if (obj.service_access_key) pbf.writeStringField(3, obj.service_access_key);
      if (obj.olive_token) pbf.writeStringField(4, obj.olive_token);
    }
  }
}
