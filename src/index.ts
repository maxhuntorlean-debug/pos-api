import { Hono } from 'hono'
import { cors } from 'hono/cors'

import auth from './routes/auth'
import users from './routes/users'
import roles from './routes/roles'
import products from './routes/products'
import sales from './routes/sales'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

const allowedOrigins = new Set([
  'https://pos-admin.lateshoy.workers.dev',
  'https://pos-client.lateshoy.workers.dev'
])

app.use(
  '/api/*',
  cors({
    origin: (origin) => allowedOrigins.has(origin) ? origin : '',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true
  })
)

app.get('/', (c) => {
  return c.json({
    ok: true,
    project: 'cf-auth-starter'
  })
})

app.route('/api/auth', auth)
app.route('/api/admin/users', users)
app.route('/api/admin/roles', roles)
app.route('/api/products', products)
app.route('/api/sales', sales)

export default app