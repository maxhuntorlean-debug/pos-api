PRAGMA foreign_keys = ON;

CREATE TABLE products (
  barcode INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  buy_price NUMERIC NOT NULL DEFAULT 0,
  sell_price NUMERIC NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_date TEXT NOT NULL,
  sale_time TEXT NOT NULL,
  sum NUMERIC NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  barcode INTEGER NOT NULL,
  name TEXT NOT NULL,
  buy_price NUMERIC NOT NULL,
  sell_price NUMERIC NOT NULL,

  FOREIGN KEY (sale_id)
    REFERENCES sales(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_sales_date
ON sales(sale_date);

CREATE INDEX idx_sales_user_id
ON sales(user_id);

CREATE INDEX idx_sale_items_sale_id
ON sale_items(sale_id);
