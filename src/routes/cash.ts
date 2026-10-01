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

type CashType =
  | 'KOTOPANDA'
  | 'ELITKA'

type CashDocument = {
  id: number
  cash_type: CashType
  cash_date: string
  opening_balance: number
  closing_balance: number
  created_by: number
  created_at: string
}


// ======================================================
// ROUTER
// ======================================================

const cash = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// CASH TYPE
// ======================================================

function normalizeCashType(
  value: string
): CashType | null {

  const type =
    String(value ?? '')
      .trim()
      .toUpperCase()

  if (
    type === 'KOTOPANDA' ||
    type === 'ELITKA'
  ) {
    return type
  }

  return null
}


// ======================================================
// DATE
// ======================================================

function normalizeDate(
  value: unknown
): string | null {

  const date =
    String(value ?? '').trim()

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null
  }

  const [
    year,
    month,
    day,
  ] = date
    .split('-')
    .map(Number)

  const check =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    )

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }

  return date
}


// ======================================================
// TODAY — KYIV
// ======================================================

function getTodayKyiv(): string {

  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    )
      .formatToParts(
        new Date()
      )

  const year =
    parts.find(
      (part) =>
        part.type === 'year'
    )?.value

  const month =
    parts.find(
      (part) =>
        part.type === 'month'
    )?.value

  const day =
    parts.find(
      (part) =>
        part.type === 'day'
    )?.value

  return `${year}-${month}-${day}`
}

// ======================================================
// CASH REPORT
//
// GET /api/cash/ELITKA/report
//   ?from=2026-08-01
//   &to=2026-08-31
//
// Permission НЕ проверяем.
// Только обычный authMiddleware.
// ======================================================

cash.get(
  '/:type/report',
  authMiddleware,
  async (c) => {

    // ==================================================
    // CASH TYPE
    // ==================================================

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    // ==================================================
    // PERIOD
    // ==================================================

    const from =
      normalizeDate(
        c.req.query('from')
      )

    const to =
      normalizeDate(
        c.req.query('to')
      )


    if (
      !from ||
      !to ||
      from > to
    ) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректный период отчёта',
          },
        },
        400
      )
    }


    try {

      // ==================================================
      // FIRST DOCUMENT IN PERIOD
      //
      // Его opening_balance =
      // остаток на начало выбранного периода.
      // ==================================================

      const firstDocument =
        await c.env.DB
          .prepare(`
            SELECT
              id,
              cash_date,
              opening_balance
            FROM cash_documents
            WHERE cash_type = ?
              AND cash_date BETWEEN ? AND ?
            ORDER BY
              cash_date ASC,
              id ASC
            LIMIT 1
          `)
          .bind(
            cashType,
            from,
            to
          )
          .first<{
            id: number
            cash_date: string
            opening_balance: number
          }>()


      // ==================================================
      // LAST DOCUMENT IN PERIOD
      //
      // Его closing_balance =
      // остаток на конец выбранного периода.
      // ==================================================

      const lastDocument =
        await c.env.DB
          .prepare(`
            SELECT
              id,
              cash_date,
              closing_balance
            FROM cash_documents
            WHERE cash_type = ?
              AND cash_date BETWEEN ? AND ?
            ORDER BY
              cash_date DESC,
              id DESC
            LIMIT 1
          `)
          .bind(
            cashType,
            from,
            to
          )
          .first<{
            id: number
            cash_date: string
            closing_balance: number
          }>()


      // ==================================================
      // NO DOCUMENTS
      // ==================================================

      if (
        !firstDocument ||
        !lastDocument
      ) {

        return c.json({
          success: true,

          data: {
            cash_type:
              cashType,

            from,
            to,

            opening_balance: 0,

            closing_balance: 0,

            groups: [],
          },
        })
      }


      // ==================================================
      // OPERATIONS
      //
      // Получаем операции вместе с датой документа.
      // ==================================================

      const operationsResult =
        await c.env.DB
          .prepare(`
            SELECT
              o.id,
              d.cash_date,
              o.sign,
              o.operation_type,
              o.amount,
              o.comment
            FROM cash_operations o

            JOIN cash_documents d
              ON d.id =
                o.cash_document_id

            WHERE d.cash_type = ?
              AND d.cash_date
                BETWEEN ? AND ?

            ORDER BY
              d.cash_date ASC,
              o.id ASC
          `)
          .bind(
            cashType,
            from,
            to
          )
          .all<{
            id: number
            cash_date: string
            sign: number
            operation_type: string
            amount: number
            comment: string | null
          }>()


      // ==================================================
      // GROUP
      // ==================================================

      const groupsMap =
        new Map<
          string,
          {
            operation_type: string
            total: number

            operations: {
              id: number
              date: string
              amount: number
              comment: string | null
            }[]
          }
        >()


      for (
        const operation
        of operationsResult.results
      ) {

        const operationType =
          String(
            operation.operation_type
          )


        // -----------------------------------------------
        // В отчёте расход сразу отрицательный.
        // -----------------------------------------------

        const signedAmount =
          Number(
            operation.amount
          ) *
          Number(
            operation.sign
          )


        let group =
          groupsMap.get(
            operationType
          )


        if (!group) {

          group = {
            operation_type:
              operationType,

            total: 0,

            operations: [],
          }


          groupsMap.set(
            operationType,
            group
          )
        }


        group.total +=
          signedAmount


        group.operations.push({
          id:
            Number(
              operation.id
            ),

          date:
            operation.cash_date,

          amount:
            signedAmount,

          comment:
            operation.comment,
        })
      }


      // ==================================================
      // ELITKA ORDER
      //
      // Фиксируем порядок строк отчёта.
      // Не зависит от порядка операций в БД.
      // ==================================================

      const ELITKA_ORDER = [
        'SALES',
        'TERMINAL',
        'WITHDRAWAL',
        'SUGAR',
        'OTHER',
        'SALARY',
      ]


      const groups =
        Array.from(
          groupsMap.values()
        )
          .sort(
            (a, b) => {

              const aIndex =
                ELITKA_ORDER.indexOf(
                  a.operation_type
                )

              const bIndex =
                ELITKA_ORDER.indexOf(
                  b.operation_type
                )


              const normalizedA =
                aIndex === -1
                  ? 999
                  : aIndex

              const normalizedB =
                bIndex === -1
                  ? 999
                  : bIndex


              return (
                normalizedA -
                normalizedB
              )
            }
          )


      // ==================================================
      // RESPONSE
      // ==================================================

      return c.json({
        success: true,

        data: {

          cash_type:
            cashType,

          from,

          to,

          opening_balance:
            Number(
              firstDocument
                .opening_balance
            ) || 0,

          groups,

          closing_balance:
            Number(
              lastDocument
                .closing_balance
            ) || 0,
        },
      })


    } catch (error) {

      console.error(
        'Cash report load failed',
        error
      )


      return c.json(
        {
          success: false,

          error: {
            message:
              'Ошибка загрузки отчёта кассы',
          },
        },
        500
      )
    }
  }
)
// ======================================================
// GET DOCUMENT
// ======================================================

