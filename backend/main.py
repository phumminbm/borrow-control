from fastapi import FastAPI, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/borrow_control")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI(title="Borrow Control API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def ensure_tables(db):
    # ── ตารางหลัก ──────────────────────────────────────────────────
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS customers (
            cust_code TEXT PRIMARY KEY,
            customer_name TEXT, istock_id TEXT, erp_id TEXT, sale TEXT,
            status TEXT DEFAULT 'NORMAL', max_days INTEGER DEFAULT 0,
            active_br_count INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS borrows (
            borrow_no TEXT PRIMARY KEY, cust_code TEXT, borrow_date TEXT,
            status TEXT, days_borrowed INTEGER DEFAULT 0, borrow_alert TEXT,
            remark TEXT,
            sheet_status TEXT DEFAULT 'active',
            first_seen_at TIMESTAMPTZ DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ DEFAULT NOW(), closed_at TIMESTAMPTZ
        )
    """))
    # migrate existing table: add remark column if missing
    db.execute(text("""
        ALTER TABLE borrows ADD COLUMN IF NOT EXISTS remark TEXT
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS borrow_items (
            id SERIAL PRIMARY KEY, borrow_no TEXT, product_code TEXT,
            product_name TEXT, price NUMERIC(14,2), quantity INTEGER,
            total_price NUMERIC(14,2), updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(borrow_no, product_code)
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS sync_logs (
            id SERIAL PRIMARY KEY, synced_at TIMESTAMPTZ DEFAULT NOW(),
            status TEXT, sheet_rows INTEGER DEFAULT 0,
            br_inserted INTEGER DEFAULT 0, br_updated INTEGER DEFAULT 0,
            br_closed INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0, error_msg TEXT
        )
    """))

    # ── ตาราง Staging (รับข้อมูลระหว่าง sync) ──────────────────────
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS borrows_staging (
            borrow_no TEXT PRIMARY KEY, cust_code TEXT, borrow_date TEXT,
            status TEXT, days_borrowed INTEGER DEFAULT 0, borrow_alert TEXT,
            remark TEXT
        )
    """))
    db.execute(text("""
        ALTER TABLE borrows_staging ADD COLUMN IF NOT EXISTS remark TEXT
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS borrow_items_staging (
            id SERIAL PRIMARY KEY, borrow_no TEXT, product_code TEXT,
            product_name TEXT, price NUMERIC(14,2), quantity INTEGER,
            total_price NUMERIC(14,2),
            UNIQUE(borrow_no, product_code)
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS customers_staging (
            cust_code TEXT PRIMARY KEY,
            customer_name TEXT, istock_id TEXT, erp_id TEXT, sale TEXT
        )
    """))
    db.commit()

def recalc_all_customers(db):
    # 1. อัปเดตลูกค้าที่ยังมี active BR อยู่
    db.execute(text("""
        UPDATE customers c SET
            max_days        = sub.max_days,
            active_br_count = sub.cnt,
            status = CASE
                WHEN sub.max_days > 180 THEN 'BLOCK'
                WHEN sub.max_days > 90  THEN 'WARNING'
                ELSE 'NORMAL'
            END,
            updated_at = NOW()
        FROM (
            SELECT cust_code,
                   MAX(days_borrowed) AS max_days,
                   COUNT(*)           AS cnt
            FROM borrows
            WHERE sheet_status = 'active'
            GROUP BY cust_code
        ) sub
        WHERE c.cust_code = sub.cust_code
    """))

    # 2. Reset ลูกค้าที่ไม่มี active BR แล้ว → max_days=0, count=0, NORMAL
    db.execute(text("""
        UPDATE customers SET
            max_days        = 0,
            active_br_count = 0,
            status          = 'NORMAL',
            updated_at      = NOW()
        WHERE cust_code NOT IN (
            SELECT DISTINCT cust_code FROM borrows WHERE sheet_status = 'active'
        )
    """))

    db.commit()

