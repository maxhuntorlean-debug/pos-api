import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import {
  hashPassword,
  verifyPassword
} from '../lib/password'

import {
  createSessionToken,
  hashSessionToken
} from '../lib/session'

import { authMiddleware } from '../middleware/auth'

type Bindings = {
  DB: D1Database
}

const auth = new Hono<{ Bindings: Bindings }>()


// ======================================
// BOOTSTRAP
// Первый администратор
// ======================================

auth.post('/bootstrap', async (c) => {
  const usersCount = await c.env.DB
    .prepare(`
      SELECT COUNT(*) AS count
      FROM users
    `)
    .first<{
      count: number
    }>()

  if ((usersCount?.count ?? 0) > 0) {
    return c.json(
      {
        ok: false,
        error: 'Bootstrap already completed'
      },
      409
    )
  }

  const body = await c.req.json<{
    name: string
    username: string
    password: string
  }>()

  const name = String(body.name ?? '').trim()
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')

  if (!name || !username || !password) {
    return c.json(
      {
        ok: false,
        error: 'Name, username and password are required'
      },
      400
    )
  }

  const adminRole = await c.env.DB
    .prepare(`
      SELECT id
      FROM roles
      WHERE code = 'admin'
        AND active = 1
      LIMIT 1
    `)
    .first<{
      id: number
    }>()

  if (!adminRole) {
    return c.json(
      {
        ok: false,
        error: 'Admin role not found'
      },
      500
    )
  }

  const passwordHash = await hashPassword(password)

  const result = await c.env.DB
    .prepare(`
      INSERT INTO users (
        name,
        username,
        password_hash,
        role_id,
        active
      )
      VALUES (?, ?, ?, ?, 1)
    `)
    .bind(
      name,
      username,
      passwordHash,
      adminRole.id
    )
    .run()

  return c.json(
    {
      ok: true,
      user: {
        id: result.meta.last_row_id,
        name,
        username,
        role: 'admin'
      }
    },
    201
  )
})


// ======================================
// REGISTER
// Обычный пользователь
// ======================================

auth.post('/register', async (c) => {
  const body = await c.req.json<{
    name: string
    username: string
    password: string
  }>()

  const name = String(body.name ?? '').trim()
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')

  if (!name || !username || !password) {
    return c.json(
      {
        ok: false,
        error: 'Name, username and password are required'
      },
      400
    )
  }

  const existingUser = await c.env.DB
    .prepare(`
      SELECT id
      FROM users
      WHERE username = ?
      LIMIT 1
    `)
    .bind(username)
    .first()

  if (existingUser) {
    return c.json(
      {
        ok: false,
        error: 'User already exists'
      },
      409
    )
  }

  const defaultRole = await c.env.DB
    .prepare(`
      SELECT id
      FROM roles
      WHERE code = 'user'
        AND active = 1
      LIMIT 1
    `)
    .first<{
      id: number
    }>()

  if (!defaultRole) {
    return c.json(
      {
        ok: false,
        error: 'Default role not found'
      },
      500
    )
  }

  const passwordHash = await hashPassword(password)

  const result = await c.env.DB
    .prepare(`
      INSERT INTO users (
        name,
        username,
        password_hash,
        role_id
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      name,
      username,
      passwordHash,
      defaultRole.id
    )
    .run()

  return c.json(
    {
      ok: true,
      user: {
        id: result.meta.last_row_id,
        name,
        username,
        role: 'user'
      }
    },
    201
  )
})


// ======================================
// LOGIN
// ======================================

auth.post('/login', async (c) => {
  const body = await c.req.json<{
    username: string
    password: string
  }>()

  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')

  if (!username || !password) {
    return c.json(
      {
        ok: false,
        error: 'Username and password are required'
      },
      400
    )
  }

  const user = await c.env.DB
    .prepare(`
      SELECT
        users.id,
        users.name,
        users.username,
        users.password_hash,
        users.active,
        users.role_id,
        roles.code AS role
      FROM users

      LEFT JOIN roles
        ON roles.id = users.role_id

      WHERE users.username = ?
      LIMIT 1
    `)
    .bind(username)
    .first<{
      id: number
      name: string
      username: string
      password_hash: string
      active: number
      role_id: number | null
      role: string | null
    }>()

  if (!user) {
    return c.json(
      {
        ok: false,
        error: 'Invalid username or password'
      },
      401
    )
  }

  if (!user.active) {
    return c.json(
      {
        ok: false,
        error: 'User is inactive'
      },
      403
    )
  }

  if (!user.role_id || !user.role) {
    return c.json(
      {
        ok: false,
        error: 'User role is not configured'
      },
      403
    )
  }

  const passwordOk = await verifyPassword(
    password,
    user.password_hash
  )

  if (!passwordOk) {
    return c.json(
      {
        ok: false,
        error: 'Invalid username or password'
      },
      401
    )
  }

  const sessionToken = createSessionToken()
  const sessionHash = await hashSessionToken(sessionToken)

  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  await c.env.DB
    .prepare(`
      INSERT INTO sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?)
    `)
    .bind(
      user.id,
      sessionHash,
      expiresAt.toISOString()
    )
    .run()

  c.header(
    'Set-Cookie',
    `session=${sessionToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=31536000`
  )

  return c.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    }
  })
})


// ======================================
// ME
// ======================================

auth.get(
  '/me',
  authMiddleware,
  async (c) => {
    const user = c.get('user')

    const result = await c.env.DB
      .prepare(`
        SELECT
          permissions.code
        FROM users

        JOIN role_permissions
          ON role_permissions.role_id = users.role_id

        JOIN permissions
          ON permissions.id = role_permissions.permission_id

        WHERE users.id = ?

        ORDER BY permissions.code
      `)
      .bind(user.id)
      .all<{
        code: string
      }>()

    const permissions = result.results.map(
      (permission) => permission.code
    )

    return c.json({
      ok: true,
      user: {
        ...user,
        permissions
      }
    })
  }
)

// ======================================
// LOGOUT
// ======================================

auth.post('/logout', async (c) => {
  const sessionToken = getCookie(c, 'session')

  if (sessionToken) {
    const sessionHash = await hashSessionToken(sessionToken)

    await c.env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE token_hash = ?
      `)
      .bind(sessionHash)
      .run()
  }

  c.header(
    'Set-Cookie',
    'session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0'
  )

  return c.json({
    ok: true
  })
})

export default auth