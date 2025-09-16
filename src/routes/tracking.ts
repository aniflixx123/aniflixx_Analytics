// src/routes/tracking.ts - Fixed with single index for Analytics Engine

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
    const enrichedData = enrichTrackingData(body, c.req.raw.cf as CloudflareData, c.req.raw)
    
    // Route to appropriate dataset
    await routeEventToDataset(enrichedData, c.env)
    
    // Log for monitoring (can be removed in production)
    console.log(`Event tracked: ${enrichedData.event} for user ${enrichedData.userId} in studio ${enrichedData.studioId}`)
    
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
        
        const enrichedData = enrichTrackingData(event, cf, c.req.raw)
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
  env: Env | undefined
): Promise<void> {
  if (!env) {
    console.error('Environment bindings not available')
    return
  }

  const { event } = data
  
  // Ensure studioId is never undefined or empty
  if (!data.studioId || data.studioId === '') {
    console.warn(`No studio ID provided for event ${event}, defaulting to 'unknown'`)
    data.studioId = 'unknown'
  }
  
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
      data.event,                    // blob1: event type
      data.studioId || 'unknown',    // blob2: studio ID
      data.userId,                    // blob3: user ID
      data.country,                   // blob4: country
      data.city,                      // blob5: city
      (data as any).paymentMethod || '', // blob6: payment method
      (data as any).currency || 'USD',   // blob7: currency
      (data as any).contentId || ''      // blob8: content ID
    ],
    doubles: [
      (data as any).amount || 0,     // double1: amount
      (data as any).coins || 0,      // double2: coins
      (data as any).tax || 0,        // double3: tax
      (data as any).fee || 0,        // double4: fee
      data.timestamp,                 // double5: timestamp
      data.latitude,                  // double6: latitude
      data.longitude                  // double7: longitude
    ],
    indexes: [
      data.studioId || 'unknown'     // index1: studio ID
    ]
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
      data.event,                     // blob1: event type
      (data as any).contentId || (data as any).chapterId || (data as any).flickId || '', // blob2: content ID
      data.userId,                     // blob3: user ID
      data.country,                    // blob4: country
      data.city,                       // blob5: city
      (data as any).contentType || '', // blob6: content type
      (data as any).seriesId || '',    // blob7: series ID
      (data as any).quality || ''      // blob8: quality/other metadata
    ],
    doubles: [
      (data as any).pageNumber || (data as any).watchTime || 0,  // double1: progress metric
      (data as any).totalPages || (data as any).duration || 0,    // double2: total metric
      (data as any).readingTime || (data as any).bufferingTime || 0, // double3: time spent
      (data as any).scrollDepth || (data as any).bitrate || 0,    // double4: engagement metric
      (data as any).completionRate || 0,                           // double5: completion rate
      (data as any).engagement || 0,                               // double6: engagement score
      data.timestamp                                               // double7: timestamp
    ],
    indexes: [
      data.studioId || 'unknown'      // index1: studio ID
    ]
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
      data.event,                      // blob1: event type
      data.userId,                      // blob2: user ID
      data.sessionId || '',             // blob3: session ID
      data.country,                     // blob4: country
      data.city,                        // blob5: city
      (data as any).referrer || '',     // blob6: referrer
      (data as any).source || '',       // blob7: traffic source
      (data as any).medium || ''        // blob8: traffic medium
    ],
    doubles: [
      (data as any).value || 1,        // double1: event value
      (data as any).duration || 0,     // double2: duration
      (data as any).score || 0,        // double3: score/rating
      data.latitude,                    // double4: latitude
      data.longitude,                   // double5: longitude
      data.asn,                         // double6: ASN
      data.timestamp                    // double7: timestamp
    ],
    indexes: [
      data.studioId || 'global'        // index1: studio ID (FIXED - was missing!)
    ]
  }
  
  await dataset.writeDataPoint(dataPoint)
}

export { tracking }