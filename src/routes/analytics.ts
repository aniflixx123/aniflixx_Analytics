import { Hono } from 'hono'

const analytics = new Hono<{ Bindings: Env }>()

// Get studio statistics
analytics.get('/api/stats/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const period = c.req.query('period') || '30d'
  
  try {
    // Check cache first
    const cacheKey = `stats:${studioId}:${period}`
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) return c.json(cached)
    
    // Query Analytics Engine (using SQL API)
    const query = `
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT userId) as unique_users,
        SUM(CASE WHEN event = 'chapter_completed' THEN 1 ELSE 0 END) as completions
      FROM studio_analytics
      WHERE studioId = '${studioId}'
      AND timestamp > NOW() - INTERVAL '${period}'
    `
    
    // For now, return mock data (Analytics Engine SQL coming soon)
    const stats = {
      totalViews: 45234,
      uniqueUsers: 12456,
      completions: 8934,
      revenue: 5678.90,
      topChapters: [
        { id: 'ch1', views: 5000 },
        { id: 'ch2', views: 4500 }
      ]
    }
    
    // Cache for 1 hour
    await c.env.CACHE.put(cacheKey, JSON.stringify(stats), {
      expirationTtl: 3600
    })
    
    return c.json(stats)
    
  } catch (error) {
    console.error('Stats error:', error)
    return c.json({ error: 'Failed to get stats' }, 500)
  }
})

// Real-time active users
analytics.get('/api/realtime/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  
  // Get last 5 minutes of activity
  const activeUsers = {
    current: 147,
    trend: '+12%',
    locations: [
      { country: 'US', users: 45 },
      { country: 'JP', users: 67 },
      { country: 'UK', users: 35 }
    ]
  }
  
  return c.json(activeUsers)
})

// Revenue analytics
analytics.get('/api/revenue/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const range = c.req.query('range') || '30d'
  
  const revenue = {
    total: 12456.78,
    byChapter: [
      { chapterId: 'ch1', amount: 2345.67 },
      { chapterId: 'ch2', amount: 1890.45 }
    ],
    byCountry: [
      { country: 'US', amount: 5678.90 },
      { country: 'JP', amount: 4567.89 }
    ],
    trend: '+23%'
  }
  
  return c.json(revenue)
})

export { analytics }