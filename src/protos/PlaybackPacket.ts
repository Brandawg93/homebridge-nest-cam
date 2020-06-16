import Pbf from 'pbf';

export enum PacketType {
  PING = 1,
  HELLO = 100,
  PING_CAMERA = 101,
  AUDIO_PAYLOAD = 102,
  START_PLAYBACK = 103,
  STOP_PLAYBACK = 104,
  CLOCK_SYNC_ECHO = 105,
  LATENCY_MEASURE = 106,
  TALKBACK_LATENCY = 107,
  METADATA_REQUEST = 108,
  OK = 200,
  ERROR = 201,
  PLAYBACK_BEGIN = 202,
  PLAYBACK_END = 203,
  PLAYBACK_PACKET = 204,
  LONG_PLAYBACK_PACKET = 205,
  CLOCK_SYNC = 206,
  REDIRECT = 207,
  TALKBACK_BEGIN = 208,
  TALKBACK_END = 209,
  METADATA = 210,
  METADATA_ERROR = 211,
  AUTHORIZE_REQUEST = 212,
}

class DirectorsCutRegion {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(DirectorsCutRegion._readField, { id: 0, left: 0, right: 0, top: 0, bottom: 0 }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.id = pbf.readVarint();
      else if (tag === 2) obj.left = pbf.readVarint();
      else if (tag === 3) obj.right = pbf.readVarint();
      else if (tag === 4) obj.top = pbf.readVarint();
      else if (tag === 5) obj.bottom = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.id) pbf.writeVarintField(1, obj.id);
      if (obj.left) pbf.writeVarintField(2, obj.left);
      if (obj.right) pbf.writeVarintField(3, obj.right);
      if (obj.top) pbf.writeVarintField(4, obj.top);
      if (obj.bottom) pbf.writeVarintField(5, obj.bottom);
    }
  }
}

export class PlaybackPacket {
  private static DirectorsCutRegion = DirectorsCutRegion;

  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      PlaybackPacket._readField,
      {
        session_id: 0,
        channel_id: 0,
        timestamp_delta: 0,
        payload: null,
        latency_rtp_sequence: 0,
        latency_rtp_ssrc: 0,
        directors_cut_regions: [],
      },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_id = pbf.readVarint();
      else if (tag === 2) obj.channel_id = pbf.readVarint();
      else if (tag === 3) obj.timestamp_delta = pbf.readSVarint();
      else if (tag === 4) obj.payload = pbf.readBytes();
      else if (tag === 5) obj.latency_rtp_sequence = pbf.readVarint();
      else if (tag === 6) obj.latency_rtp_ssrc = pbf.readVarint();
      else if (tag === 7)
        obj.directors_cut_regions.push(PlaybackPacket.DirectorsCutRegion.read(pbf, pbf.readVarint() + pbf.pos));
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_id) pbf.writeVarintField(1, obj.session_id);
      if (obj.channel_id) pbf.writeVarintField(2, obj.channel_id);
      if (obj.timestamp_delta) pbf.writeSVarintField(3, obj.timestamp_delta);
      if (obj.payload) pbf.writeBytesField(4, obj.payload);
      if (obj.latency_rtp_sequence) pbf.writeVarintField(5, obj.latency_rtp_sequence);
      if (obj.latency_rtp_ssrc) pbf.writeVarintField(6, obj.latency_rtp_ssrc);
      if (obj.directors_cut_regions)
        for (let i = 0; i < obj.directors_cut_regions.length; i++)
          pbf.writeMessage(2, PlaybackPacket.DirectorsCutRegion.write, obj.channels[i]);
    }
  }
}
