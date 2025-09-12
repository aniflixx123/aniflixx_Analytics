// src/index.ts - Main Analytics Worker Entry Point

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { tracking } from './routes/tracking'
import { analytics } from './routes/analytics'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// ============================================
// MIDDLEWARE
// ============================================

// CORS configuration
app.use('/*', cors({
  origin: '*', // In production, specify your allowed domains
  credentials: true,
  allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400
}))

// Request logging middleware
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  
  // Log request details
  console.log({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: `${duration}ms`,
    ip: c.req.header('cf-connecting-ip'),
    country: c.req.raw.cf?.country,
    userAgent: c.req.header('user-agent')
  })
})

// Rate limiting headers
app.use('*', async (c, next) => {
  await next()
  c.header('X-RateLimit-Limit', '1000')
  c.header('X-RateLimit-Remaining', '999')
  c.header('X-RateLimit-Reset', new Date(Date.now() + 3600000).toISOString())
})

// ============================================
// HEALTH CHECK & INFO
// ============================================

app.get('/', (c) => {
  return c.json({
    name: 'Aniflixx Analytics Engine',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: {
      tracking: {
        single: 'POST /track',
        batch: 'POST /track/batch'
      },
      analytics: {
        stats: 'GET /api/stats/:studioId',
        realtime: 'GET /api/realtime/:studioId',
        revenue: 'GET /api/revenue/:studioId',
        content: 'GET /api/content/:studioId/:contentId'
      }
    },
    documentation: 'https://docs.aniflixx.com/analytics'
  })
})

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? process.uptime() : 'N/A'
  })
})

// ============================================
// MOUNT ROUTES
// ============================================

app.route('/', tracking)
app.route('/', analytics)

// ============================================
// ERROR HANDLING
// ============================================

app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    message: `The requested endpoint ${c.req.path} does not exist`,
    code: 404
  }, 404)
})

app.onError((err, c) => {
  console.error('Application error:', err)
  
  return c.json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    code: 500
  }, 500)
})

export default app