// src/routes/analytics.ts - Fixed with lowercase table names and correct COUNT syntax

import { Hono } from 'hono'
import type { 
  Env,
  StudioStats,
  RealtimeStats,
  ErrorResponse,
  StatsOverview,
  ContentStats,
  ContentTypeStats,
  TopContent,
  RevenueStats,
  Demographics,
  CountryRevenue,
  LocationStats,
  PaymentMethodStats,
  RevenueTimeline,
  RealtimeLocation,
  ActiveContent
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
    const cached = await c.env?.CACHE.get(cacheKey, 'json') as StudioStats | null
    if (cached) {
      return c.json(cached)
    }
    
    // Execute parallel queries for efficiency
    const [contentData, revenueData, demographicsData] = await Promise.all([
      queryContentStats(c.env, studioId, startTime),
      queryRevenueStats(c.env, studioId, startTime),
      queryDemographics(c.env, studioId, startTime)
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
    await c.env?.CACHE.put(cacheKey, JSON.stringify(stats), {
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
// REALTIME ANALYTICS API
// ============================================
analytics.get('/api/realtime/:studioId', async (c) => {
  const studioId = c.req.param('studioId')
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)
  
  try {
    // Query recent events for realtime data
    const recentData = await queryRealtimeData(c.env, studioId, fiveMinutesAgo)
    
    // Process realtime data
    const locationMap = new Map<string, RealtimeLocation>()
    const contentMap = new Map<string, Set<string>>()
    let totalEvents = 0
    const uniqueUsers = new Set<string>()
    
    if (recentData && recentData.data && recentData.data.length > 0) {
      recentData.data.forEach((row: any) => {
        totalEvents++
        uniqueUsers.add(row.user_id || '')
        
        // Aggregate by location
        const locationKey = `${row.country}-${row.city}`
        if (!locationMap.has(locationKey)) {
          locationMap.set(locationKey, {
            country: row.country || 'Unknown',
            city: row.city || 'Unknown',
            count: 0
          })
        }
        const location = locationMap.get(locationKey)!
        location.count++
        
        // Track active content
        if (row.content_id) {
          if (!contentMap.has(row.content_id)) {
            contentMap.set(row.content_id, new Set())
          }
          contentMap.get(row.content_id)!.add(row.user_id)
        }
      })
    }
    
    const realtimeStats: RealtimeStats = {
      studioId,
      timestamp: Date.now(),
      activeUsers: uniqueUsers.size,
      totalEvents,
      eventsPerMinute: Math.round(totalEvents / 5),
      locations: Array.from(locationMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      activeContent: Array.from(contentMap.entries())
        .map(([contentId, users]) => ({
          contentId,
          contentType: contentId.includes('chapter') ? 'chapter' : 'flick',
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
    // Check cache
    const cacheKey = `revenue:${studioId}:${days}d`
    const cached = await c.env?.CACHE.get(cacheKey, 'json') as RevenueStats | null
    if (cached) {
      return c.json(cached)
    }
    
    // Query revenue data from Analytics Engine
    const result = await queryRevenueDetails(c.env, studioId, startTime)
    
    // Process revenue data
    const timeline = new Map<string, any>()
    const byCountry = new Map<string, any>()
    const byMethod = new Map<string, any>()
    let totalRevenue = 0
    let totalCoins = 0
    let totalTransactions = 0
    
    if (result && result.data && result.data.length > 0) {
      result.data.forEach((row: any) => {
        // Timeline aggregation
        const timestamp = row.timestamp || Date.now()
        const date = new Date(timestamp).toISOString().split('T')[0]
        if (!timeline.has(date)) {
          timeline.set(date, { 
            date, 
            revenue: 0, 
            coins: 0, 
            transactions: 0 
          })
        }
        const dayData = timeline.get(date)!
        dayData.revenue += row.revenue || 0
        dayData.coins += row.coins || 0
        dayData.transactions += 1
        
        // Country aggregation
        const country = row.country
        if (country) {
          if (!byCountry.has(country)) {
            byCountry.set(country, { 
              country, 
              revenue: 0, 
              coins: 0, 
              transactions: 0 
            })
          }
          const countryData = byCountry.get(country)!
          countryData.revenue += row.revenue || 0
          countryData.coins += row.coins || 0
          countryData.transactions += 1
        }
        
        // Payment method aggregation
        const paymentMethod = row.payment_method
        if (paymentMethod) {
          if (!byMethod.has(paymentMethod)) {
            byMethod.set(paymentMethod, { 
              method: paymentMethod, 
              revenue: 0, 
              transactions: 0 
            })
          }
          const methodData = byMethod.get(paymentMethod)!
          methodData.revenue += row.revenue || 0
          methodData.transactions += 1
        }
        
        // Totals
        totalRevenue += row.revenue || 0
        totalCoins += row.coins || 0
        totalTransactions += 1
      })
    }
    
    // Calculate percentages for payment methods
    Array.from(byMethod.values()).forEach(method => {
      method.percentage = totalRevenue > 0 
        ? (method.revenue / totalRevenue)
        : 0
    })
    
    // Build revenue response
    const revenueStats: RevenueStats = {
      byCountry: Array.from(byCountry.values())
        .map(country => ({
          ...country,
          avgTransaction: country.transactions > 0 
            ? country.revenue / country.transactions 
            : 0
        } as CountryRevenue))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20),
      byMethod: Array.from(byMethod.values())
        .map(method => ({
          ...method,
          percentage: Math.round(method.percentage * 100) / 100
        } as PaymentMethodStats))
        .sort((a, b) => b.revenue - a.revenue),
      timeline: Array.from(timeline.values())
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, days) as RevenueTimeline[]
    }
    
    // Cache for 5 minutes
    await c.env?.CACHE.put(cacheKey, JSON.stringify(revenueStats), {
      expirationTtl: 300
    })
    
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
    // Query content performance data
    const result = await queryContentPerformance(
      c.env, 
      studioId, 
      contentId, 
      startTime
    )
    
    // Process content data
    const timeline = new Map<string, any>()
    let totalViews = 0
    let totalUsers = new Set<string>()
    let totalRevenue = 0
    let totalCompletions = 0
    let totalTime = 0
    
    if (result && result.data && result.data.length > 0) {
      result.data.forEach((row: any) => {
        const timestamp = row.timestamp || Date.now()
        const date = new Date(timestamp).toISOString().split('T')[0]
        
        if (!timeline.has(date)) {
          timeline.set(date, {
            date,
            views: 0,
            users: new Set(),
            completions: 0,
            avgTime: 0
          })
        }
        
        const dayData = timeline.get(date)!
        dayData.views++
        dayData.users.add(row.user_id)
        
        if (row.event_type === 'chapter_completed' || row.event_type === 'flick_completed') {
          dayData.completions++
          totalCompletions++
        }
        
        totalViews++
        totalUsers.add(row.user_id)
        totalTime += row.duration || 0
        totalRevenue += row.revenue || 0
      })
    }
    
    // Convert timeline to array
    const performanceTimeline = Array.from(timeline.values())
      .map(day => ({
        date: day.date,
        views: day.views,
        users: day.users.size,
        completions: day.completions,
        completionRate: day.views > 0 ? day.completions / day.views : 0,
        avgTime: day.avgTime
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    
    const contentStats = {
      studioId,
      contentId,
      period: `${days}d`,
      summary: {
        totalViews,
        uniqueUsers: totalUsers.size,
        completions: totalCompletions,
        completionRate: totalViews > 0 ? totalCompletions / totalViews : 0,
        avgViewTime: totalViews > 0 ? totalTime / totalViews : 0,
        revenue: totalRevenue
      },
      timeline: performanceTimeline,
      engagement: {
        likes: 0,
        comments: 0,
        shares: 0
      }
    }
    
    return c.json(contentStats)
    
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
// ANALYTICS ENGINE QUERY FUNCTIONS - FIXED
// ============================================

async function queryContentStats(
  env: Env | undefined, 
  studioId: string, 
  startTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              blob1 as event_type,
              blob2 as content_id,
              blob6 as content_type,
              COUNT() as event_count,
              COUNT(DISTINCT blob3) as unique_users,
              AVG(double5) as avg_completion,
              SUM(double3) as total_time
            FROM studio_analytics
            WHERE index1 = '${studioId}' AND double7 > ${startTime}
            GROUP BY blob1, blob2, blob6
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query content stats error:', error)
    return { data: [] }
  }
}

async function queryRevenueStats(
  env: Env | undefined, 
  studioId: string, 
  startTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [{}] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              COUNT() as total_transactions,
              SUM(double1) as total_revenue,
              SUM(double2) as total_coins,
              AVG(double1) as avg_transaction
            FROM revenue_tracking
            WHERE index1 = '${studioId}' AND double5 > ${startTime}
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [{}] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query revenue stats error:', error)
    return { data: [{}] }
  }
}

async function queryDemographics(
  env: Env | undefined, 
  studioId: string, 
  startTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              blob4 as country,
              blob5 as city,
              COUNT(DISTINCT blob3) as unique_users,
              COUNT() as total_events
            FROM studio_analytics
            WHERE index1 = '${studioId}' AND double7 > ${startTime}
            GROUP BY blob4, blob5
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query demographics error:', error)
    return { data: [] }
  }
}

async function queryRealtimeData(
  env: Env | undefined,
  studioId: string,
  sinceTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              blob1 as event_type,
              blob2 as content_id,
              blob3 as user_id,
              blob4 as country,
              blob5 as city,
              double7 as timestamp
            FROM studio_analytics
            WHERE index1 = '${studioId}' AND double7 > ${sinceTime}
            ORDER BY double7 DESC
            LIMIT 500
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query realtime data error:', error)
    return { data: [] }
  }
}

async function queryRevenueDetails(
  env: Env | undefined,
  studioId: string,
  startTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              blob1 as event_type,
              blob4 as country,
              blob6 as payment_method,
              double1 as revenue,
              double2 as coins,
              double5 as timestamp
            FROM revenue_tracking
            WHERE index1 = '${studioId}' AND double5 > ${startTime}
            ORDER BY double5 DESC
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query revenue details error:', error)
    return { data: [] }
  }
}

async function queryContentPerformance(
  env: Env | undefined,
  studioId: string,
  contentId: string,
  startTime: number
): Promise<any> {
  if (!env?.ANALYTICS_API_TOKEN || !env?.ACCOUNT_ID) {
    console.error('Missing API credentials')
    return { data: [] }
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            SELECT 
              blob1 as event_type,
              blob3 as user_id,
              double1 as revenue,
              double3 as duration,
              double7 as timestamp
            FROM studio_analytics
            WHERE index1 = '${studioId}' 
              AND blob2 = '${contentId}' 
              AND double7 > ${startTime}
            ORDER BY double7 DESC
          `
        })
      }
    )
    
    if (!response.ok) {
      console.error('Analytics API error:', await response.text())
      return { data: [] }
    }
    
    return await response.json()
  } catch (error) {
    console.error('Query content performance error:', error)
    return { data: [] }
  }
}

// Helper functions
function buildOverview(content: any, revenue: any, demographics: any): StatsOverview {
  const contentData = content?.data || []
  const revenueData = revenue?.data?.[0] || {}
  const demoData = demographics?.data || []
  
  const totalViews = contentData.reduce((sum: number, row: any) => 
    sum + (row?.event_count || 0), 0)
  const uniqueUsers = demoData.reduce((sum: number, row: any) => 
    sum + (row?.unique_users || 0), 0)
  const totalTime = contentData.reduce((sum: number, row: any) => 
    sum + (row?.total_time || 0), 0)
  const avgCompletion = contentData.reduce((sum: number, row: any) => 
    sum + (row?.avg_completion || 0), 0)
  
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
      } as ContentTypeStats)),
    topContent: contentData
      .filter((row: any) => row?.content_id)
      .sort((a: any, b: any) => (b?.event_count || 0) - (a?.event_count || 0))
      .slice(0, 10)
      .map((row: any) => ({
        id: row.content_id || '',
        views: row.event_count || 0,
        users: row.unique_users || 0,
        completionRate: row.avg_completion || 0
      } as TopContent))
  }
}

function buildRevenueStats(data: any): RevenueStats {
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