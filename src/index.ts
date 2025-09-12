import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Env = {
  STUDIO_ANALYTICS: AnalyticsEngineDataset
  USER_BEHAVIOR: AnalyticsEngineDataset
  REVENUE_TRACKING: AnalyticsEngineDataset
  CACHE: KVNamespace
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('/*', cors({
  origin: ['*'], // Configure your domains
  credentials: true
}))

// Health check
app.get('/', (c) => {
  return c.json({ 
    status: 'Analytics API Running',
    endpoints: ['/track', '/api/stats', '/api/realtime']
  })
})

export default app