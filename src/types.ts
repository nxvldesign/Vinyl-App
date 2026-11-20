export interface License {
  code: string; // e.g. "by-nc-sa"
  version?: string;
  url?: string;
}

export interface Track {
  id: string;
  title: string;
  duration: number; // seconds
  highlight: number; // start of the 20-second "main part", in seconds
  src: string;
  page?: string;
  license?: License;
  waveform?: number[]; // 0..1 peaks, for the mini waveform
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistUrl?: string;
  page?: string;
  genre: string;
  tags: string[];
  cover: string;
  vinyl: string; // record colour
  source: string;
  tracks: Track[];
  local?: boolean;
}

export type SpatialMode = 'room' | 'stereo';

export type Theme = 'light' | 'dark';
