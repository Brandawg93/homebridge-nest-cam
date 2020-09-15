export interface MotionEvent {
  camera_uuid: string;
  end_time: number;
  face_category: string;
  face_id: string;
  face_name: string;
  id: string;
  importance: number;
  in_progress: boolean;
  is_important: boolean;
  playback_time: number;
  start_time: number;
  types: Array<string>;
  zone_ids: Array<number>;
}
