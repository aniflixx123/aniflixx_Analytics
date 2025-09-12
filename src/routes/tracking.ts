import { Hono } from 'hono'

const tracking = new Hono<{ Bindings: Env }>()

// Main tracking endpoint
tracking.post('/track', async (c) => {
  try {
    const data = await c.req.json()
    const { event, userId, studioId, chapterId, ...metadata } = data
    
    // Enrich with Cloudflare data
    const enrichedData = {
      timestamp: Date.now(),
      event,
      userId,
      studioId,
      chapterId,
      // Geographic data from Cloudflare
      country: c.req.raw.cf?.country || 'unknown',
      city: c.req.raw.cf?.city || 'unknown',
      timezone: c.req.raw.cf?.timezone || 'unknown',
      // Device data
      userAgent: c.req.header('user-agent'),
      ...metadata
    }
    
    // Route to appropriate dataset
    if (event.includes('revenue') || event.includes('payment')) {
      c.env.REVENUE_TRACKING.writeDataPoint({
        blobs: [event],
        doubles: [metadata.amount || 0],
        indexes: [studioId]
      })
    } else if (event.includes('chapter') || event.includes('page')) {
      c.env.STUDIO_ANALYTICS.writeDataPoint({
        blobs: [event, chapterId],
        doubles: [1],
        indexes: [studioId]
      })
    } else {
      c.env.USER_BEHAVIOR.writeDataPoint({
        blobs: [event],
        doubles: [1],
        indexes: [userId]
      })
    }
    
    return c.json({ success: true, tracked: event })
    
  } catch (error) {
    console.error('Tracking error:', error)
    return c.json({ error: 'Failed to track event' }, 500)
  }
})

export { tracking }