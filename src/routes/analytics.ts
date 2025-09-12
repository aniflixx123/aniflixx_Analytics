// src/routes/analytics.ts - Production analytics APIs with real queries

import { Hono } from 'hono'
import type { 
  Env,
  StudioStats,
  RealtimeStats,
  ErrorResponse,
  StatsOverview,
  ContentStats,
  RevenueStats,
  Demographics,
  CountryRevenue,
  LocationStats
} from '../types'

const analytics = new Hono<{ Bindings: Env }>()

// ============================================
// STUDIO STATISTICS API
// ============================================
analytics.get('/api/stats/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const days = parseInt(c.req.query('days') || '30')
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000)
  
  try {
    // Check cache first
    const cacheKey = `stats:${studioId}:${days}d`
    const cached = await c.env.CACHE.get(cacheKey, 'json') as StudioStats | null
    if (cached) {
      return c.json(cached)
    }
    
    // Execute parallel queries for efficiency
    const [contentData, revenueData, demographicsData] = await Promise.all([
      queryContentStats(c.env.STUDIO_ANALYTICS, studioId, startTime),
      queryRevenueStats(c.env.REVENUE_TRACKING, studioId, startTime),
      queryDemographics(c.env.STUDIO_ANALYTICS, studioId, startTime)
    ])
    
    // Build comprehensive stats response
    const stats: StudioStats = {
      studioId,
      period: `${days}d`,
      generated: Date.now(),
      overview: buildOverview(contentData, revenueData, demographicsData),
      content: buildContentStats(contentData),
      revenue: buildRevenueStats(revenueData),
      demographics: buildDemographics(demographicsData)
    }
    
    // Cache for 5 minutes
    await c.env.CACHE.put(cacheKey, JSON.stringify(stats), {
      expirationTtl: 300
    })
    
    return c.json(stats)
    
  } catch (error) {
    console.error('Stats error:', error)
    const response: ErrorResponse = {
      error: 'Failed to retrieve statistics',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// REAL-TIME ANALYTICS API
// ============================================
analytics.get('/api/realtime/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const minutes = parseInt(c.req.query('minutes') || '5')
  const startTime = Date.now() - (minutes * 60 * 1000)
  
  try {
    // Query real-time data from Analytics Engine
    const result = await c.env.STUDIO_ANALYTICS.query({
      sql: `
        SELECT 
          blob1 as event_type,
          blob3 as user_id,
          blob4 as country,
          blob5 as city,
          blob2 as content_id,
          double7 as timestamp
        FROM STUDIO_ANALYTICS
        WHERE index1 = ?1 AND double7 > ?2
        ORDER BY double7 DESC
        LIMIT 1000
      `,
      params: [studioId, startTime]
    })
    
    // Process real-time data
    const uniqueUsers = new Set<string>()
    const locationMap = new Map<string, number>()
    const contentMap = new Map<string, Set<string>>()
    
    if (result && result.data) {
      result.data.forEach((row: any) => {
        if (row.user_id) uniqueUsers.add(row.user_id)
        
        // Count by location
        const locationKey = `${row.country || 'Unknown'}-${row.city || 'Unknown'}`
        locationMap.set(locationKey, (locationMap.get(locationKey) || 0) + 1)
        
        // Track active content
        if (row.content_id) {
          if (!contentMap.has(row.content_id)) {
            contentMap.set(row.content_id, new Set())
          }
          contentMap.get(row.content_id)!.add(row.user_id)
        }
      })
    }
    
    // Build realtime response
    const realtimeStats: RealtimeStats = {
      studioId,
      timestamp: Date.now(),
      activeUsers: uniqueUsers.size,
      totalEvents: result?.data?.length || 0,
      eventsPerMinute: (result?.data?.length || 0) / minutes,
      locations: Array.from(locationMap.entries())
        .map(([key, count]) => {
          const [country, city] = key.split('-')
          return { country, city, count }
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      activeContent: Array.from(contentMap.entries())
        .map(([contentId, users]) => ({
          contentId,
          contentType: contentId.startsWith('ch') ? 'chapter' : 'flick',
          users: users.size
        }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 10)
    }
    
    return c.json(realtimeStats)
    
  } catch (error) {
    console.error('Realtime error:', error)
    const response: ErrorResponse = {
      error: 'Failed to retrieve realtime data',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// REVENUE ANALYTICS API
// ============================================
analytics.get('/api/revenue/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const days = parseInt(c.req.query('days') || '30')
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000)
  
  try {
    // Query revenue data from Analytics Engine
    const result = await c.env.REVENUE_TRACKING.query({
      sql: `
        SELECT 
          DATE(double5 / 1000, 'unixepoch') as date,
          blob1 as event_type,
          blob4 as country,
          blob6 as payment_method,
          blob7 as currency,
          blob8 as content_id,
          COUNT(*) as transactions,
          SUM(double1) as revenue,
          SUM(double2) as coins,
          AVG(double1) as avg_transaction,
          MAX(double1) as max_transaction,
          MIN(double1) as min_transaction
        FROM REVENUE_TRACKING
        WHERE index1 = ?1 AND double5 > ?2
        GROUP BY date, blob1, blob4, blob6, blob7
        ORDER BY date DESC
      `,
      params: [studioId, startTime]
    })
    
    // Process revenue data
    const timeline = new Map<string, any>()
    const byCountry = new Map<string, any>()
    const byMethod = new Map<string, any>()
    let totalRevenue = 0
    let totalCoins = 0
    let totalTransactions = 0
    
    if (result && result.data) {
      result.data.forEach((row: any) => {
        // Timeline aggregation
        if (row.date) {
          if (!timeline.has(row.date)) {
            timeline.set(row.date, { 
              date: row.date, 
              revenue: 0, 
              coins: 0, 
              transactions: 0 
            })
          }
          const dayData = timeline.get(row.date)!
          dayData.revenue += row.revenue || 0
          dayData.coins += row.coins || 0
          dayData.transactions += row.transactions || 0
        }
        
        // Country aggregation
        if (row.country) {
          if (!byCountry.has(row.country)) {
            byCountry.set(row.country, { 
              country: row.country, 
              revenue: 0, 
              coins: 0, 
              transactions: 0 
            })
          }
          const countryData = byCountry.get(row.country)!
          countryData.revenue += row.revenue || 0
          countryData.coins += row.coins || 0
          countryData.transactions += row.transactions || 0
        }
        
        // Payment method aggregation
        if (row.payment_method) {
          if (!byMethod.has(row.payment_method)) {
            byMethod.set(row.payment_method, { 
              method: row.payment_method, 
              revenue: 0, 
              transactions: 0 
            })
          }
          const methodData = byMethod.get(row.payment_method)!
          methodData.revenue += row.revenue || 0
          methodData.transactions += row.transactions || 0
        }
        
        // Totals
        totalRevenue += row.revenue || 0
        totalCoins += row.coins || 0
        totalTransactions += row.transactions || 0
      })
    }
    
    // Calculate percentages for payment methods
    Array.from(byMethod.values()).forEach(method => {
      method.percentage = totalRevenue > 0 
        ? Math.round((method.revenue / totalRevenue) * 100) 
        : 0
    })
    
    // Build revenue response
    const revenueStats: RevenueStats = {
      byCountry: Array.from(byCountry.values())
        .map((country: any) => ({
          country: country.country,
          revenue: country.revenue,
          coins: country.coins,
          transactions: country.transactions,
          avgTransaction: country.transactions > 0 
            ? country.revenue / country.transactions 
            : 0
        } as CountryRevenue))
        .sort((a, b) => b.revenue - a.revenue),
      byMethod: Array.from(byMethod.values())
        .sort((a: any, b: any) => b.revenue - a.revenue),
      timeline: Array.from(timeline.values())
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    }
    
    return c.json({
      studioId,
      period: `${days}d`,
      summary: {
        total: totalRevenue,
        coins: totalCoins,
        transactions: totalTransactions,
        avgTransaction: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
      },
      ...revenueStats
    })
    
  } catch (error) {
    console.error('Revenue error:', error)
    const response: ErrorResponse = {
      error: 'Failed to retrieve revenue data',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// CONTENT PERFORMANCE API
// ============================================
analytics.get('/api/content/:studioId/:contentId', async (c) => {
  const studioId = c.req.param('studioId')
  const contentId = c.req.param('contentId')
  const days = parseInt(c.req.query('days') || '7')
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000)
  
  try {
    const result = await c.env.STUDIO_ANALYTICS.query({
      sql: `
        SELECT 
          blob1 as event_type,
          DATE(double7 / 1000, 'unixepoch') as date,
          COUNT(*) as event_count,
          COUNT(DISTINCT blob3) as unique_users,
          AVG(double1) as avg_progress,
          MAX(double1) as max_progress,
          AVG(double3) as avg_time_spent
        FROM STUDIO_ANALYTICS
        WHERE index1 = ?1 AND index2 = ?2 AND double7 > ?3
        GROUP BY blob1, date
        ORDER BY date DESC
      `,
      params: [studioId, contentId, startTime]
    })
    
    return c.json({
      studioId,
      contentId,
      period: `${days}d`,
      performance: result?.data || []
    })
    
  } catch (error) {
    console.error('Content performance error:', error)
    const response: ErrorResponse = {
      error: 'Failed to retrieve content performance',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 500
    }
    return c.json(response, 500)
  }
})

// ============================================
// HELPER FUNCTIONS
// ============================================

async function queryContentStats(
  dataset: AnalyticsEngineDataset, 
  studioId: string, 
  startTime: number
): Promise<any> {
  try {
    const result = await dataset.query({
      sql: `
        SELECT 
          blob1 as event_type,
          blob2 as content_id,
          blob6 as content_type,
          COUNT(*) as event_count,
          COUNT(DISTINCT blob3) as unique_users,
          AVG(double5) as avg_completion,
          SUM(double3) as total_time
        FROM STUDIO_ANALYTICS
        WHERE index1 = ?1 AND double7 > ?2
        GROUP BY blob1, blob2, blob6
      `,
      params: [studioId, startTime]
    })
    return result || { data: [] }
  } catch (error) {
    console.error('Query content stats error:', error)
    return { data: [] }
  }
}

async function queryRevenueStats(
  dataset: AnalyticsEngineDataset, 
  studioId: string, 
  startTime: number
): Promise<any> {
  try {
    const result = await dataset.query({
      sql: `
        SELECT 
          COUNT(*) as total_transactions,
          SUM(double1) as total_revenue,
          SUM(double2) as total_coins,
          AVG(double1) as avg_transaction
        FROM REVENUE_TRACKING
        WHERE index1 = ?1 AND double5 > ?2
      `,
      params: [studioId, startTime]
    })
    return result || { data: [{}] }
  } catch (error) {
    console.error('Query revenue stats error:', error)
    return { data: [{}] }
  }
}

async function queryDemographics(
  dataset: AnalyticsEngineDataset, 
  studioId: string, 
  startTime: number
): Promise<any> {
  try {
    const result = await dataset.query({
      sql: `
        SELECT 
          blob4 as country,
          blob5 as city,
          COUNT(DISTINCT blob3) as unique_users,
          COUNT(*) as total_events
        FROM STUDIO_ANALYTICS
        WHERE index1 = ?1 AND double7 > ?2
        GROUP BY blob4, blob5
      `,
      params: [studioId, startTime]
    })
    return result || { data: [] }
  } catch (error) {
    console.error('Query demographics error:', error)
    return { data: [] }
  }
}

function buildOverview(content: any, revenue: any, demographics: any): StatsOverview {
  const contentData = content?.data || []
  const revenueData = revenue?.data?.[0] || {}
  const demoData = demographics?.data || []
  
  const totalViews = contentData.reduce((sum: number, row: any) => sum + (row?.event_count || 0), 0)
  const uniqueUsers = demoData.reduce((sum: number, row: any) => sum + (row?.unique_users || 0), 0)
  const totalTime = contentData.reduce((sum: number, row: any) => sum + (row?.total_time || 0), 0)
  const avgCompletion = contentData.reduce((sum: number, row: any) => sum + (row?.avg_completion || 0), 0)
  
  return {
    totalViews,
    uniqueUsers,
    totalRevenue: revenueData?.total_revenue || 0,
    totalCoins: revenueData?.total_coins || 0,
    transactions: revenueData?.total_transactions || 0,
    avgSessionTime: contentData.length > 0 ? totalTime / contentData.length : 0,
    completionRate: contentData.length > 0 ? avgCompletion / contentData.length : 0
  }
}

function buildContentStats(data: any): ContentStats {
  const contentData = data?.data || []
  
  return {
    byType: contentData
      .filter((row: any) => row?.event_type)
      .map((row: any) => ({
        event: row.event_type || '',
        contentId: row.content_id || '',
        views: row.event_count || 0,
        uniqueUsers: row.unique_users || 0,
        avgValue: row.avg_completion || 0
      })),
    topContent: contentData
      .filter((row: any) => row?.content_id)
      .sort((a: any, b: any) => (b?.event_count || 0) - (a?.event_count || 0))
      .slice(0, 10)
      .map((row: any) => ({
        id: row.content_id || '',
        views: row.event_count || 0,
        users: row.unique_users || 0,
        completionRate: row.avg_completion || 0
      }))
  }
}

function buildRevenueStats(data: any): RevenueStats {
  // This will be populated by the revenue endpoint
  // Keeping it minimal for the stats endpoint
  return {
    byCountry: [],
    byMethod: [],
    timeline: []
  }
}

function buildDemographics(data: any): Demographics {
  const demoData = data?.data || []
  
  const locations: LocationStats[] = demoData
    .filter((row: any) => row?.country)
    .sort((a: any, b: any) => (b?.unique_users || 0) - (a?.unique_users || 0))
    .slice(0, 50)
    .map((row: any) => ({
      country: row.country || 'Unknown',
      city: row.city || 'Unknown',
      users: row.unique_users || 0,
      events: row.total_events || 0
    }))
  
  return {
    byLocation: locations
  }
}

export { analytics }