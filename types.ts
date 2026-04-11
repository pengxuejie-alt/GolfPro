export enum Tab {
  HOME = 'HOME',
  CREATE = 'CREATE',
  SCORECARD = 'SCORECARD',
  PK_SET = 'PK_SET',
  SELECT_PLAYER = 'SELECT_PLAYER',
  PLAYERS = 'PLAYERS',
  ME = 'ME',
  PLAYER_PROFILE = 'PLAYER_PROFILE',
  PK_DIZHU = 'PK_DIZHU',
  PK_TIGER = 'PK_TIGER',
  PK_LASHI = 'PK_LASHI',
  MATCH_SQUARE = 'MATCH_SQUARE'
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  handicap: number;
}

export interface Match {
  id: string;
  name: string;
  courseName: string;
  date: string;
  status: 'UPCOMING' | 'LIVE' | 'FINISHED';
  players: Player[];
}

export interface WeatherInfo {
  temp: number;
  condition: string;
  wind: string;
  uv: string;
}

export interface ScoreEntry {
  hole: number;
  par: number;
  score: number;
  putts: number;
}