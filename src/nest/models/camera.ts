export interface Zone {
  color: number;
  count: number;
  created_at: string;
  default_label: string;
  drawColor: number;
  hidden: boolean;
  id: number;
  label: string;
  label_magma_key: string;
  last_alerted: string;
  last_updated: string;
  learned_type: string;
  mask_meta: string;
  motion_mask: string;
  motion_path: Array<any>;
  nexusapi_image_uri: string;
  order: number;
  type: string;
  weight: string;
}

export const ModelTypes = [
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Cam Indoor',
  'Nest Cam Outdoor',
  'Nest Cam IQ Indoor',
  'Nest Cam IQ Outdoor',
  'Nest Hello',
];

export interface Properties {
  'adaptive_bandwidth.enabled': boolean;
  'alarms.streaming.enabled': boolean;
  'audio.enabled': boolean;
  'audio.inputgainlevel': number;
  'audio.recording.enabled': boolean;
  'audio.spoken_locale': string;
  'audio.start-stop-sound': number;
  'cvr.allowed': boolean;
  'doorbell.chime_assist.enabled': boolean;
  'doorbell.indoor_chime.duration': number;
  'doorbell.indoor_chime.enabled': boolean;
  'doorbell.indoor_chime.type': string;
  'doorbell.quiet_time.enabled_until': number;
  'doorbell.theme': string;
  'dptz.state': string;
  'face_tracking.enabled': boolean;
  'freetier.history.enabled': boolean;
  'irled.state': string;
  'log.level': string;
  low_motion_bitrate_ratio: number;
  'low_motion_bitrate_ratio.enabled': boolean;
  'nest.away.notify.enabled': boolean;
  'nest.away.streaming.enabled': boolean;
  'notify.email.enabled': boolean;
  'notify.mobile_push.enabled': boolean;
  'notify.motion.enabled': boolean;
  'notify.offline.enabled': boolean;
  'notify.sound.enabled': boolean;
  'preview.streaming.enabled': boolean;
  'protect.clips.enabled': boolean;
  'statusled.brightness': number;
  'streaming.cameraprofile': string;
  'streaming.data-usage-tier': number;
  'streaming.enabled': boolean;
  'video.flipped': boolean;
  'watermark.enabled': boolean;
  websocket_nexustalk_host: Array<string>;
}

export interface CameraInfo {
  activation_time: number;
  capabilities: Array<string>;
  combined_software_version: string;
  description: string;
  direct_nexustalk_host: string;
  doorbell_chime_assist_enabled: boolean;
  doorbell_indoor_chime_duration: number;
  doorbell_indoor_chime_enabled: boolean;
  doorbell_indoor_chime_type: string;
  download_host: string;
  embed_url: string;
  full_camera_enabled: boolean;
  has_bundle: boolean;
  high_security: boolean;
  hours_of_free_tier_history: number;
  hours_of_recording_max: number;
  id: number;
  is_audio_recording_enabled: boolean;
  is_connected: boolean;
  is_online: boolean;
  is_public: boolean;
  is_streaming: boolean;
  is_streaming_enabled: boolean;
  is_trial_mode: boolean;
  is_trial_warning: boolean;
  last_connected_time: number;
  last_local_ip: string;
  live_stream_host: string;
  location: any;
  mac_address: string;
  name: string;
  nest_structure_id: string;
  nest_structure_name: string;
  nest_where_id: string;
  nexus_api_http_server: string;
  nexus_api_nest_domain_host: string;
  owner_id: string;
  owner_nest_user_id: string;
  properties: Properties;
  public_token: string;
  public_url: string;
  region: string;
  rq_battery_battery_volt: number;
  rq_battery_temp: number;
  rq_battery_vbridge_volt: number;
  serial_number: string;
  share_mode: number;
  spoken_locale: string;
  talkback_stream_host: string;
  timezone: string;
  timezone_utc_offset: number;
  title: string;
  trial_days_left: number;
  type: number;
  uuid: string;
  websocket_nexustalk_host: string;
  where: string;
  wwn_clips_host: string;
  wwn_stream_host: string;
}