def swap_staging_to_main(db):
    """
    SWAP staging → main tables ทีเดียว
    Sale จะเห็นข้อมูลใหม่ครบพร้อมกัน ไม่เห็นข้อมูลครึ่งๆ ระหว่าง sync
    """
    now = datetime.now(timezone.utc)

    # 1. Upsert customers จาก staging → main
    db.execute(text("""
        INSERT INTO customers (cust_code, customer_name, istock_id, erp_id, sale,
            status, max_days, active_br_count, updated_at)
        SELECT cust_code, customer_name, istock_id, erp_id, sale,
            'NORMAL', 0, 0, :now
        FROM customers_staging
        ON CONFLICT (cust_code) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            sale          = EXCLUDED.sale,
            updated_at    = EXCLUDED.updated_at
    """), {"now": now})

    # 2. Mark borrows ที่ไม่อยู่ใน staging แล้วว่า closed
    db.execute(text("""
        UPDATE borrows SET sheet_status='closed', closed_at=:now
        WHERE sheet_status='active'
          AND borrow_no NOT IN (SELECT borrow_no FROM borrows_staging)
    """), {"now": now})

    # 3. Upsert borrows จาก staging → main
    db.execute(text("""
        INSERT INTO borrows (borrow_no, cust_code, borrow_date, status,
            days_borrowed, borrow_alert, remark, sheet_status, first_seen_at, last_seen_at)
        SELECT borrow_no, cust_code, borrow_date, status,
            days_borrowed, borrow_alert, remark, 'active', :now, :now
        FROM borrows_staging
        ON CONFLICT (borrow_no) DO UPDATE SET
            cust_code     = EXCLUDED.cust_code,
            days_borrowed = EXCLUDED.days_borrowed,
            borrow_alert  = EXCLUDED.borrow_alert,
            remark        = EXCLUDED.remark,
            status        = EXCLUDED.status,
            sheet_status  = 'active',
            last_seen_at  = EXCLUDED.last_seen_at
    """), {"now": now})

    # 4. Upsert borrow_items จาก staging → main
    db.execute(text("""
        INSERT INTO borrow_items
            (borrow_no, product_code, product_name, price, quantity, total_price, updated_at)
        SELECT borrow_no, product_code, product_name, price, quantity, total_price, :now
        FROM borrow_items_staging
        ON CONFLICT (borrow_no, product_code) DO UPDATE SET
            product_name = EXCLUDED.product_name,
            price        = EXCLUDED.price,
            quantity     = EXCLUDED.quantity,
            total_price  = EXCLUDED.total_price,
            updated_at   = EXCLUDED.updated_at
    """), {"now": now})

    # 5. ลบ borrow_items ที่ไม่อยู่ใน staging แล้ว (สินค้าถูก CLEAR ออก)
    db.execute(text("""
        DELETE FROM borrow_items
        WHERE (borrow_no, product_code) NOT IN (
            SELECT borrow_no, product_code FROM borrow_items_staging
        )
        AND borrow_no IN (SELECT borrow_no FROM borrows_staging)
    """))

    db.commit()

def clear_staging(db):
    """ล้าง staging tables พร้อมรับ sync รอบใหม่"""
    db.execute(text("TRUNCATE borrows_staging, borrow_items_staging, customers_staging"))
    db.commit()

# ── Models ────────────────────────────────────────────────────────────

class SyncRow(BaseModel):
    borrow_no: str
    cust_code: str = ""
    customer_name: str = ""
    istock_id: str = ""
    erp_id: str = ""
    sale: str = ""
    borrow_date: str = ""
    status: str = ""
    days_borrowed: int = 0
    borrow_alert: str = ""
    remark: str = ""
    product_code: str = ""
    product_name: str = ""
    price: float = 0
    quantity: int = 0
    total_price: float = 0

class SyncPayload(BaseModel):
    rows: list[SyncRow]
    is_final_batch: bool = False