async function getDocument(
  db: D1Database,
  id: number,
  cashType: CashType
) {

  return db
    .prepare(`
      SELECT
        id,
        cash_type,
        cash_date,
        opening_balance,
        closing_balance,
        created_by,
        created_at
      FROM cash_documents
      WHERE id = ?
        AND cash_type = ?
      LIMIT 1
    `)
    .bind(
      id,
      cashType
    )
    .first<CashDocument>()
}


// ======================================================
// OPERATIONS TOTAL
// ======================================================

async function getOperationsTotal(
  db: D1Database,
  documentId: number
): Promise<number> {

  const result =
    await db
      .prepare(`
        SELECT
          COALESCE(
            SUM(sign * amount),
            0
          ) AS total
        FROM cash_operations
        WHERE cash_document_id = ?
      `)
      .bind(documentId)
      .first<{
        total: number
      }>()

  return Number(
    result?.total
  ) || 0
}


// ======================================================
// RECALCULATE CASH CHAIN
//
// Пересчитывает документ с указанной даты
// и ВСЕ следующие документы этой кассы.
// ======================================================

async function recalculateFromDate(
  db: D1Database,
  cashType: CashType,
  fromDate: string
) {

  // ----------------------------------------------------
  // PREVIOUS DOCUMENT
  // ----------------------------------------------------

  const previous =
    await db
      .prepare(`
        SELECT
          closing_balance
        FROM cash_documents
        WHERE cash_type = ?
          AND cash_date < ?
        ORDER BY
          cash_date DESC,
          id DESC
        LIMIT 1
      `)
      .bind(
        cashType,
        fromDate
      )
      .first<{
        closing_balance: number
      }>()


  let balance =
    previous
      ? Number(
          previous.closing_balance
        ) || 0
      : 0


  // ----------------------------------------------------
  // DOCUMENTS FROM DATE
  // ----------------------------------------------------

  const documents =
    await db
      .prepare(`
        SELECT
          id,
          cash_date
        FROM cash_documents
        WHERE cash_type = ?
          AND cash_date >= ?
        ORDER BY
          cash_date ASC,
          id ASC
      `)
      .bind(
        cashType,
        fromDate
      )
      .all<{
        id: number
        cash_date: string
      }>()


  // ----------------------------------------------------
  // RECALCULATE
  // ----------------------------------------------------

  for (
    const document of documents.results
  ) {

    const openingBalance =
      balance

    const operationsTotal =
      await getOperationsTotal(
        db,
        document.id
      )

    const closingBalance =
      openingBalance +
      operationsTotal


    await db
      .prepare(`
        UPDATE cash_documents
        SET
          opening_balance = ?,
          closing_balance = ?
        WHERE id = ?
      `)
      .bind(
        openingBalance,
        closingBalance,
        document.id
      )
      .run()


    balance =
      closingBalance
  }
}


