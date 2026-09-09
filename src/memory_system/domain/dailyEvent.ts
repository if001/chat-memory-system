export interface DailyEvent {
  id: number;
  userId: string;
  eventDate: string;
  summary: string;
  tags: string[];
  sourceMessage?: string;
  createdAt: Date;
}

export interface RememberDailyEventInput {
  userId: string;
  eventDate: string;
  summary: string;
  tags?: string[];
  sourceMessage?: string;
}

export interface SearchDailyEventsInput {
  userId: string;
  query: string;
  limit?: number;
  from?: string;
  to?: string;
}

export interface GetDailyEventsByDateInput {
  userId: string;
  date: string;
  windowDays?: number;
  limit?: number;
}