# ── Endpoints ─────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/customers")
def get_customers(
    sale: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    try: ensure_tables(db)
    except: pass
    q = "SELECT * FROM customers WHERE 1=1"
    params = {}
    if sale:   q += " AND sale=:sale";     params["sale"] = sale
    if status: q += " AND status=:status"; params["status"] = status.upper()
    q += " ORDER BY max_days DESC"
    rows = db.execute(text(q), params).fetchall()
    return [dict(r._mapping) for r in rows]

@app.get("/customers/{cust_code}/brs")
def get_customer_brs(cust_code: str, db: Session = Depends(get_db)):
    brs = db.execute(text("""
        SELECT borrow_no, borrow_date, days_borrowed, borrow_alert, status, remark
        FROM borrows WHERE cust_code=:cc AND sheet_status='active'
        ORDER BY days_borrowed DESC
    """), {"cc": cust_code}).fetchall()
    result = []
    for br in brs:
        items = db.execute(text("""
            SELECT product_code, product_name, price, quantity, total_price
            FROM borrow_items WHERE borrow_no=:bno
            ORDER BY product_code
        """), {"bno": br.borrow_no}).fetchall()
        result.append({**dict(br._mapping), "items": [dict(i._mapping) for i in items]})
    return result

@app.get("/alerts")
def get_alerts(sale: Optional[str] = Query(None), db: Session = Depends(get_db)):
    q = "SELECT * FROM customers WHERE status IN ('BLOCK','WARNING')"
    params = {}
    if sale: q += " AND sale=:sale"; params["sale"] = sale
    q += " ORDER BY max_days DESC"
    return [dict(r._mapping) for r in db.execute(text(q), params).fetchall()]

@app.get("/sales")
def get_sales(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT DISTINCT sale FROM customers WHERE sale IS NOT NULL ORDER BY sale"
    )).fetchall()
    return [r[0] for r in rows]

@app.get("/sync-logs")
def get_sync_logs(limit: int = 20, db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT * FROM sync_logs ORDER BY synced_at DESC LIMIT :limit"
        ), {"limit": limit}).fetchall()
        return [dict(r._mapping) for r in rows]
    except: return []

@app.post("/sync")
def sync_from_sheets(payload: SyncPayload, db: Session = Depends(get_db)):
    start = datetime.now(timezone.utc)
    stats = {"inserted": 0, "updated": 0, "closed": 0, "errors": 0}
    try: ensure_tables(db)
    except: pass

    try:
        # ── INSERT เข้า staging ทุก batch (ไม่แตะ borrows จริงเลย) ──────
        cust_params = []
        borrow_params = []
        item_params = []

        for row in payload.rows:
            if not row.borrow_no: continue

            if row.cust_code:
                cust_params.append({
                    "cc": row.cust_code, "name": row.customer_name,
                    "istock": row.istock_id, "erp": row.erp_id, "sale": row.sale
                })

            borrow_params.append({
                "bno": row.borrow_no, "cc": row.cust_code,
                "date": row.borrow_date, "status": row.status,
                "days": row.days_borrowed, "alert": row.borrow_alert,
                "remark": row.remark,
            })

            if row.product_code:
                item_params.append({
                    "bno": row.borrow_no, "code": row.product_code,
                    "name": row.product_name, "price": row.price,
                    "qty": row.quantity, "total": row.total_price
                })

        if cust_params:
            db.execute(text("""
                INSERT INTO customers_staging (cust_code, customer_name, istock_id, erp_id, sale)
                VALUES (:cc, :name, :istock, :erp, :sale)
                ON CONFLICT (cust_code) DO UPDATE SET
                    customer_name = EXCLUDED.customer_name,
                    sale          = EXCLUDED.sale
            """), cust_params)

        if borrow_params:
            db.execute(text("""
                INSERT INTO borrows_staging
                    (borrow_no, cust_code, borrow_date, status, days_borrowed, borrow_alert, remark)
                VALUES (:bno, :cc, :date, :status, :days, :alert, :remark)
                ON CONFLICT (borrow_no) DO UPDATE SET
                    cust_code     = EXCLUDED.cust_code,
                    days_borrowed = EXCLUDED.days_borrowed,
                    borrow_alert  = EXCLUDED.borrow_alert,
                    status        = EXCLUDED.status,
                    remark        = EXCLUDED.remark
            """), borrow_params)
            stats["updated"] = len(borrow_params)

        if item_params:
            db.execute(text("""
                INSERT INTO borrow_items_staging
                    (borrow_no, product_code, product_name, price, quantity, total_price)
                VALUES (:bno, :code, :name, :price, :qty, :total)
                ON CONFLICT (borrow_no, product_code) DO UPDATE SET
                    product_name = EXCLUDED.product_name,
                    price        = EXCLUDED.price,
                    quantity     = EXCLUDED.quantity,
                    total_price  = EXCLUDED.total_price
            """), item_params)

        db.commit()

    except Exception as e:
        stats["errors"] += 1
        try: db.rollback()
        except: pass

    # ── batch สุดท้าย → SWAP staging → main → recalc ─────────────────
    if payload.is_final_batch:
        try:
            swap_staging_to_main(db)
            recalc_all_customers(db)
            # ล้าง staging พร้อมรับ sync รอบหน้า
            clear_staging(db)
            stats["closed"] = 0  # closed ถูก handle ใน swap แล้ว
        except Exception as e:
            stats["errors"] += 1

    duration = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    try:
        db.execute(text("""
            INSERT INTO sync_logs (status, sheet_rows, br_inserted, br_updated, br_closed, errors, duration_ms)
            VALUES (:st, :rows, :ins, :upd, :cl, :err, :dur)
        """), {"st": "success" if not stats["errors"] else "partial",
               "rows": len(payload.rows), "ins": stats["inserted"],
               "upd": stats["updated"], "cl": stats["closed"],
               "err": stats["errors"], "dur": duration})
        db.commit()
    except: pass

    return {"success": True, "duration_ms": duration, **stats}

