// src/types.ts - All TypeScript type definitions

export interface Env {
  STUDIO_ANALYTICS: AnalyticsEngineDataset
  USER_BEHAVIOR: AnalyticsEngineDataset
  REVENUE_TRACKING: AnalyticsEngineDataset
  CACHE: KVNamespace
}

// ============================================
// TRACKING TYPES
// ============================================

export interface TrackingEvent {
  event: string
  userId: string
  studioId?: string
  sessionId?: string
  timestamp?: number
  device?: string
  os?: string
  osVersion?: string
  appVersion?: string
  [key: string]: any
}

export interface EnrichedTrackingData extends TrackingEvent {
  timestamp: number
  country: string
  city: string
  region: string
  timezone: string
  latitude: number
  longitude: number
  asn: number
  colo: string
  ip: string
  userAgent: string
}

export interface CloudflareData {
  country?: string
  city?: string
  region?: string
  timezone?: string
  latitude?: string
  longitude?: string
  asn?: number
  colo?: string
}

// ============================================
// CONTENT EVENTS
// ============================================

export interface ChapterEvent {
  event: 'chapter_opened' | 'chapter_completed' | 'page_viewed' | 'reading_session'
  chapterId: string
  seriesId?: string
  studioId: string
  userId: string
  chapterNumber?: number
  pageNumber?: number
  totalPages?: number
  readingTime?: number
  scrollDepth?: number
  startPage?: number
  endPage?: number
  pagesRead?: number
  completionRate?: number
}

export interface FlickEvent {
  event: 'flick_started' | 'flick_completed' | 'watch_progress'
  flickId: string
  studioId: string
  userId: string
  watchTime?: number
  duration?: number
  completionRate?: number
  quality?: string
  bufferingTime?: number
  bitrate?: number
}

// ============================================
// ENGAGEMENT EVENTS
// ============================================

export interface EngagementEvent {
  event: 'content_liked' | 'content_unliked' | 'comment_added' | 'content_shared' | 'content_saved'
  contentId: string
  contentType: 'chapter' | 'flick' | 'series'
  studioId: string
  userId: string
  platform?: string
  commentLength?: number
}

// ============================================
// REVENUE EVENTS
// ============================================

export interface RevenueEvent {
  event: 'purchase_completed' | 'coins_purchased' | 'subscription_started' | 'subscription_cancelled'
  userId: string
  studioId?: string
  amount: number
  coins?: number
  currency?: string
  paymentMethod?: string
  contentId?: string
  contentType?: string
  plan?: string
  duration?: number
  tax?: number
}

// ============================================
// ANALYTICS RESPONSE TYPES
// ============================================

export interface StatsOverview {
  totalViews: number
  uniqueUsers: number
  totalRevenue: number
  totalCoins: number
  transactions: number
  avgSessionTime?: number
  completionRate?: number
}

export interface ContentStats {
  byType: ContentTypeStats[]
  topContent: TopContent[]
}

export interface ContentTypeStats {
  event: string
  contentId: string
  views: number
  uniqueUsers: number
  avgValue: number
}

export interface TopContent {
  id: string
  title?: string
  views: number
  users: number
  revenue?: number
  completionRate?: number
}

export interface RevenueStats {
  byCountry: CountryRevenue[]
  byMethod?: PaymentMethodStats[]
  timeline?: RevenueTimeline[]
}

export interface CountryRevenue {
  country: string
  revenue: number
  coins: number
  transactions: number
  avgTransaction: number
}

export interface PaymentMethodStats {
  method: string
  revenue: number
  transactions: number
  percentage: number
}

export interface RevenueTimeline {
  date: string
  revenue: number
  coins: number
  transactions: number
}

export interface Demographics {
  byLocation: LocationStats[]
  deviceTypes?: DeviceStats
  os?: OSStats
}

export interface LocationStats {
  country: string
  city: string
  users: number
  events: number
  revenue?: number
}

export interface DeviceStats {
  mobile: number
  tablet: number
  desktop: number
}

export interface OSStats {
  ios: number
  android: number
  web: number
}

export interface StudioStats {
  studioId: string
  period: string
  generated: number
  overview: StatsOverview
  content: ContentStats
  revenue: RevenueStats
  demographics: Demographics
}

// ============================================
// REALTIME TYPES
// ============================================

export interface RealtimeStats {
  studioId: string
  timestamp: number
  activeUsers: number
  totalEvents: number
  eventsPerMinute: number
  locations: RealtimeLocation[]
  activeContent?: ActiveContent[]
}

export interface RealtimeLocation {
  country: string
  city: string
  count: number
}

export interface ActiveContent {
  contentId: string
  contentType: string
  users: number
}

// ============================================
// ANALYTICS ENGINE TYPES
// ============================================

export interface AnalyticsEngineDataPoint {
  blobs?: string[]
  doubles?: number[]
  indexes?: string[]
}

export interface AnalyticsEngineQuery {
  sql: string
  params?: any[]
}

export interface AnalyticsEngineResult {
  data: any[]
  meta?: any
}

// Analytics Engine Dataset interface
export interface AnalyticsEngineDataset {
  writeDataPoint(point: AnalyticsEngineDataPoint): Promise<void>
  query(query: AnalyticsEngineQuery): Promise<AnalyticsEngineResult | any>
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface TrackingResponse {
  success: boolean
  tracked: string
  timestamp: number
  enriched?: {
    country: string
    city: string
    timezone: string
  }
}

export interface ErrorResponse {
  error: string
  details?: string
  code?: number
}