// ======================================================
// AMOUNT
// ======================================================

function normalizeAmount(
  value: unknown
): number | null {

  const amount =
    Number(value)

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null
  }

  return amount
}


// ======================================================
// SIGN
// ======================================================

function normalizeSign(
  value: unknown
): 1 | -1 | null {

  const sign =
    Number(value)

  if (sign === 1) {
    return 1
  }

  if (sign === -1) {
    return -1
  }

  return null
}


// ======================================================
// GET CASH JOURNAL
//
// GET /api/cash/KOTOPANDA
// GET /api/cash/ELITKA
// ======================================================

cash.get(
  '/:type',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    try {

      const result =
        await c.env.DB
          .prepare(`
            SELECT
              id,
              cash_type,
              cash_date,
              opening_balance,
              closing_balance,
              created_by,
              created_at
            FROM cash_documents
            WHERE cash_type = ?
            ORDER BY
              cash_date DESC,
              id DESC
          `)
          .bind(cashType)
          .all()


      return c.json({
        success: true,
        data: result.results,
      })

    } catch (error) {

      console.error(
        'Cash journal load failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка загрузки кассы',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// CREATE DOCUMENT
//
// POST /api/cash/KOTOPANDA
//
// Без body:
// -> документ за сегодня
//
// С body:
// {
//   "date": "2026-08-06"
// }
//
// -> документ за выбранную дату
//
// Permission здесь НЕ проверяем.
// ======================================================

cash.post(
  '/:type',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    try {

      const user =
        c.get('user')


      // ------------------------------------------------
      // OPTIONAL BODY
      // ------------------------------------------------

      let body: {
        date?: string
      } = {}


      try {

        body =
          await c.req.json<{
            date?: string
          }>()

      } catch {
        // body отсутствует
      }


      // ------------------------------------------------
      // DATE
      // ------------------------------------------------

      let cashDate =
        getTodayKyiv()


      if (
        body.date !== undefined
      ) {

        const requestedDate =
          normalizeDate(
            body.date
          )


        if (!requestedDate) {

          return c.json(
            {
              success: false,
              error: {
                message:
                  'Некорректная дата',
              },
            },
            400
          )
        }


        cashDate =
          requestedDate
      }


      // ------------------------------------------------
      // NO FUTURE
      // ------------------------------------------------

      if (
        cashDate > getTodayKyiv()
      ) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Нельзя создать документ на будущую дату',
            },
          },
          400
        )
      }


      // ------------------------------------------------
      // ALREADY EXISTS
      // ------------------------------------------------

      const existing =
        await c.env.DB
          .prepare(`
            SELECT id
            FROM cash_documents
            WHERE cash_type = ?
              AND cash_date = ?
            LIMIT 1
          `)
          .bind(
            cashType,
            cashDate
          )
          .first<{
            id: number
          }>()


      if (existing) {

        return c.json(
          {
            success: false,

            error: {
              message:
                'Документ за эту дату уже существует',
            },

            data: {
              id: existing.id,
            },
          },
          409
        )
      }


      // ------------------------------------------------
      // PREVIOUS DOCUMENT
      // ------------------------------------------------

      const previous =
        await c.env.DB
          .prepare(`
            SELECT
              closing_balance
            FROM cash_documents
            WHERE cash_type = ?
              AND cash_date < ?
            ORDER BY
              cash_date DESC,
              id DESC
            LIMIT 1
          `)
          .bind(
            cashType,
            cashDate
          )
          .first<{
            closing_balance: number
          }>()


      const openingBalance =
        previous
          ? Number(
              previous.closing_balance
            ) || 0
          : 0


      // ------------------------------------------------
      // INSERT
      // ------------------------------------------------

      const result =
        await c.env.DB
          .prepare(`
            INSERT INTO cash_documents (
              cash_type,
              cash_date,
              opening_balance,
              closing_balance,
              created_by
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            cashType,
            cashDate,
            openingBalance,
            openingBalance,
            user.id
          )
          .run()


      const documentId =
        Number(
          result.meta.last_row_id
        )


      // ------------------------------------------------
      // RECALCULATE CHAIN
      //
      // Нужно, если вставили старый документ
      // между уже существующими.
      // ------------------------------------------------

      await recalculateFromDate(
        c.env.DB,
        cashType,
        cashDate
      )


      const document =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      return c.json(
        {
          success: true,
          data: document,
        },
        201
      )

    } catch (error) {

      console.error(
        'Cash document creation failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка создания кассового документа',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// GET DOCUMENT
//
// GET /api/cash/KOTOPANDA/15
//
// editable сервер больше НЕ возвращает.
// Это определяет клиент.
// ======================================================

cash.get(
  '/:type/:id',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )

    const id =
      Number(
        c.req.param('id')
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректный номер документа',
          },
        },
        400
      )
    }


    try {

      const document =
        await getDocument(
          c.env.DB,
          id,
          cashType
        )


      if (!document) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Кассовый документ не найден',
            },
          },
          404
        )
      }


      const operations =
        await c.env.DB
          .prepare(`
            SELECT
              id,
              cash_document_id,
              sign,
              operation_type,
              amount,
              comment,
              created_by,
              created_at
            FROM cash_operations
            WHERE cash_document_id = ?
            ORDER BY id ASC
          `)
          .bind(id)
          .all()


      return c.json({
        success: true,

        data: {
          ...document,

          operations:
            operations.results,
        },
      })

    } catch (error) {

      console.error(
        'Cash document load failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка загрузки кассового документа',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// ADD OPERATION
//
// POST /api/cash/KOTOPANDA/15/operations
// ======================================================

cash.post(
  '/:type/:id/operations',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )

    const documentId =
      Number(
        c.req.param('id')
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    if (
      !Number.isInteger(
        documentId
      ) ||
      documentId <= 0
    ) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректный номер документа',
          },
        },
        400
      )
    }


    try {

      const user =
        c.get('user')


      const document =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      if (!document) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Кассовый документ не найден',
            },
          },
          404
        )
      }


      // ------------------------------------------------
      // BODY
      // ------------------------------------------------

      const body =
        await c.req.json<{
          sign?: number
          operation_type?: string
          amount?: number
          comment?: string
        }>()


      const sign =
        normalizeSign(
          body.sign
        )

      const amount =
        normalizeAmount(
          body.amount
        )

      const operationType =
        String(
          body.operation_type ?? ''
        )
          .trim()
          .toUpperCase()

      const comment =
        String(
          body.comment ?? ''
        ).trim()


      // ------------------------------------------------
      // VALIDATION
      // ------------------------------------------------

      if (sign === null) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Некорректный тип операции',
            },
          },
          400
        )
      }


      if (!operationType) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Не указана операция',
            },
          },
          400
        )
      }


      if (amount === null) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Некорректная сумма',
            },
          },
          400
        )
      }


      // ------------------------------------------------
      // INSERT
      // ------------------------------------------------

      const result =
        await c.env.DB
          .prepare(`
            INSERT INTO cash_operations (
              cash_document_id,
              sign,
              operation_type,
              amount,
              comment,
              created_by
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            documentId,
            sign,
            operationType,
            amount,
            comment || null,
            user.id
          )
          .run()


      const operationId =
        Number(
          result.meta.last_row_id
        )


      // ------------------------------------------------
      // RECALCULATE FROM DOCUMENT DATE
      // ------------------------------------------------

      await recalculateFromDate(
        c.env.DB,
        cashType,
        document.cash_date
      )


      const updatedDocument =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      return c.json(
        {
          success: true,

          data: {
            id: operationId,

            cash_document_id:
              documentId,

            sign,

            operation_type:
              operationType,

            amount,

            comment:
              comment || null,

            closing_balance:
              updatedDocument
                ?.closing_balance ?? 0,
          },
        },
        201
      )

    } catch (error) {

      console.error(
        'Cash operation creation failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка добавления операции',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// UPDATE OPERATION
//
// PUT /api/cash/KOTOPANDA/15/operations/7
// ======================================================

cash.put(
  '/:type/:id/operations/:operationId',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )

    const documentId =
      Number(
        c.req.param('id')
      )

    const operationId =
      Number(
        c.req.param(
          'operationId'
        )
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    if (
      !Number.isInteger(
        documentId
      ) ||
      documentId <= 0 ||
      !Number.isInteger(
        operationId
      ) ||
      operationId <= 0
    ) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректный номер',
          },
        },
        400
      )
    }


    try {

      const document =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      if (!document) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Кассовый документ не найден',
            },
          },
          404
        )
      }


      // ------------------------------------------------
      // OPERATION EXISTS
      // ------------------------------------------------

      const existing =
        await c.env.DB
          .prepare(`
            SELECT id
            FROM cash_operations
            WHERE id = ?
              AND cash_document_id = ?
            LIMIT 1
          `)
          .bind(
            operationId,
            documentId
          )
          .first()


      if (!existing) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Операция не найдена',
            },
          },
          404
        )
      }


      // ------------------------------------------------
      // BODY
      // ------------------------------------------------

      const body =
        await c.req.json<{
          sign?: number
          operation_type?: string
          amount?: number
          comment?: string
        }>()


      const sign =
        normalizeSign(
          body.sign
        )

      const amount =
        normalizeAmount(
          body.amount
        )

      const operationType =
        String(
          body.operation_type ?? ''
        )
          .trim()
          .toUpperCase()

      const comment =
        String(
          body.comment ?? ''
        ).trim()


      if (
        sign === null ||
        !operationType ||
        amount === null
      ) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Некорректные данные операции',
            },
          },
          400
        )
      }


      // ------------------------------------------------
      // UPDATE
      // ------------------------------------------------

      await c.env.DB
        .prepare(`
          UPDATE cash_operations
          SET
            sign = ?,
            operation_type = ?,
            amount = ?,
            comment = ?
          WHERE id = ?
            AND cash_document_id = ?
        `)
        .bind(
          sign,
          operationType,
          amount,
          comment || null,
          operationId,
          documentId
        )
        .run()


      // ------------------------------------------------
      // RECALCULATE CHAIN
      // ------------------------------------------------

      await recalculateFromDate(
        c.env.DB,
        cashType,
        document.cash_date
      )


      const updatedDocument =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      return c.json({
        success: true,

        data: {
          id: operationId,

          cash_document_id:
            documentId,

          sign,

          operation_type:
            operationType,

          amount,

          comment:
            comment || null,

          closing_balance:
            updatedDocument
              ?.closing_balance ?? 0,
        },
      })

    } catch (error) {

      console.error(
        'Cash operation update failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка изменения операции',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// DELETE OPERATION
//
// DELETE /api/cash/KOTOPANDA/15/operations/7
// ======================================================

cash.delete(
  '/:type/:id/operations/:operationId',
  authMiddleware,
  async (c) => {

    const cashType =
      normalizeCashType(
        c.req.param('type')
      )

    const documentId =
      Number(
        c.req.param('id')
      )

    const operationId =
      Number(
        c.req.param(
          'operationId'
        )
      )


    if (!cashType) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректная касса',
          },
        },
        400
      )
    }


    if (
      !Number.isInteger(
        documentId
      ) ||
      documentId <= 0 ||
      !Number.isInteger(
        operationId
      ) ||
      operationId <= 0
    ) {

      return c.json(
        {
          success: false,
          error: {
            message:
              'Некорректный номер',
          },
        },
        400
      )
    }


    try {

      const document =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      if (!document) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Кассовый документ не найден',
            },
          },
          404
        )
      }


      // ------------------------------------------------
      // OPERATION EXISTS
      // ------------------------------------------------

      const existing =
        await c.env.DB
          .prepare(`
            SELECT id
            FROM cash_operations
            WHERE id = ?
              AND cash_document_id = ?
            LIMIT 1
          `)
          .bind(
            operationId,
            documentId
          )
          .first()


      if (!existing) {

        return c.json(
          {
            success: false,
            error: {
              message:
                'Операция не найдена',
            },
          },
          404
        )
      }


      // ------------------------------------------------
      // DELETE
      // ------------------------------------------------

      await c.env.DB
        .prepare(`
          DELETE FROM cash_operations
          WHERE id = ?
            AND cash_document_id = ?
        `)
        .bind(
          operationId,
          documentId
        )
        .run()


      // ------------------------------------------------
      // RECALCULATE CHAIN
      // ------------------------------------------------

      await recalculateFromDate(
        c.env.DB,
        cashType,
        document.cash_date
      )


      const updatedDocument =
        await getDocument(
          c.env.DB,
          documentId,
          cashType
        )


      return c.json({
        success: true,

        data: {
          id: operationId,

          closing_balance:
            updatedDocument
              ?.closing_balance ?? 0,
        },
      })

    } catch (error) {

      console.error(
        'Cash operation delete failed',
        error
      )


      return c.json(
        {
          success: false,
          error: {
            message:
              'Ошибка удаления операции',
          },
        },
        500
      )
    }
  }
)


// ======================================================
// EXPORT
// ======================================================

export default cash