/* eslint-disable curly */
import Pbf from 'pbf';

enum ProtocolVersion {
  VERSION_1 = 1,
  VERSION_2 = 2,
  VERSION_3 = 3,
}

enum ClientType {
  ANDROID = 1,
  IOS = 2,
  WEB = 3,
}

export class Hello {
  public static ProtocolVersion = ProtocolVersion;
  public static ClientType = ClientType;

  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      Hello._readField,
      {
        protocol_version: 1,
        uuid: '',
        require_connected_camera: false,
        session_token: '',
        is_camera: false,
        device_id: '',
        user_agent: '',
        service_access_key: '',
        client_type: 1,
        wwn_access_token: '',
        encrypted_device_id: '',
        authorize_request: null,
        client_ip_address: '',
        require_owner_server: false,
      },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.protocol_version = pbf.readVarint();
      else if (tag === 2) obj.uuid = pbf.readString();
      else if (tag === 3) obj.require_connected_camera = pbf.readBoolean();
      else if (tag === 4) obj.session_token = pbf.readString();
      else if (tag === 5) obj.is_camera = pbf.readBoolean();
      else if (tag === 6) obj.device_id = pbf.readString();
      else if (tag === 7) obj.user_agent = pbf.readString();
      else if (tag === 8) obj.service_access_key = pbf.readString();
      else if (tag === 9) obj.client_type = pbf.readVarint();
      else if (tag === 10) obj.wwn_access_token = pbf.readString();
      else if (tag === 11) obj.encrypted_device_id = pbf.readString();
      else if (tag === 12) obj.authorize_request = pbf.readBytes();
      else if (tag === 13) obj.client_ip_address = pbf.readString();
      else if (tag === 16) obj.require_owner_server = pbf.readBoolean();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.protocol_version) pbf.writeVarintField(1, obj.protocol_version);
      if (obj.uuid) pbf.writeStringField(2, obj.uuid);
      if (obj.require_connected_camera) pbf.writeBooleanField(3, obj.require_connected_camera);
      if (obj.session_token) pbf.writeStringField(4, obj.session_token);
      if (obj.is_camera) pbf.writeBooleanField(5, obj.is_camera);
      if (obj.device_id) pbf.writeStringField(6, obj.device_id);
      if (obj.user_agent) pbf.writeStringField(7, obj.user_agent);
      if (obj.service_access_key) pbf.writeStringField(8, obj.service_access_key);
      if (obj.client_type) pbf.writeVarintField(9, obj.client_type);
      if (obj.wwn_access_token) pbf.writeStringField(10, obj.wwn_access_token);
      if (obj.encrypted_device_id) pbf.writeStringField(11, obj.encrypted_device_id);
      if (obj.authorize_request) pbf.writeBytesField(12, obj.authorize_request);
      if (obj.client_ip_address) pbf.writeStringField(13, obj.client_ip_address);
      if (obj.require_owner_server) pbf.writeBooleanField(16, obj.require_owner_server);
    }
  }
}
