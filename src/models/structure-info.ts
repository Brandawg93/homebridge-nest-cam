interface FaceTrack {
  camera_uuid: string;
  id: string;
  image_url: string;
  timestamp_sec: number;
}

export interface Face {
  face_tracks: Array<FaceTrack>;
  hero_face_track_id: string;
  hero_image_url: string;
  id: string;
  label: string;
  last_face_cuepoint: any;
  name: string;
  person_last_seen_sec: number;
  timestamp_sec: number;
}
