// src/routes/tracking.ts - Production tracking endpoint

import { Hono } from 'hono'
import type { 
  Env, 
  TrackingEvent, 
  EnrichedTrackingData, 
  CloudflareData,
  TrackingResponse,
  ErrorResponse,
  AnalyticsEngineDataPoint
} from '../types'

const tracking = new Hono<{ Bindings: Env }>()

// ============================================
// MAIN TRACKING ENDPOINT
// ============================================
tracking.post('/track', async (c) => {
  try {
    const body = await c.req.json<TrackingEvent>()
    
    // Validate required fields
    const validationError = validateTrackingEvent(body)
    if (validationError) {
      const response: ErrorResponse = {
        error: 'Validation failed',
        details: validationError,
        code: 400
      }
      return c.json(response, 400)
    }
    
    // Enrich with Cloudflare data
    const enrichedData = enrichTrackingData(body, c.req.raw.cf as CloudflareData, c.req)
    
    // Route to appropriate dataset
    await routeEventToDataset(enrichedData, c.env)
    
    // Log for monitoring (can be removed in production)
    console.log(`Event tracked: ${enrichedData.event} for user ${enrichedData.userId}`)
    
    // Return success response
    const response: TrackingResponse = {
      success: true,
      tracked: enrichedData.event,
      timestamp: enrichedData.timestamp,
      enriched: {
        country: enrichedData.country,
        city: enrichedData.city,
        timezone: enrichedData.timezone
      }
    }
    
    return c.json(response)
    
  } catch (error) {
    console.error('Tracking error:', error)
    const response: ErrorResponse = {
      error: 'Failed to track event',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// BATCH TRACKING ENDPOINT
// ============================================
tracking.post('/track/batch', async (c) => {
  try {
    const { events } = await c.req.json<{ events: TrackingEvent[] }>()
    
    if (!Array.isArray(events) || events.length === 0) {
      const response: ErrorResponse = {
        error: 'Invalid batch',
        details: 'Events must be a non-empty array',
        code: 400
      }
      return c.json(response, 400)
    }
    
    if (events.length > 100) {
      const response: ErrorResponse = {
        error: 'Batch too large',
        details: 'Maximum 100 events per batch',
        code: 400
      }
      return c.json(response, 400)
    }
    
    const results = []
    const cf = c.req.raw.cf as CloudflareData
    
    for (const event of events) {
      try {
        const validationError = validateTrackingEvent(event)
        if (validationError) {
          results.push({ success: false, error: validationError })
          continue
        }
        
        const enrichedData = enrichTrackingData(event, cf, c.req)
        await routeEventToDataset(enrichedData, c.env)
        results.push({ success: true, tracked: event.event })
      } catch (error) {
        results.push({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      }
    }
    
    return c.json({
      success: true,
      total: events.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    })
    
  } catch (error) {
    console.error('Batch tracking error:', error)
    const response: ErrorResponse = {
      error: 'Failed to process batch',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// VALIDATION
// ============================================
function validateTrackingEvent(event: TrackingEvent): string | null {
  if (!event.event) {
    return 'Missing required field: event'
  }
  
  if (!event.userId) {
    return 'Missing required field: userId'
  }
  
  if (typeof event.event !== 'string' || event.event.length > 100) {
    return 'Invalid event name'
  }
  
  if (typeof event.userId !== 'string' || event.userId.length > 100) {
    return 'Invalid userId'
  }
  
  return null
}

// ============================================
// DATA ENRICHMENT
// ============================================
function enrichTrackingData(
  event: TrackingEvent, 
  cf: CloudflareData | undefined,
  request: Request
): EnrichedTrackingData {
  return {
    ...event,
    timestamp: event.timestamp || Date.now(),
    country: cf?.country || 'XX',
    city: cf?.city || 'Unknown',
    region: cf?.region || 'Unknown',
    timezone: cf?.timezone || 'UTC',
    latitude: parseFloat(cf?.latitude as string) || 0,
    longitude: parseFloat(cf?.longitude as string) || 0,
    asn: cf?.asn || 0,
    colo: cf?.colo || 'Unknown',
    ip: request.headers.get('cf-connecting-ip') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown'
  }
}

// ============================================
// EVENT ROUTING
// ============================================
async function routeEventToDataset(
  data: EnrichedTrackingData, 
  env: Env
): Promise<void> {
  const { event, userId, studioId = 'unknown' } = data
  
  // Determine which dataset to use based on event type
  if (isRevenueEvent(event)) {
    await trackRevenueEvent(data, env.REVENUE_TRACKING)
  } else if (isContentEvent(event)) {
    await trackContentEvent(data, env.STUDIO_ANALYTICS)
  } else {
    await trackUserBehaviorEvent(data, env.USER_BEHAVIOR)
  }
}

// ============================================
// REVENUE TRACKING
// ============================================
function isRevenueEvent(event: string): boolean {
  const revenueEvents = [
    'purchase_completed',
    'coins_purchased',
    'subscription_started',
    'subscription_cancelled',
    'payment_failed',
    'refund_processed'
  ]
  return revenueEvents.some(e => event.includes(e)) || 
         event.includes('revenue') || 
         event.includes('payment')
}

async function trackRevenueEvent(
  data: EnrichedTrackingData, 
  dataset: AnalyticsEngineDataset
): Promise<void> {
  const dataPoint: AnalyticsEngineDataPoint = {
    blobs: [
      data.event,
      data.studioId || '',
      data.userId,
      data.country,
      data.city,
      data.paymentMethod || '',
      data.currency || 'USD',
      data.contentId || ''
    ],
    doubles: [
      data.amount || 0,
      data.coins || 0,
      data.tax || 0,
      data.fee || 0,
      data.timestamp
    ],
    indexes: [data.studioId || 'unknown', data.userId]
  }
  
  await dataset.writeDataPoint(dataPoint)
}

// ============================================
// CONTENT TRACKING
// ============================================
function isContentEvent(event: string): boolean {
  const contentEvents = [
    'chapter_opened',
    'chapter_completed',
    'page_viewed',
    'reading_session',
    'flick_started',
    'flick_completed',
    'watch_progress',
    'content_liked',
    'content_shared',
    'content_saved'
  ]
  return contentEvents.some(e => event.includes(e)) || 
         event.includes('chapter') || 
         event.includes('flick') ||
         event.includes('episode')
}

async function trackContentEvent(
  data: EnrichedTrackingData, 
  dataset: AnalyticsEngineDataset
): Promise<void> {
  const dataPoint: AnalyticsEngineDataPoint = {
    blobs: [
      data.event,
      data.contentId || data.chapterId || data.flickId || '',
      data.userId,
      data.country,
      data.city,
      data.contentType || '',
      data.seriesId || '',
      data.quality || ''
    ],
    doubles: [
      data.pageNumber || data.watchTime || 0,
      data.totalPages || data.duration || 0,
      data.readingTime || data.bufferingTime || 0,
      data.scrollDepth || data.bitrate || 0,
      data.completionRate || 0,
      data.engagement || 0,
      data.timestamp
    ],
    indexes: [data.studioId || 'unknown', data.contentId || '']
  }
  
  await dataset.writeDataPoint(dataPoint)
}

// ============================================
// USER BEHAVIOR TRACKING
// ============================================
async function trackUserBehaviorEvent(
  data: EnrichedTrackingData, 
  dataset: AnalyticsEngineDataset
): Promise<void> {
  const dataPoint: AnalyticsEngineDataPoint = {
    blobs: [
      data.event,
      data.studioId || '',
      data.country,
      data.city,
      data.referrer || '',
      data.source || '',
      data.medium || '',
      data.campaign || ''
    ],
    doubles: [
      data.value || 1,
      data.duration || 0,
      data.score || 0,
      data.timestamp
    ],
    indexes: [data.userId, data.sessionId || '']
  }
  
  await dataset.writeDataPoint(dataPoint)
}

export { tracking }