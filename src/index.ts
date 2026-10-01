import { Hono } from 'hono'
import { cors } from 'hono/cors'

import auth from './routes/auth'
import users from './routes/users'
import roles from './routes/roles'


import products from './routes/products'
import sales from './routes/sales'
import salesJournal from './routes/salesJournal'
import salesReport from './routes/salesReport'
import events from './routes/events'

import cash from './routes/cash'

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

// Сначала конкретные маршруты
app.route('/api/sales/journal', salesJournal)
app.route('/api/sales/report', salesReport)
app.route('/api/events', events)

// Общий sales — после них
app.route('/api/sales', sales)

app.route('/api/cash', cash)


export default app