-- =====================================================
-- CASH DOCUMENTS
-- Кассовые документы Котопанды и Элитки
-- Один документ на одну кассу за одну дату
-- =====================================================

CREATE TABLE IF NOT EXISTS cash_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- KOTOPANDA / ELITKA
  cash_type TEXT NOT NULL,

  -- YYYY-MM-DD
  cash_date TEXT NOT NULL,

  -- Остаток, пришедший из предыдущего документа
  opening_balance REAL NOT NULL DEFAULT 0,

  -- Остаток после всех операций этого документа
  closing_balance REAL NOT NULL DEFAULT 0,

  -- Кто создал документ
  created_by INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    cash_type IN (
      'KOTOPANDA',
      'ELITKA'
    )
  ),

  -- В каждой кассе только один документ на дату
  UNIQUE (
    cash_type,
    cash_date
  )
);


-- =====================================================
-- CASH OPERATIONS
-- Операции внутри кассового документа
-- =====================================================

CREATE TABLE IF NOT EXISTS cash_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  cash_document_id INTEGER NOT NULL,

  -- 1 = приход
  -- -1 = расход
  sign INTEGER NOT NULL,

  -- CASH_DAY
  -- TERMINAL
  -- WITHDRAWAL
  -- SUGAR
  -- OTHER
  -- SALARY
  operation_type TEXT NOT NULL,

  -- Сумма всегда хранится положительной
  amount REAL NOT NULL,

  -- Для OTHER и SALARY будем требовать
  -- комментарий на уровне API
  comment TEXT,

  -- Кто добавил операцию
  created_by INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    sign IN (
      1,
      -1
    )
  ),

  CHECK (
    amount > 0
  ),

  FOREIGN KEY (
    cash_document_id
  )
  REFERENCES cash_documents(id)
  ON DELETE CASCADE
);


-- =====================================================
-- INDEX
-- Быстрый поиск документов конкретной кассы по дате
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cash_documents_type_date
ON cash_documents (
  cash_type,
  cash_date DESC
);


-- =====================================================
-- INDEX
-- Быстрая загрузка операций документа
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cash_operations_document
ON cash_operations (
  cash_document_id,
  id
);