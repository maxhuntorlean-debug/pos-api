// ======================================================
// EVENT LOG
// ======================================================

type EventUser = {
  id: number
  username: string
}


// ======================================================
// WRITE EVENT
// ======================================================

export async function writeEvent(
  db: D1Database,
  user: EventUser,
  eventType: string,
  details?: string
) {
  try {
    await db
      .prepare(`
        INSERT INTO event_log (
          user_id,
          username,
          event_type,
          details
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        user.id,
        user.username,
        eventType,
        details ?? null
      )
      .run()

  } catch (error) {
    // Ошибка журнала не должна ломать
    // основную операцию пользователя.

    console.error(
      'Event log write failed',
      error
    )
  }
}