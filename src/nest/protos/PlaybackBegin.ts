import Pbf from 'pbf';

export enum CodecType {
  SPEEX = 0,
  PCM_S16_LE = 1,
  H264 = 2,
  AAC = 3,
  OPUS = 4,
  META = 5,
  DIRECTORS_CUT = 6,
}

export enum StreamProfile {
  AUDIO_AAC = 3,
  AUDIO_SPEEX = 4,
  AUDIO_OPUS = 5,
  AUDIO_OPUS_LIVE = 13,
  VIDEO_H264_50KBIT_L12 = 6,
  VIDEO_H264_530KBIT_L31 = 7,
  VIDEO_H264_100KBIT_L30 = 8,
  VIDEO_H264_2MBIT_L40 = 9,
  VIDEO_H264_50KBIT_L12_THUMBNAIL = 10,
  META = 11,
  DIRECTORS_CUT = 12,
  VIDEO_H264_L31 = 14,
  VIDEO_H264_L40 = 15,
  AVPROFILE_MOBILE_1 = 1,
  AVPROFILE_HD_MAIN_1 = 2,
}

class Stream {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      Stream._readField,
      {
        channel_id: 0,
        codec_type: 0,
        sample_rate: 0,
        private_data: [],
        start_time: 0,
        udp_ssrc: 0,
        rtp_start_time: 0,
        profile: 3,
      },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.channel_id = pbf.readVarint();
      else if (tag === 2) obj.codec_type = pbf.readVarint();
      else if (tag === 3) obj.sample_rate = pbf.readVarint();
      else if (tag === 4) obj.private_data.push(pbf.readBytes());
      else if (tag === 5) obj.start_time = pbf.readDouble();
      else if (tag === 6) obj.udp_ssrc = pbf.readVarint();
      else if (tag === 7) obj.rtp_start_time = pbf.readVarint();
      else if (tag === 8) obj.profile = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.channel_id) pbf.writeVarintField(1, obj.channel_id);
      if (obj.codec_type) pbf.writeVarintField(2, obj.codec_type);
      if (obj.sample_rate) pbf.writeVarintField(3, obj.sample_rate);
      if (obj.private_data)
        for (let i = 0; i < obj.private_data.length; i++) pbf.writeBytesField(4, obj.private_data[i]);
      if (obj.start_time) pbf.writeDoubleField(5, obj.start_time);
      if (obj.udp_ssrc) pbf.writeVarintField(6, obj.udp_ssrc);
      if (obj.rtp_start_time) pbf.writeVarintField(7, obj.rtp_start_time);
      if (obj.profile) pbf.writeVarintField(8, obj.profile);
    }
  }
}

export class PlaybackBegin {
  private static Stream = Stream;

  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(
      PlaybackBegin._readField,
      { session_id: 0, channels: [], srtp_master_key: null, srtp_master_salt: null, fec_k_val: 0, fec_n_val: 0 },
      end,
    );
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.session_id = pbf.readVarint();
      else if (tag === 2) obj.channels.push(PlaybackBegin.Stream.read(pbf, pbf.readVarint() + pbf.pos));
      else if (tag === 3) obj.srtp_master_key = pbf.readBytes();
      else if (tag === 4) obj.srtp_master_salt = pbf.readBytes();
      else if (tag === 5) obj.fec_k_val = pbf.readVarint();
      else if (tag === 6) obj.fec_n_val = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.session_id) pbf.writeVarintField(1, obj.session_id);
      if (obj.channels)
        for (let i = 0; i < obj.channels.length; i++) pbf.writeMessage(2, PlaybackBegin.Stream.write, obj.channels[i]);
      if (obj.srtp_master_key) pbf.writeBytesField(3, obj.srtp_master_key);
      if (obj.srtp_master_salt) pbf.writeBytesField(4, obj.srtp_master_salt);
      if (obj.fec_k_val) pbf.writeVarintField(5, obj.fec_k_val);
      if (obj.fec_n_val) pbf.writeVarintField(6, obj.fec_n_val);
    }
  }
}
