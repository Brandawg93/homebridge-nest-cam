import Pbf from 'pbf';

export class AudioPayload {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      AudioPayload._readField,
      { payload: null, session_id: 0, codec: 0, sample_rate: 0, latency_measure_tag: 0 },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.payload = pbf.readBytes();
      else if (tag === 2) obj.session_id = pbf.readVarint();
      else if (tag === 3) obj.codec = pbf.readVarint();
      else if (tag === 4) obj.sample_rate = pbf.readVarint();
      else if (tag === 5) obj.latency_measure_tag = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.payload) pbf.writeBytesField(1, obj.payload);
      if (obj.session_id) pbf.writeVarintField(2, obj.session_id);
      if (obj.codec) pbf.writeVarintField(3, obj.codec);
      if (obj.sample_rate) pbf.writeVarintField(4, obj.sample_rate);
      if (obj.latency_measure_tag) pbf.writeVarintField(5, obj.latency_measure_tag);
    }
  }
}
