interface Urls {
  rubyapi_url: string;
  czfe_url: string;
  log_upload_url: string;
  transport_url: string;
  weather_url: string;
  support_url: string;
  direct_transport_url: string;
}

interface ServiceUrls {
  limits: Limits;
  urls: Urls;
}

interface Bucket {
  object_key: string;
  object_revision: number;
  object_timestamp: number;
  value: any;
}

interface Limits {
  thermostats_per_structure: number;
  structures: number;
  smoke_detectors_per_structure: number;
  smoke_detectors: number;
  thermostats: number;
}

interface User {
  id: string;
  nest_user_id: string;
}

export interface Session {
  items: Array<User>;
}

export interface AppLaunch {
  '2fa_enabled': boolean;
  service_urls: ServiceUrls;
  updated_buckets: Array<Bucket>;
  weather_for_structures: any;
}