@app.get("/recalc")
def recalc(db: Session = Depends(get_db)):
    try:
        # ถ้า staging มีข้อมูลอยู่ แปลว่า sync กำลังทำอยู่ → ไม่ recalc ป้องกันข้อมูลหาย
        staging_count = db.execute(text("SELECT COUNT(*) FROM borrows_staging")).fetchone()[0]
        if staging_count > 0:
            return {
                "success": False,
                "reason": "sync_in_progress",
                "message": f"Sync กำลังทำอยู่ (staging มี {staging_count} แถว) — รอ sync เสร็จแล้วลองใหม่",
                "borrows_staging": staging_count
            }
        recalc_all_customers(db)
        c = db.execute(text("SELECT COUNT(*) FROM customers WHERE status='BLOCK'")).fetchone()[0]
        w = db.execute(text("SELECT COUNT(*) FROM customers WHERE status='WARNING'")).fetchone()[0]
        n = db.execute(text("SELECT COUNT(*) FROM customers WHERE status='NORMAL'")).fetchone()[0]
        return {"success": True, "BLOCK": c, "WARNING": w, "NORMAL": n}
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug")
def debug(db: Session = Depends(get_db)):
    try:
        b  = db.execute(text("SELECT COUNT(*) FROM borrows")).fetchone()[0]
        c  = db.execute(text("SELECT COUNT(*) FROM customers")).fetchone()[0]
        i  = db.execute(text("SELECT COUNT(*) FROM borrow_items")).fetchone()[0]
        bs = db.execute(text("SELECT COUNT(*) FROM borrows_staging")).fetchone()[0]
        return {"customers": c, "borrows": b, "borrow_items": i, "borrows_staging": bs}
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug-borrow/{cust_code}")
def debug_borrow(cust_code: str, db: Session = Depends(get_db)):
    exact = db.execute(text(
        "SELECT borrow_no, cust_code, days_borrowed, sheet_status FROM borrows WHERE cust_code=:cc LIMIT 5"
    ), {"cc": cust_code}).fetchall()
    fuzzy = db.execute(text(
        "SELECT borrow_no, cust_code, days_borrowed, sheet_status FROM borrows WHERE cust_code LIKE :cc LIMIT 5"
    ), {"cc": f"%{cust_code}%"}).fetchall()
    return {
        "exact": [dict(r._mapping) for r in exact],
        "fuzzy": [dict(r._mapping) for r in fuzzy],
    }

