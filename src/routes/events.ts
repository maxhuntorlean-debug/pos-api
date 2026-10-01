import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'


// ======================================================
// TYPES
// ======================================================

type Bindings = {
  DB: D1Database
}

type Variables = {
  user: {
    id: number
    name: string
    username: string
    role: string
  }
}


// ======================================================
// ROUTER
// ======================================================

const events = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// GET EVENT LOG
// GET /api/events?from=2026-08-16&to=2026-08-16
// ======================================================

events.get('/', authMiddleware, async (c) => {

  // ----------------------------------------------------
  // PERIOD
  // ----------------------------------------------------

  const from =
    String(c.req.query('from') ?? '').trim()

  const to =
    String(c.req.query('to') ?? '').trim()


  // ----------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  ) {
    return c.json(
      {
        success: false,
        error: {
          message: 'Некорректный период журнала',
        },
      },
      400
    )
  }


  try {

    // --------------------------------------------------
    // LOAD EVENTS
    // --------------------------------------------------

    const result = await c.env.DB
      .prepare(`
        SELECT
          id,
          created_at,
          user_id,
          username,
          event_type,
          details
        FROM event_log
        WHERE created_at >= ?
          AND created_at < datetime(?, '+1 day')
        ORDER BY created_at DESC, id DESC
      `)
      .bind(
        `${from} 00:00:00`,
        `${to} 00:00:00`
      )
      .all()


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json({
      success: true,
      data: result.results,
    })

  } catch (error) {

    console.error(
      'Event log load failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка загрузки журнала событий',
        },
      },
      500
    )
  }
})


// ======================================================
// EXPORT
// ======================================================

export default events