@app.get("/analytics/summary")
def analytics_summary(db: Session = Depends(get_db)):
    """มูลค่าค้างรวม + top5 + sale ranking"""
    try:
        total_value = db.execute(text("""
            SELECT COALESCE(SUM(bi.total_price), 0)
            FROM borrow_items bi
            JOIN borrows b ON bi.borrow_no = b.borrow_no
            WHERE b.sheet_status = 'active'
        """)).fetchone()[0]

        top5 = db.execute(text("""
            SELECT c.cust_code, c.customer_name, c.sale, c.max_days, c.status,
                   COALESCE(SUM(bi.total_price), 0) AS total_value
            FROM customers c
            LEFT JOIN borrows b ON b.cust_code = c.cust_code AND b.sheet_status = 'active'
            LEFT JOIN borrow_items bi ON bi.borrow_no = b.borrow_no
            WHERE c.status IN ('BLOCK','WARNING')
            GROUP BY c.cust_code, c.customer_name, c.sale, c.max_days, c.status
            ORDER BY c.max_days DESC
            LIMIT 5
        """)).fetchall()

        sale_rank = db.execute(text("""
            SELECT c.sale,
                   COUNT(*) FILTER (WHERE c.status='BLOCK')   AS block_count,
                   COUNT(*) FILTER (WHERE c.status='WARNING') AS warn_count,
                   COUNT(*) FILTER (WHERE c.status='NORMAL')  AS normal_count,
                   COALESCE(SUM(bi.total_price), 0)           AS total_value
            FROM customers c
            LEFT JOIN borrows b ON b.cust_code = c.cust_code AND b.sheet_status = 'active'
            LEFT JOIN borrow_items bi ON bi.borrow_no = b.borrow_no
            WHERE c.sale IS NOT NULL
            GROUP BY c.sale
            ORDER BY block_count DESC, warn_count DESC
        """)).fetchall()

        sale_value = db.execute(text("""
            SELECT c.sale, COALESCE(SUM(bi.total_price), 0) AS total_value
            FROM customers c
            LEFT JOIN borrows b ON b.cust_code = c.cust_code AND b.sheet_status = 'active'
            LEFT JOIN borrow_items bi ON bi.borrow_no = b.borrow_no
            GROUP BY c.sale
        """)).fetchall()

        return {
            "total_value": float(total_value),
            "top5": [dict(r._mapping) for r in top5],
            "sale_ranking": [dict(r._mapping) for r in sale_rank],
            "sale_value": {r.sale: float(r.total_value) for r in sale_value},
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/analytics/customer-value")
def customer_value(db: Session = Depends(get_db)):
    """มูลค่าค้างแยกตามลูกค้า"""
    try:
        rows = db.execute(text("""
            SELECT b.cust_code, COALESCE(SUM(bi.total_price), 0) AS total_value
            FROM borrows b
            JOIN borrow_items bi ON bi.borrow_no = b.borrow_no
            WHERE b.sheet_status = 'active'
            GROUP BY b.cust_code
        """)).fetchall()
        return {r.cust_code: float(r.total_value) for r in rows}
    except Exception as e:
        return {"error": str(e)}

@app.get("/migrate")
def migrate(db: Session = Depends(get_db)):
    """สร้าง staging tables ถ้ายังไม่มี"""
    try:
        ensure_tables(db)
        return {"success": True, "message": "Tables ensured"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.delete("/reset-db")
def reset_db(db: Session = Depends(get_db)):
    db.execute(text("""
        TRUNCATE borrow_items, borrows, customers, sync_logs,
                 borrows_staging, borrow_items_staging, customers_staging
        RESTART IDENTITY CASCADE
    """))
    db.commit()
    return {"success": True, "message": "DB cleared"}