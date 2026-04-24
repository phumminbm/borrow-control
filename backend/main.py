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
            remark TEXT DEFAULT '',
            sheet_status TEXT DEFAULT 'active',
            first_seen_at TIMESTAMPTZ DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ DEFAULT NOW(), closed_at TIMESTAMPTZ
        )
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
            remark TEXT DEFAULT ''
        )
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

    # migration: เพิ่ม remark column ถ้า DB เก่ายังไม่มี
    db.execute(text("ALTER TABLE borrows ADD COLUMN IF NOT EXISTS remark TEXT DEFAULT ''"))
    db.execute(text("ALTER TABLE borrows_staging ADD COLUMN IF NOT EXISTS remark TEXT DEFAULT ''"))
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
# ─────────────────────────────────────────────────────────────
# PDF Export
# ─────────────────────────────────────────────────────────────
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io, base64, tempfile, os as _os

import os as _os_mod
from pathlib import Path

_FONT_REGISTERED = False
_FONT_DIR = Path(__file__).parent / "fonts"

def _ensure_fonts():
    global _FONT_REGISTERED
    if _FONT_REGISTERED: return
    fonts = {
        "TH":  "FreeSerif.ttf",
        "THB": "FreeSerifBold.ttf",
    }
    for name, fname in fonts.items():
        fpath = _FONT_DIR / fname
        pdfmetrics.registerFont(TTFont(name, str(fpath)))
    _FONT_REGISTERED = True

LOGO_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCADIAfUDASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAcIBQYBAwQCCf/EAFgQAAEDAwEEBQcGBwsKBAcAAAECAwQABREGBxIhMQgTQVFhFBUiMnGBkUJSYqGx0SNVcoKSlMEWFzM3Q1NUY3WisyU0OFZ0k7LC0vAYJDaDNXaEpLTT4f/EABsBAQACAwEBAAAAAAAAAAAAAAABAgMEBQYH/8QAOBEAAgECBAMFBwIEBwAAAAAAAAECAxEEBRIxBiFRFEFhgZEiMnGhsdHhE8EVFlLwIzNCU2Ki8f/aAAwDAQACEQMRAD8AuBSlKuUFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBQ8Bk1rmvNZ2XR1t8qubpW85kMRWsF14+A7B3qPAe0gGueudoupNWOLakSTBtx4JhRlkJI+mrms8ufDwFZqdGU+fcd3KeH8VmXtR9mHV/su/wCniT5qbafoywrWy/dUzJKeBYhjrVZ7iR6IPtIrWbZtik328JtmmtGTbg8obw62WlrdT85RCVBKfEn2ZqGtn+jrrrG7+QW5IajskGVKUn0GEn7VHjhPb4DjVo9GaWs+krQm3WiPuJ4F15fFx5Xzlq7T9Q5AAVknCnT5bs6uZ4HKsoh+m06tV9zdkvF2t6XMvGU+qO2qS2208UguIbWVpSrtAUQMjxwPZXZSlap4182KUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAcEgAkkADiSaqdr7WlzvesLlcIF1msQy71cZDL6kJ6pHopVgH5WCr86p2266iOn9ASkMOFE24nyOPg4I3gd9Q9id734qraEhKQkcABit3C0+Tkz6DwZlycJ4qavfkv3f0+ZkvP9+/Hlz/W1/fTz/ffx5dP1tf31jTStrSj3PZ6X9K9EZLz/ffx3c/1tf31Yzo+TpM/Zy05LkPSHUS3kFbqypRG9kcT7arDVh+jA8V6LuLB/k7ioj3torBiV7B5fi7DwWXaopK0kSzSlK558tFaLtW2iwdGQxFYDcu9Po3mIxPBtPLrHMck55Dmo8ByJHbtY13G0XZR1Qbfu0oFMOOo8B3uL7dwfWcDvIq5OmTLjPfuFwkuSpkhW+884fSWr9g7ABwAwBwrZoUdbu9j13DnDrxr7RXX+Gtl/V+Ovodt5uVwvNyeud2mOS5jxyt1f2AcgkdgHAV79EaYuertQNWi2gJHBciQoZSw3nio957AO0+GSMVEiyZ0xiFBYXIlSHA0y0jmtRPAf/3sHGrXbM9Hw9E6ZTDCkLmO/hZ0n+ccxxwTyQnkB3ceZNbVaoqceW57DPc3hlOGUaSWt8orp426LuMtpTT9s0zZGLRamOrYaGSo8VuKPNaj2qP/AHwxWVqK9bbabJaXHIlgY88ykZBdSvdjpP5XNf5ox41FV72r66uaz/ldMBs/yUJkIA/OOVfXWnGhOfNnh8Lw1mWPf61T2b87y3flv6lqaVTZeqNUOLK16mvRJOT/AOfdH/NXttmvdaW5QVG1NcTjiEvOdcn4LzV+yy6nQlwRiLezVjfzLeUqC9Fbc3Oubi6uhthonHl0VB9DxW3x4eKfhU3w5MeZEalxH2347yAtp1tQUlaSMggjmKwTpyhueazHKsVl09NeNr7PufmdtKUqhzhStc1trXT+kIqXbxLw84MsxmhvvO+xPYPE4HjUL6l246jmuLbskONamOSVuDrnj48fRHswfbWWFGU9jsZfkWNx61Uo2j1fJfnyLF0qn8/W2sZy9+Rqe6nwbkFsfBGBXQzqvVTKgtrU15Sodvlrh+01l7K+p31wRiLc6qv8GXHpVY9NbYtZWp1CZz7F5j/KbkICHMeC0gcfaDU66A1vZdZwFPW5amZTQHlER7Aca8fFJ7FDh7DwrFOjKHNnDzPh/GZctdRXj1W3n3o2elKViOIKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSlAKUpQClKUApSsDtA1A3pfSFwvKsKcZbwwg/LdV6KE/pEe7NSk27IyUaUq1SNOCu27LzIB6QOohe9eqgsOBUW0IMdOOReJBdPuwlPtSajuvpanHFKdecU664orWtXNSjxJPtPGvmurCOlWPuOBwkcHh4UI7RVvu/NilDSrG2KnbosPg2+/xRn0H2XD+ckj/lFQTUy9Fl0Ju9+j8AVsMrA78KWOH6X2Vhr/AOWzz/FENWV1fCz+aJ7rD6y1Fb9K6ek3m4qPVMgBDafWdcPBKE+JPw4k8AazFVb21azVqzU5Yhuk2e3qU3F3Vei8vkp3xzyT4DPyjWlSp65WPnORZTLMsSoP3Fzk/Dp8Wapqa9XHUV8k3m6u78qQr1QfRbSPVbSOxI+88yaxwOKVnNBade1XqyFZGipLTqi5JcTzbZSRvnPYeSR4qFdK6ivBH16cqWFoN+7GK9EiWOjlo9LMZetbm2kKWlTdvCx6jfELd4/O5A/NB+dWqbYNpcrU8x20WZ9bFhbUUlaDhU0g+sT/ADfcnt5nsA3vpB6gb09pCHpS1BMcz2+qUhvgG4qAAUjuzlKfZvVXztrXpx1v9SR5fJcK8xrSzTEK93aC6Jd/9992c4AT2Cs9o7RuotWurFlg9Yw2rdckuq3GUHu3u0+ABrG2WEi5XeHb3JjUJuQ8lDkh1YSlpGfSUSeAwM+/FWosd+0HZbTGtVsv9jjxIzYQ02ma3wHeePEk8STxJJJq9Wo4Llub2fZxVwEIwoQ1Tl4NpLy+RDr2wrVqGCtFys7rgGerDjic+GSmo61BZ7nYLou2XeG5EltjJQriFA8lJI4KSe8fbmrafuy0j/rPZv11v76ifpH3HTl4s1olWy626bNYlKbIjvpcWGlIJOd08spTWKlWm5WkjjZLn+YVsVGjiYezLvs1b8EKdlTH0a9VuR7m7pCU6TGfSt+EFH+DcHFaB4KGVY7wrvqHKzWhJjlv1vYpjZwpE9ke0KUEqHvCiK2KkdUWj1GcYOGMwVSlJd118VsXGrRdr+vmdF2hDcZKJF4mAiKyrkgDm6v6I7B2nA7yN2kvtRozsl9YQ00grWo8gkDJNU71nqCRqnU82+SSodevDKD/ACbI4IR8OJ8ST21o0KWuXPY+bcNZRHMMQ5Vfchv4vuX3Mdcps253F64XGS5Klvq3nXnDlSj+wDkAOAHKvPivo1uOx/SDesdWiLLC/NsRvr5m6SCsZwlvI4jeOckdgNdCTUVdn1LEV6WDoSqz5Riv7S/Y1i3Wy53FCl262TpqEcFKjx1uAe9INeVxC23VNOIW24k4UhaSFA9xBq7UONHhxW4sRhqOw0kJbbbSEpSO4AcBUU9JTT8KRphrUTbKET4j6G1upGFONKON0ntwSCM8uPfWtDE6pWseUy7i9YrFxoSp2UnZO/pfkV7Fe/Tl6n6dvsW9W1xSJEZed0HAdT8ptXgocPgeYFeAVzwrasnyZ7KpTjUg4TV09y6NiucW82aHdYSt6PLZS82e3ChnB8Ryr21HXR1kuP7MYrSySI0l5lBJ+TvlQ+G9j3VItcmcdMmj4bj8OsNiqlFbRbQpSlVNQUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFV+6TOpPK7zD0xGcy1CHlMrHa6oEIT7kkn88VOeoLpFslkm3eardjxGVOr7zgch4nkPE1Ta7T5V3ukq6zVb0mY6p53jkAqOcDwAwB4AVtYWneWroey4Ny/9bEvEyXKG3xf2X7HnzkVxSvbYbXKvl7hWaED18x5LKVYzuA8Sr2JAKvdW83bmfS5zjCLlJ2S3Noh6W6vY3ctWSGUl2RNZbiKUni20he6tQ7t5RI9iR31pXHtq0G1izxYOxW42qE3usQIjQZHPAbUkg/AcTVX/rrFRnrTficPh/MZZhSq1X/W7eCsrCpU6Mb25rycz2O21Rx4pcR99RXUhdHySmNtLZLi0obXDfCio4AwArPwTU1VeDNnPYa8urL/AIv5cyUukFq5Vh0umzwXii5XUKbCknBaYH8IvwJyEj8rI5VWxIwAAMADAA7Kz+0DUjmrNXzr0onqFnqoiTzSwkkI9meKj4qrBZHfSjT0R8TFkOWfw7Bxg17T5y+PTy2Pkg91WI6N2mRbdMPaiktgSrqR1R+bHSTu4/KOVeI3agnTVne1DqK32NgkLmPpbUoc0I5rV7khR91XHhRmIUJiHFbDbDDaW20DklKRgD4CsWKnZaTh8Z5g6VCOFi+cub+C+7+hWDbzcl3DadcUFWUQ0NxkDuASFH+8s1olbTtdacZ2nahQ5kZlBYHgpCSPqrVqzU1aKPUZXCMMFRjHbSvofK1Nox1ikpzwG8cZr566N/Os/pCpl6L6Yjt5vzEhtpx0x2VIStIPohS97GfEp+Iqd/IYX9Dj/wC6H3ViqYhQlaxwc14pjl+Jlh3Sva3O9t1foUiL0b+dZ/SFA9HHJ1ofnCru+QQf6HH/AN0n7qxzs7S7Tq2nZlmQ4hRSpKnGwUkcwR2Gqdqv3GjHjZT92g35/gpp17P883+kKymkNyTq+yR23EFblxjpSAoHJ6xNW1846T/p9k/3zX316rc7Y5jqjb3LdIcZwVdQpCijOcE45cj8KPE8titbjGTpyXZ2rre/4NY263BUDZhdurVurkpRFHscUEq/u71VXqzHSOZW7szeWgcGZbC1nuG9j7SKrOavhfcN7guEVgJSW7k/ohVhujDb0saPuFyKAHJc4pz3oQkAfWVVXmrHdGi4x5Gg3bchaevgzHOsRnjurO+lXsOVD801OJ9wz8XuSy16drq/w/8AbEpVF/SWmpj7P2ouRvy5zSAPBIKz/wAI+NShVZ+kBqtjUWqmbfb3g7AtaVI6xJylx5WN8g9oAASD371alCOqaPD8MYOeJzCDS5R5vy2+ZG+c0pXqs9tl3m7RLRASVSpjoZa4cieaj4AZUfAGukfXpSjCLlJ2SLK9HyGuJswgrWCDJdef9xWQD8Eg1INeOyW6PaLPDtcQYYiMIZb9iQAPsr2VyZvVJs+F47EdpxNSsv8AU2/mKUpVTVFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKV0XGZGt8CRPmOpajx21OurPJKUjJPwFCUnJ2RDXSb1LuRoWlIy/SeIlTMdiAfwafeoE/mjvqC6yWqb1I1HqOffJIKXJjpWEn5CAAEJ9yQB8axtdalDRGx9rybL1gMHCj37v4vf7Cpr6Mmmd9+bqyU36KMxIWR283Vj6k+5VQ7a4Mu6XOLbICN+XMdSyyMcN49p8BzJ7ADVxdL2aJp7T0GywRhiIyGwSOKz2qPiTknxJrDiZ6Y6epxOL8y7PhVh4v2p/Tv8AXb1PHtFjmVoK/MBO8VW9/Ax2hBIqniTlII7RV2bmyJFtlR1DeDrK0Ed+QRVJWgUtpSTkgYNUwj5NGnwPO9KtDo0/W/2Pqu6LKkRFOKjPKaU40ppZTzKFDCk+8cK6aVtnumk1ZilKEhIJPIUJJj6MNi8ovFy1G8jKIrYiMHHy1YUs+0J3R+can2tO2M2XzHs5tTC0bj8hvyt8du+56WD7AQPdW41zK0tU2z4vn2M7Zj6k78k7L4Ll+SA+kxpl1m6RdVxmiqPIQmLLKR6jgz1aj4EEpz3hPfUN1di5wYlzt79vnx0SIshBQ60sZCkmq/a82MXm2yHZemSbpAJ3hHUoCQ0O0DOAsd3b4HnWxQrK2mR67hniGiqMcLiZaXHkm9mul+5ojvS98uWmr2zeLS8G5LXDChlDiD6yFDtBwPHgCMEVMtv29wjHT5w05LQ/j0vJ30LQfZvbp/751B9whzre91NwgyoTg+RIZU2frArzBxsp3g4gjvzWedOE+bPSY3KMDmLU60bvqnbl5Etaz223a6wnINggm0ocG6uStzfeAPzcDCT48T3YPGokU0hSiVIClE5JUMk+JPbXdFZeluBuIy7IWrklpBWT7hW8aU2T6xvjiFPw/NEU+s9MGF4+i36xPtwPGiUKa6FadPLsnpNK0F4vm/3ZpFstcm53Fi3W2D5VMkK3GWUIGVH9gHMk8AMk1bHZfo2JorTKLe1uOTHj1s19KcdY4RyH0UjgB3DPMmuNn2g7HoyKoQWzInOJw/NeALqx80fNTw9Udwzk8a2utOtW18lseA4i4h/iL/Ro8qa+b+3RGK1fZWdRaYuNkfVuomMKbCsZ3FfJV7jg+6qd3GFLt0+Rb57JYlRnC082fkqHP3HmD2gg1dmo/wBqmzOBrJPl8V1MC8to3Uv7uUPJHJLgHPwUOI8Rwph6qg7PYnhnPIZfOVKt7ku/o+vw6lX69tivF0sdxTcLROehSQko32yPSSTndIPAjgOBrKal0TqnTry03SzSUtJPCQwgusqHfvJ5e/B8K1zfRnBWnPdmt9NSR9OhUoYqneLUov4NG2XvaJrW8Q1Q52oH/J1jC0MIQzvDuJQASPDNaqOAwAAB3Vwg9YsNt+msnG6niT7hW3aZ2caxv60mNZ3YrCj/AJxNBZQB38fSV7gaj2YLoYm8Jl9N+7Tj5I1IAlQSASpRASAMkkngMVYnYTs8d0+wdR3xjcushvdYYUOMVo88/TVwz3Dh31ldm+yuzaUW3cJaxdLsnil9xGEMn+rR2H6RyfZyqQq061fUtMTwPEPE6xcHhsL7r3fXwXh9fqpSlap4oUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFQ70ltTiLZ4+lIzn4ecQ9Lx8lhJ4JP5Sh8EqqSdZ6jt2ldPyLxclnq2xhttPrvOH1UJHefqGSeANVJ1HeJ1/vsu83JQMqU5vKAPotpHBKE+AGB7s8ya2cNT1S1M9dwnlMsTiO0zXsQ28Zd3pv6GO7KVya2bZto2brW/pgtb7UBkhc6SB/Bo+ak/PVxA7uJ7K3pSUVdn0uviKeHpSq1XaK3JE6NOkit17WU1r0AFR7eCOfY459W4D+X31OtdFvhxrfBYgwmUMRo7aW2m0DAQkDAArvrl1JucrnxfNcxnmGKlXl37Lou7++oqlV7YEW93CLu46mW82OGMBKyMfVV1ap/tJjiLtB1AyAQBcHVDPYFHe/bWxhHzaPUcD1LVqsOqT9H+TX6UpW6fRxWS0raze9TWyzgZEyUhpf5GcrP6IUaxtST0cLZ5btEMxSSUW+Gt3PYFrIQn6iv4VWpLTFs0czxPZcJUrd6T9e75llkpCUhKQAkDAA7K1TXu0LTWiH4bF+fkIclpWpoMsKc4JIBJxy5j662yqq9Ku4eV7TGYQVlMG3tox3KWpSj9W7XJbPhy5slj9/rZ3/S7j+oufdT9/rZ5/TLj+oufdVTqVW5bSi1723XZu8goefnOJPyVW9ZH2V4zti2SKXvmMsqznJtJz9lVcwe40qdTLxlKPutothC24bM0K3GpUmMk8z5vWke04FbvpfV+mdToUqw3uHPUkZW22vDiR3lBwoD2iqMV3QZUqBNZnQJL0WWwrfafZWUrQe8H9nbS5Vq/Nsv7StH2Ka0XrfRLVwlhCblGcMaaEDCVOJAIWB2BSSDjsJI7Kxe3vaM7oayx4lqS2u9XHeDBWMpYbT6zpHackBIPAk54gEGTHYkWbNhwmutmy2IzfznnAgfE0hTIc5rroUpiS389lwLHxFUQvNyuF5nqnXedInylE5dfcKz7u4eAwK7NNXy7aauzd0sU1yJKbIOUnCHADndWnkpJxxBqLltJfKvI/a7a+cv26I6c5ytlKuPvFdGlbqm+6Ztl6Q2Wkz4jUgIPyd9IVj3ZrJVNxGUo7Ox540GFFOY0OOwcY/BthP2V6KUoRKTk7tilKUIFKUoBSlQltG29wrRNlWnTNtM6bHdUy5JlZQwhaTg4SPSXgg/NHcTQE0S5MeHGcky32o7Dad5brqwlKR3kngBWr6W2had1RqeVY9PvOz/ACRjrn5aE4YT6W6EhR4qJ48QMYHOqjau1dqPVsnrtQXV+YkK3kMZ3WW/yWx6I9vPxqa+iBb92BqK7qHFx9qMg+CElR/xB8Ki5Nie6UpUkClKUApSlAKUpQClKUApSlAKUpQClKUB1yn2osV2S8rdaaQVrV3JAyTUbI267OlJChcpmCM/5k591Z3bTcfNWyrUcsL3FmEtlBB+U5+DH1qFUsAwMDsqGyyVy2/7+ezr8Zy/1Jz7q3rTN7gaiscW9Wxbi4cpJU0pbZQVAEjODx7KoY4rdQpXcKvRs9tvmfQtithTuqjQGULH0ggb315omQ1YztKUqSBSlKAUpSgFYDW2rrJpC2+WXaSAteQxGRguvqHYlP2k8B2mstdGpj0B1q3ym4klacIfW11gbPfu5GT76iy57FRd7i5cLxrC5zpLnrurZQFkdw44AHYAAB3Vkgot+0zpZbRwc56sXU0xXck238rIhzXer7prO8+cLkpLbLeRFioVlDCT49qjgZV2+AAFa8spSneUoAdpJqw8TYPphtYMm63eQkc077aAfbhOfhW26e2c6MsTiXoVjYW+nGHpGXlgjkQVZwfZitvtNOKtFHu/5sy3CUlTw8W0tklZfP8AJAez7ZnqDVbzchxpy2WrmqW8jClj+rSfW/K5eJ5VZTS1gtWmbM1arRGDEdvicnKnFdqlHtUe/wDZWUpWrVrSqbnjM3z3E5nK0+UVsl+/VilKViOKKqltzbTG2qXpOQkOKacx35aR9xq1tfCmmlK3lNoUe8pFZaVT9N3Oxkmbfwuu6unVdWte3en49CkHWI+en406xHz0/GrvdQz/ADLf6Ip1DP8AMt/oitjtfgep/nlf7H/b8FIesb+en41PfRZhJFnvd1AyXpKI6VeCE732uVMfUM/zLf6Ir7QlKBhCQkdwGKx1MRrjaxzc24qeYYWWHVPTe3O99nfojmqT7Ybh502pajlg5SJymU+xoBv/AJDV0pshEWG/Kc9RltTivYBk1QWRJXNkvTXDlchxTyj4qJUftrVZ5GJ8VteyTTEfWOvIVhluPtxXEOuyFsqAWlCUEjBIIHpFI5dtapU09EiAl3WV4uixhMSAllJJ7XF5+xuqou9jef8Aw76K/GV//WW//wBdantP2EwbHpiZfdO3WY6YLSnno0zdVvtpGVbqkgYIGTgg58KsUXWgMlxAA+kKijpBbQrJa9Hz9OwpzMu73Jox+pZWF9Q2rgtayPV9EnAPEkjhgEizSKJsqtSldkVh+VJaixWHJEh5YbaabTlTiycBIHeTVTIWH6HzbotGo3jnqVSmUJ7t4IO99RTWE6XNmnt6jtWoerWu3uRfJFOAcGnErUoA928FcPyTUxbIdJDRGg4lqfKDMVvSZy08QXlcVAHtCQAkHuSKws3bFsrnxHYc27tyo7qSlxp2A6tCx3EFGCKt3GO/MqPWw6A0beNb31FqtTaktBQ8rl7v4OKg81E8t7GcJ5k+GSJiVL6NqpRkmKwFE5x1EsI/R9X6qkfZ/rjZ9c5TenNHvMpUltTqY8eCtlCUjG8r1QBxI9uaixa5uFqgxrZa4ttht9XGisoZZT81CQAB8BWD15rjTmioAk3yaEOOAlmM0N957HzU93icAdprGbY9oEXQWnkvpS3Iu0sluBGWThSh6y1Y47icjPeSBwzkVAvd0ud7uj90vE12bOfOXHnOZ7gBySkdiRgCpbKpXJW1b0gdUXFxbOnocazRskJccAffI7+I3E+zBx31H1y1zrS4OKXL1XeV55pTKUhP6KcD6q12sjabFfLuhS7RZrlcUJOFKjRVuJB7iQMZqpeyR2s6l1IysLZ1FeG1jkpM50EeA9LgPDlW2aY2y6+sbqN+6+doyfWYno38jwWMLz7SfZWiTokuBKXEnxJESQj1mX2yhY8Sk8a6aCxcjZXtPsWvGVMMpVAuzSN56C6oE4+chXy0+OAR2gZGd7qgtpuE20XWLdbZIVGnRHA6w6k+qod/ekjII7QSO2rpWPV8S7bNUaxbAaaMBcl1Gc9WpCTvp9ykqHuqyZRqx9T9e6OisySdUWVTzCV5aE5ve3k5ynGc5yMYqkbjrkh1ch4kuOrU4snnvKOT9ZrrSVL/AAjnFxZ3lk8yTxJ+NfdQ3cslYVZvo633Sun9mUZi46htEObJkvPvMvTG0LSSrdTkE5HopTVZK4IB7BRMlq5fKy3+x3tTqbPeIFxLIBdEaQlzcznGd0nGcH4VkqhXojW4R9F3a5lIBmXDcSe9LaEj/iUqsdt/2tvQZcjR+lpSmpLY3LhObPpNEji02exeCMqHq8hxziblLc7G87RdrmltHOuQVOLul1RzhxSCWz/WLPBHs4njyqE9RbedcXNxSbaYVlYzwDLQdcx4rXkfBIqKhkZPMk5J58e01l9L6bvmqLl5vsFtenSAApe7hKGweRUs4CR7efZmouWskZGTtE13Ic33dX3nP0JJbHwTgV327aftBgLCmNWXFeOx9SXh/fBra2+j7rtUfrFSrGhzGerMlwn2ZCMVH2r9LX7SVyFvv8BcR5Q3m1AhTbqe9CxwPZntGRkCnMnkTDobpCykPtxdY25t1gkAzoSSFI8VNnmO8pIP0TU/2q4QrrbmLjbZTUqJIQFtOtqylQ/7+FUF51L3Rk1o/ZNWo0vLeJtl3UQyhR4MycZBHcFgYI7909+SZVotNSlVg28bWZF/lydM6alKasrRLUqU0rBmqHApSR/Jdn0vyedmyqVySNoG3LTOnnnINnQb9PQd1XULCY7Z+k5xyfBIPiRUOX7bhtBuaz5PcI1qaPJEOOMj2qc3j8MVGwwBgAAdwFcEgczj21W5dJGzObQNcuLK16uvZJ7pi0j4JIFe+17VtoduWlTOqJbyR8iUlLwPt3gT9das/a7mxE8sets5qLgHrlx1hGO/eIxjxryVBJYTQfSFQ463E1nb0MJUd0z4aVFCfFbZyQPFJPsqeYUqNNhszIb7UiM+gONOtqCkLSRkEEcCCKoFU49FTWD8W9PaLlvKXDlIXIgpUr+CdHFaE9yVDKsd6SflGrJlWjdeldcfJdmzEFKsKn3BpsjvSgKcP1pTVWanjpf3DfumnbUF8GmXpK0+KilKT/dXUDnnUPcmOx79NW/ztqS1WvdKhMmssEAZ4KWAfqJq+YAAAAwByqkmyy52qya7t17vLi0Q7eXJBShsrW4sNqCEJHeVEcyB3kVndoe1zVWrH3GWZTlntZ4JiRXMKUP6xwYKj4DCfA86J2DVy11wv1jtznV3C9W6Iv5r8pCD9Zrttt0tlySV264w5iRzMd9LgH6JNUH3UhRUAM9+ONd0GTJgS0S4Ml6LJbO8h5hwtrSe8EYNTcjSX+pUYdHraBK1pp6TDu60ru9sUlDzoAHXtqB3HCBwCuCgccMjPDOBJ9SVFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKA0/bVcfNeyrUcoLKFKhLZQQflOfgx9aqpWBgACrTdLC4mLs2YgpVhU64NIIzzSgKcP1pTVWuXCqsvHYVxx4cSMdxrkVL2j9hV01Fpe3X1F+iRkzmEvpaWwolAVyBOePDj76gm9iIMdm8rH5RokBKd1ICR3DhU5r6ON53Tuamgb3YDHXg/XwqOdouz/AFFoSSwi8NsuxpBIYlx1FTa1DiUnIBSrHHBHHjgnBwsLo1q3txnpzDUyUYkZawHXw0XC0ntVuAgqx3A1aHYLpbZzEjG7aburV/uiBh2U8N12PkYwlo8WgePE8Tx4kVVeshpy+XTTd6j3qzPqZmxlbySD6Lic8ULHak8iP2gVKDReHVUnyLTF1mZx1EJ53PduoJ/ZVC2geqQDz3Rmrk7Qr6xcthV1v0XKWZ1mLiATxSHUAYPiN7FU4GMcOVGRE5qwnRGsiW4d71S+lIC1phsLPYlI33DnuJKR+bVe1K3UKUeIAJ4VauVDc0H0aJEZGGpaLUrrCOx98+l8FOfVRCRXzanqt7WWuJ95LhVFCixBT2IjpJCferis+KsdgrV64SkJACeQ4Cuagk3HY7o4a31xGtcgrFvZSZM4pOCWkkDcB7CpRA78FRHEVcuBDiW+EzCgxmo0ZlAQ000gJQhI5AAchUHdEC3IRZ9QXcp/CPSm4wP0UI3vtcPwqeKsiktyLek1p+Fc9msu7LZbE61KQ8w9j0gkrCVozzwQonHeAeyqnVbjpMT0wtkdxaKgFzHmY6Ae3LgUf7qVVUeoZaOwqwmweHN1PsM1HpiLLRGddlOx23VgqCEOIQVcB7V/Gq91afopQFxdmbsxYx5dcHXUeKUhLf2oNEJbEN7Vdl0nQFqhzZV6jzVS5HUtstsqSeCSoqyTyGAPfUeeypz6X1x6y/aftKV/wEZ2QtPcVqCUn+4qoMoyVseyx2927XuDamFBLs2S3HQojIBWoJBPgM1NB6ON27NTwv1ZX31o/R/t/nHa7Y0lOUxlOSVZ7AhtWP7xTVx6JFW7ES3VxexrYYITUpqRdQpbMZxKMBb7q1K3sHmEJJVjtCKqsSpSlLWtbi1EqUtZypRJyST2kniTU6dL66rcvlhsaVHcZjuS1pzwKlK3En3BK/jUF0ZMQEqWQhABWrgkE4GTy49lXD2afuG0VpOLZo2pbEp8JC5j4mtBT7xHpKPpd/ADsAA7Kp2opSklRAT255V8dYx85v8ASomS1cvZ+67Sn+s9k/X2v+qo16SNz0vedmbxi3m1TJ8SSy7GQzKbW5krCVYAOfUUrPs8Kq71jHzm/iKdYz89se8UuRpOyu+3THbdcolxZOHIkht9J8UKCv2V5eta/nUfpCuUFt9aWEOIK3VBCAFDJUTgfWagkth0j9Yuaf0CiDAdU1PvZLDakqwptnGXVjxwQnPYVg9lVQAAASkAADAA5CpU6T9wXJ2jMWwq9C2W5poJzwC15Woj2jc+AqLKlkJchw7asx0c9mkC32OLq+9xESLpNQHYaHUgpisniggfPUPS3uYBAGOOa6WG3+dr7b7X2TJbUc47AtYST8DV82Wm2WUMtJCG20hKUjkABgCiEmfS0pWkoWkKSoYIIyCKrBtT2OahGuJruj9PdZZ3wh5tLbraENLI9NCQpQIGRnHIb2Byq0FKs0VTsU4/ee2kf6sufrTP/XWybLtmWvrLtEsd1nWFyNFjSt553yhohKCkg8Aok8DVo6VFhqKjdJe4eXbWprIOUwYzEYce3dLh/wASo1rObQrh5117qC4ZyHri9unPApSopT9SRWDqpdHbEjSJktqJEYdkSXlBDTLSSpbijyAA4k1IStiO0VNtM3zTGKgne8mExHXfD1fdvZrfOiTphksXPV8loKeLnkUMkeokAKcUPEkhOfonvNWAqUirkfn862404tt1tbbiFFC0LSQpCgcEEHkQeyvmtl2qvMP7TdSuR0gN+cngMcASFYUfiDWtVBYmbojqcGvbqhJV1RtZK+7eDqN37VVZ2q/dD+3+jqO7kcCpmKj2gKWr/iTVgasiktxSlKkgUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgK6dMC4b9009aUrGG2XpK0/lFKUn+6qoHqSekvcPL9rk5oHKYMZiMPbu9Yf8So2qrLrY4UFFJSj1jwSO8nlV9dOwE2rT9utiAAmJFaYH5qQn9lUPjOrYktSGykOMuJcRvDI3kkEZHaMipE/fv2kE/8AxeGP/oW/uomGrlu6gvpcX2AnT9s00lxty4Oyky1Ng5U00lK0hR7t4qwO/Cu6oyl7aNo8lktG/tsA81MxGkq+JScVok+XKnzHZk6U/KlPK3nXnnCtaz3kniaNkKJ0VwogAk8hXNbTsu0hJ1rrKJZ2kL8kQQ9cHRybYB4jPerG6PaTyBqCzJo1qh21dFCBEfJS67ChNkH6TiFY+FVuq0HSweTG2b2+G0AhDtzaRujhhKW1nh4cBVX+JqWRHY2fZTYf3SbRLJalI32FSQ9I4ZHVt+mrPt3Qn84VZzpERnJOx++dXklpDbxHelLqSfqBPuqNeiLYutn3rUzqchlCYLB+kcLc+rq/ian+82+NdrRMtcxO9HlsLYdHelSSD9tStiG+ZQc8++lZLVNjn6Z1DNsNzQUyojhRkjg6nmlxP0VJwfiOYNY2qliyPREukVem7xZOsSJTMzyrq+1Ta0JTvDv9JBB7uHeKnKqDWq5XC0z2rhapr8GW0coeYXuqHeM9oPaDwNbJdtpmvrpCVCmapnFhY3VpaCGiodxUhIOPfUplXE3XpP61jX3UEXTdsfS9EtSlLkuIOUrkEY3Qe3cTkHxURzTUOUAAGAABQ8Bk1BZKx6LbCl3K4R7bAZU9LlupZYQPlLUcD3dp8AavLo2yMab0rbbFHO83Cjpa3seuoD0le85PvqJ+jpsvkWTd1dqSKWrm4gpgxXB6UVtQ4rUOxxQ4Y+SnhzJAm6rJFZMqF0kbgZ+1y5ICsohMsxk+5G+frWfhUc1s21dandpupXF53jc308e5KikfUBWs1UsiaeiPb+u1leLkriIkBLQ8C4vP2NmrNVSnZlr68aBuMuVa2IslqYhKJDD4ICt0ndUCOII3leHE8OWJq2K7UNT6714/BuDMCLb2IDjxZjNHJVvoCSVKJJ9Y8sc6smVkjSOlmy41tEgPqB6t62J3T4pcXkfWPjUP1abpQ6SfvujWb5BaU5LsylOOISMlcdQHWcO3dwlXsSe+qsA5G8DkHtqGTHYkjo2phObV4bE9pp1LsV9LSHEgguboPI/RC6td5ntP4rg/q6fuqiVtmy7bcY9xt8hcaXFcDrDqeaFA8D4+w8COBqddP9I11ERDd+011r6U4U9DfCUrPfuKHo/pGiYaZPHme0fiuD+rp+6sdLe0ZDkrjS3bBHfRjfadUylScjIyDxHCoN1V0iLnLhuRtOWRu3OLTgSpLodUjxSgAJz7SR4VCE112bLdlzXFSZLyyt1507y1qPMknmam5CiXc8v0J/TNN/71n769FuVpKfJLNuVY5T7YDhQwWlqSAeCsDiOOONUahwXJktmHDhqkSX1htplpveWtR5ADtNW+2GbO2tB6bUZaGl3ufhya4jBCAPVaSe1Kcnj2kk8sAE7hqxAPSMYcZ2xXlSwcOoYcQT2jqkj7Qaj2rC9LLSTzrcHWcNsqRHR5JPwPVQVZbX7ApRSfyk91V68cVDLLYymj7i1aNXWa7P8A8DDnsPunGcISsFR+GavYy628yh5lxLjbiQpC0nIUDxBB7RX5/wBbZpnaPrbTcFMCz399qGjIbYdbQ8lsdyd8EpHgOFE7ENXLh6qv1t0zYJd6ur4ZixmypXHis9iEjtUTwA7SaqlJ21bSHpLzzV8TGaccUttlMRlQaSTkIyUZOBwyeeK1bVGqtRanfQ9f7vJnlvi2lZw2g96UJwkHxxmsNRsKJvw2zbSv9Zf/ALJj/oqW9i+rdY3PRepdX6ouqpUCGytMNHk7beVNoKnFgpSMjO6n2hXdUD7PtH3bW2om7Ra0biOCpUpScojN9qj3n5qe0+GSLJ7YY0DR2wWfZrU31EZEduCynPEha0pUSe0kFRJ7STRB2KlIKlJClHKiMn21z7TSuFBahutp3lq4JGM5J5VBYuP0frd5t2R2JCk4XIaVKV/7i1LH1EVvEt9EaI9JdOENIUtR8AMmvNp6Ai12C32xsYREitsJHglIT+ysBtkuRtOy3UUxK9xfkK2kH6TnoD61CrmLdlL5spc6Y/NdOXJLq3lHxUoqP2101wBgADkBRSglJWrkkZNUMpbDot2/yPZW1KI9KfNffPsCurH+HUqVrWyy2m0bN9PW9Ywtq3tFwfTUkKV9ZNbLV0YmKUpQClKUApSlAKUpQClKUApSlAKUpQClKUBRjaDcPOuvL/cd7eD9weKD2boWUp+pIrB1fXzPaPxVB/V0fdTzPaPxVB/V0fdUWLaihVKvr5ntH4qg/q6Pup5ntH4qg/q6PupYaihOQOZFe6BaLtcCE2+03CWTyDEZa8/AVetm121le+zbojasY3kspB+yvWOHKlhqKiaN2La3v8htU2F5jhHit+YPTx9FoHeJ9u6PGrM6A0bZdFWQWyzsq9I778hzBdfX85R+oDkByrYqVKRDdyGOljarpO0fbZsGO4/GgS1OSwhJUUJKCAsgdgPM9mfhW60wLjeJ7cC1QX58tw4QywjeUf2AeJwB21fiuqPFjRysx47LO+cq3EBO8e8451DQUrGr7ItKr0boKBZZBbVMG89LUg5SXVneUAe0DgkHuSK22lKkg0jars3s2vYCfKSYd0YSUxpzacqSOe6ofLRns7OwjJzWnV+yvW+mXl+UWZ2fFTylQEl5BHeQBvJ9495q5tKholOx+fq0qbc6txKkL+aoYPwNctIW64Gmm1uuE43EJKj8BV+pMOJKGJMVh8f1jYV9tcxosWMndjRmWQOxtAT9lLE6inGltlWu9Qup8msT0KOeci4ZYQB34I3le5Jqftl+xuw6Qeauk9zzxeUcUPuI3WmD/VoycH6RJPdipPpSxDdxSlKkgrJ0htmt6j6sl6ps0B+fbZ+HZCY6Ctcd3ACiUjjuqxvbw5EqzjhmF1ApUUKBSoc0qGCPca/QOvPJhQpP+cxI73HP4RsK+2osWUigrYK17jaFOKzjdQCT8BU8dE+yXWHqS83Gda50VhcJDbTr8dTaVkryQkqAz6o5eHfVhY8aNHSEsR2mgBgBCAnHwrtpYOVweIwagPalsFEqU9dtDqYjqcJW7bHVbjeTxJaVyTk/JPDuIHCp8pUlU7FFL9pfUlhcUi82G4wt3hvOMEo9yxlJ9xrDA55dnOv0EryPWy2vKCnrfEcUOAKmUk/ZUWLaihkSNJmPBmFFkSnFckMtFZPuFb5pLY7rvUDiFLtZtEVXrP3DLZA8G/XJ9oA8at+0220ndbbQgdyRivulhqND2YbLtPaFR5SwDPuy07rk55I3gO1LaeSE+zJPaTwrfKUqSp1S47EuK7FlMtvx3kFt1pxIUlaSMEEHgQR2VXTaRsCnxZDk/RC0yohyrzc85h1rwbWrgoeCiCO9VWQpSwTsULvFkvVmdLV3tFwgLBxh+OpA9xIwR4jhWPBG7vZGO+v0DUlKklKkhQPMEV5RbLaHuuFviB3Od/qU73xxUWLaiitps14u7gbtVpnz1k4xHjrcx7cDhUpaI2CamurqH9SOoskLOVNBSXZKx3ADKU+0kkd1WiSlKUhKQAByAFc0sNRhtIaYsmk7Oi1WKEiNHSd5Zzlbqu1S1HipR7z7Bw4VFXS8uSWNI2e19YEqlzy6pOeaW0H6t5aam6vNMgQZpQZkKNJKM7pdaSvdzzxkcKkqmUD6xB+Wn41n9nEJF22g6ft2QoPXFkqHP0UqC1fUk1dbzHZPxPb/ANWR91fce0WmO8l9i2QmnUHKVoYSlSezgQOFRYtqPbUR9K65CHs0ahb4SqfcGmiCeaU5cP1oHxqXK882DCmhAmQ48kIOUB1sL3T3jPKpKooD1rZ/lEfGvVaI3nO8QbY2pJXMlNRwM/PWE/tq9nmOyfie3/qyPurluy2dp1DrdpgIcQQpKkx0ApI5EHHA1Fi2o9rSEtNJbQMJQAlI7gK+qUqSopSlAKUpQClKUApSlAKUpQClKUApSlAKUpQGj7Rtpdl0bMj2tUaZdbzJAUzb4SN5wg5wVdwODgcSccq1V3bZNtgEjU2zjUdogEgeUqQVBOeAzvJSPrrA6bvln030j9Xv6veRCkSglECVJ4NoQQnA3jwSFJCQDy9EjPfOiXLZe7Y4hDkS4wZCChe4pLjbiSMEHGQQRUEnVpy92zUVmj3izy0SoUhOUOJyPAgg8QQeBB4g1ka0fZBoR7QFsuNs86CdFkyzIYT1ZSWgUhODknPBKe7jnvrGar2kXYaxkaP0PplV/usNAVNdcfDTEfIBAJPM4I7Rx4DJyBJBJdeG+3e2WK2O3O8TmYMJnHWPPK3UpyQBk+0gVGQ2oap05eoELaJo1Fphz3gy1Phyg80hR4DeHH2niCACcHBrr6UNwvLWhJduYsfXWd9tpUq5+UpHkyg8ndT1fNWcAZHLNLixKEi7Q0afcvjC/KoaYploU0QesbCN8FPYcjlWN2farh6z023fIMaTGZW4tsNvhO+Ck4PIkVq+y2/6iGzdT950sLdFtloZXAdMxDnl6Esk72AMt8Ep4HPreFZjZvrONqPQJ1RMiM2mO2Xi8kObyG0tk5VnA7BnlQG40qIYO0baHqhhV00RoBiRZitSWJE+alpb+DgkJyMceHaM9vPGf2c7RV6mm3Sw3Syu2fUtrRvvwHHAoOJ7FIV3ZKfcpJBIOaXFj52ibUYWlL61p+HY7nfru4z1/k0JGSlPHGeZycE4AOBxOOFb7FdL0Zp4tqbLiAooVzTkZwfGq3xtQa0G3uZdm9CFV+NoCFWnzk2N1vAw51vqnPD0efwqYNpGvmNF2i3OPWx+dd7m4lmHbmVDeccOMje7gSBkAkkgAceEXJsbpSojuGudrNmgru932bQzbWUlx9Me5JU62gcyQM8hxOAeVSFozUlu1XpeHqG3FaYslBVuuYCm1AkKSrsyCCO7t5VJBmqVETu1HU+pLzMhbNNJN3mHCX1b1xlyA0ytX0MkZHdxyQc4AwTlNBbSp1z1U/o7Vmn1WLUKGS8y2Hd9qQkDPoq78ZPAkEJVx4EUuLG7HUFlGoxpw3KP53LPXiJvfhOr+djurEaz1xb9L3/T9mmQ5b718k+TsLZCd1tW8hOV5IOPTHLPI1CrmoNa/v8Aqbr+4X/LwtJbFo85N8WuP4TrsbvuqV9b65d07ftH2uRZG3nr9IDKyp7Biqy2Dj0TvYK/DlUXJsb7StU2ma5tuhrO1LlsuzJkpzqYUJn+EkOdw7hxGTg8wMEkA6ZI1ztdgQzeLhs0im2IT1jjLE4KkoRzzujJzjs3eFSQS9SsFoTVVp1lpxi+WdxSmHCUrbWMLZcHrIUO8ZHLgQQRkEVHFk20XG/xHINi0c7cNReUOJTCak5aaYTgB511SQE5VkBPbjnS4JkpUSWTanqGDrW36X1/pNNjduatyHJZkdY2VE4APMHJIHA5BUnIwc1LdAdM6VGgwn5sx5DEaO2p11xZwlCEjJJPcAK6LHdrbfLW1c7RNZmwns9W+yreSrBIOD7QR7q1Lbfcb5B0JcG7RYfOjMmJIbmu+Upa8ka6o5dweK8cfRHGtX6Mdyv69G261PadDVjZYeVHu3laT16+uPodVjeTjKuJ4ej40BMVKiu8bTr3dNUTdObOdMC/PW5W5NmvvdVGbWDgpB4Z4gjmM7pwCBmubHtPvFv1RD01tF0z+5+XPO7ClsvB2M6rOAknPA5IHM8VDOMg0uLEp15rrMbt1rl3B1C1txmVvKSnmQlJJAz28K9NYnWf/o+9f2e//hqoCMom3+yy2A/G0lqh5s8N5uMhQz3ZC69lt286QduLcK7QbzYy56rs6MAj2ndJIHjjHfToqfxSR/8AbHvtFb9rLTdq1XYJFnu8ZDrLqCEL3RvsrxwWg/JUOYNRzJMsw60+w2+w6h1pxIWhaFBSVJIyCCOYI7a+6hrotXad5lvekLi4XHrBM6psk8kKKgUjwC0Lx3AgdlZvV20yc3qp7SOiNOO6jvMdOZautDceN4KWeGe/iBnhknIE3IsSVSopt21G92e/QbNtH0mrT5nuBuNOYfD0YrJwEqI5ccccnGQSAONbJtc1svQmn4l1Rb253Xzm4qkLfLQQFBRK8hKs43eWKA3KlRPK2ja4vCXLhoXQC7lZUEhubMkBkygOam2yQSnng9vgeFZvZptFGt9M3OXGtDke820qbfty3cbzm6SgBRAwFEEcQCCFA8slcG1Q9QWWXfpdhjXOM7dIaAuTFSvLjSTjBI7vSHxFYm9a2t9q19Z9HPQ5bku6tKdaeQE9UgJ3uCsnPyTyBqFdI3/WjW3DUtxj6HD94kRmkzLZ5xbT5IjDQ3utI3V8ADgd9S7qPWnmvalp/SHmpt/zoytzysu4UzuhfAJxx9XvHOouTY3alaJtH2gO6dvEDTViszt91HcEFxmIhYQhtsZG+tR5DIP6JJIxx1q47StfaUDVw11oJqLZlOJQ7Lt8sPFjJ5qSCeHtxk8Ac4Bm5BKd7utuslreul2mMwoTABdfdVhKMkAZPtIFd0CXGnwWJ0N9D8aQ2lxp1BylaVDIIPcRUTdJC83N/Zu+1a7OifYZ8Vt5+6olJCWB1iCjCOawrhxHLNZrY1fbydBR16hsKLNa7fa46os4y0uiU0GzlwpAy3hKQcHv8KE25EjUqIYO0faDqlldz0PoFiTZd9SGZM+Ylpb+DjISSMD48cjOcgbDsz2hq1Pdbjpy9Wd2x6jtoCpENxYWFIOPTQe0cR7lJIJBpcixvtKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgNImW/Z3tQbkB2PEvC7e4Y7jyUrbdYVz3QvgrGc8jitNuWwC3RFLlaO1Nd7JLA/B5dKkDwyndWB45PvrpuFh1ps02gXTUekbMrUGn7y510u3tKw6y4VEkgcTzUoggHgoggYBrLzNqGsX43VWfZPqMTV+ikzWy20hXeTjiPePaKgk+tgOq9Q3Ny+aV1W75RdLG/wBV5QeKnE7ykkKOBvYUngrAyFDPHJPlXrqFH1terfs30G5frqXcXaa04lhouJJHFZB3sHeHHGSDjPOsxsR0TeNNt3e/anfbcv18kdfJQ2cpZGVK3c8s5WonHDkBnGTqGjBq3ZXqPUFrd0bdb/arhMVLjTbc3vqOScBQHgQDnGCDzBFAYPb1O2gXDTdsXqqy2qzwPOKerYYkl55bm4rBUR6ISBvcuOcVJnST/iZvX/sf4yK0Xa5A2j6+023dhpl22QLc+lyNaFKDkyUo+iXVAeqEg8EcTxUe6t82hRbvr7YpPbiWWbbrlKaDiLfM3UPAtug7p44BUE8OPaM4oDIWr+I2L/8ALSf/AMatV2DWpm+bB37LIWttmcZUda0eskLykkePGsjs/uGo7rsxuFhumkbhaJNvtIhsF/gJiupUnKAQCPVHP53OvNst0pfBsPlabmeWWG5vmQGnN8ocZUTlC8pOQM45HlQGC06ztg2aW8WViwQdV2SOpRjrju7jyEkk4AzvYyScbqsZwCRitn2ca90zqrWEiPI005YdXIj7rqZcdIeW2MEoDmAo44HdUBwwQDg4xWjdb6203ZWbDqvZ/qa4zYKepE6C2ZKZAHAKUrPE45nJzz4HIHZoi06l1VtbO0S/WF3T0KFCMSDEfI690neBUscwAFK5gc0gZwTQHVB/0s7h/YKP+Ws5ta1RpnT98sgk6ec1BqcqUq1RWEZdbycFWfkgkY5EnHLgSPLEsV5R0lJuoFW18WpdmSymXgdWV8PR55zwrwbVrLqS0bUbJtGsFlcvzUZgxZUNni6kHfG8kc+IcPEA4I48DQHbeb/tcutinpToq1WGMqK71j8y4B5aE7hyQhA9bHLIxnGawegpL0Don3SRFUptxEWaEqB4pypQz7ga2K66g11riBI0/YtHz9NsymlNSbpdxudUgpIIbbHpKUeWezOa8mwu3XJWgbhoHU+lrnbW2m3W3X30gNPpdUsFLZ7SB2jhxBB40Bn+jrCjwtj1i8nSAX21vuEDiVqcVnPiOA91bPc9L2G46lt2o5kBLl2tyVJiSA4pJQFAgjAIChxPMHGTUUaIl672Wx39Jz9H3PU1pZeWu3z7YAolCjkhSeziScHGCSBvDBrI6QsmrNY7UGNfastK7FAtbCmrVbnHMulSgQVrHZ6ys5Ayd3hhOSB8L/0tEf2APtVXXt7/AIzdmP8Aap/xGa42hxdU6c21xdc2nS0zUMFy2eSqaiH00qG9kHgcc0kHGDx4179rVlv181ps5ucCzSXGYc4PTt3B8mBW0TvcezCuXdQHg1clNy6UuloU0pVHhW5UhhtQ4FzDp3h45Sk/mVNFRdtp0hf5d6smutHIQ7fbKohUZRA8pZOcp44yRlQxkZC1YOQK6Jm0zWkm1Fi1bLNRNXd1O4jylvdjtLPyisgZA8ceOKAxvRtAj6n2hW6KN23sXb8ChPqoO+6CB+alI9gFdnRRjso03qGUltIedu60LXjiUpSndHsBUo+81tmxPRUjRWkVR7k+mRd5z6pc9xKt4dYrHog9uAOJ7SSe2sT0crFebBpm7x71bX4Dz11cdbQ7jKkFKQFDB5cDQGN6SKU+c9CO7o30XpO6rHEcUHHs4D4VMVRft4sd5vMzSKrTbX5qYl1S7ILQB6pHo+kcnlwqUKkg17aX/F1qT+ypP+EqtJ2JyHofRzjS2M9cxCmON457yVukfZUh6utzt30pd7UwpKXpkJ5hsq5BS0FIz4ZNRtsAd1HC0+jQ2otG3C3Mw2Hiqc8fwTu84T1Y7z6auIJGE57aA9HRXhx42ySLJaAL0uU86+vtUoK3AT+alNeTpassq2XtSiAJMe4tKjrHrBRCgce7J91Y7SLWsdkc+dp9vS9x1Lpl+Qp+DIgDfdZzjKVJHLsyOHEEjOcD7vUHVm1vU9ojXPTE3TukrZIEmQmfhL0tYHBO5zwRlPcApRJzgVHcSTLa3HHbZFde/hVsoUv2lIzXi1n/AOj71/Z7/wDhqrLAADA4Csbqph6Tpe6xo7anXnYTyG0J5qUUEAD2mpII66Kn8Ukf/bHvtFSsohKSpRAAGST2VXrZdctpuiNJNWJnZlMmpS6t3rVyEtn0scMceVZe/wA/bNriC5YI2lI+l4coFuVLfkgq6s8CkYOQCOBwkk94qLks6+jUozb3r7U0cb0SXcD1Cvnem659jiD761zYDe9aRbJd7hYNFNX9c+4qdlzVXFDCusKQrcIVxIBUVZ+manXZ3pSBovScSwQFFxLIKnninBedVxUsjsyeQ7AAOyoytVu1bsm1Zd02nTkvUek7s+ZLSIR3n4jhzlO52jHDuICeIIIIHm2qM7Ttd6UXY5GzRmIsPIeZkC7suFtSc5wOHMEp58ia7+k2iV+87YG7gkplmfFTIGQcL6lwK4jhzzXqvk3aDtJuUGzW6yXvRdiafS7PnvuliS6kfIQEkEZ48s8cE4Awcp0kdP3i/aEt8CxW6RcH2rmy4ptrBUEBCwVHJ8R8aAkyEw1FhMRmG0tsstpbbQkYCUgYAA9lRFsUSlvbDtObbSEo8tbOByyVOk/WTUxJ4JHsqL9lVivNt2p7QLjcLa/Ghz5Ta4jywN14AryU8fEfGpIMboL/AEnNdf7Ez/wsVxtB/wBJfQn+xvfY7XmubOrNHbdLzqWDpGdfrdeY7TSFxD/BkBsHeODjBQeBxwIOeys3raw3mZt80de4ttfdtsSM6mRJSBuNEhzAPHxHxqCT52oaH1U9riBr7Q8yKLtFj+TuxZRwh1AJ4A8uIUQQSOQIIIrDXTahfbbCXB2nbMZLdtdIQ++wA/HVx7Uqyk8ccCvNZnXzWt9M7Ro+sbBFuOoLNIjeTTrS0+o9UoYw423kjJwOIB5Kz62Rj9cav1Xq3TUvTNh2a6gZfubRjOSLmwGWWUq4FWTzOM4PDHPjyIGR20yrVN6O9xl2LqfNjsSMuIGkbqA31re6Anhu4HDHZyrYdJ2tm+bGLVZ5K1oZnWJqO4pHrJC2QCR48awup9CT2+j+7oe2LEyezBbSk5wHnErS4oDPLJBAz3jNefQCtS6j2Yy9I3Cx3XSsuHbW4UaetakFxYQUhaMYUMFKSePbjNAa/pyPtg2Z25Nlj2KDquyR1KLC47m48lJJOAM5HEk43VYJwCRitm2ca901qrWL0eXplyw6uRHKVplxwHltjGUBzAVw4HdUBw4gHBxitG621xpqytWDVugdTXObBT1InwWzJTJA5KUrtOOZyc8yAciuzRdo1Jqza6Nod9sDunoMCEYkGLIV+HeUd4byh2ABa+YHycZwTQEv0pSpIFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgFKUoBSlKAUpSgP//Z"

def _fmt(n):
    try:
        v = float(n)
        return f"{v:,.2f}" if v != int(v) else f"{int(v):,}"
    except: return "-"

def _sf(c, col): c.setFillColorRGB(*col)
def _ss(c, col): c.setStrokeColorRGB(*col)
def _hl(c, x1, x2, y, col=(0.75,0.75,0.75), w=0.4):
    _ss(c, col); c.setLineWidth(w); c.line(x1, y, x2, y)

def generate_br_pdf(br: dict, items: list, customer: dict) -> bytes:
    _ensure_fonts()
    PINK  = (0.831, 0.208, 0.475)
    BLACK = (0.12,  0.12,  0.12)
    GRAY  = (0.75,  0.75,  0.75)
    LGRAY = (0.93,  0.93,  0.93)
    WHITE = (1.0,   1.0,   1.0)

    buf = io.BytesIO()
    W, H = A4
    ML = 14*mm; MR = 14*mm; MT = 12*mm
    CW = W - ML - MR
    c  = rl_canvas.Canvas(buf, pagesize=A4)
    y  = H - MT

    # Write logo to temp file
    logo_data = base64.b64decode(LOGO_B64)
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.write(logo_data); tmp.close()

    # ── Header ──────────────────────────────────────────────
    HDR_H  = 28*mm
    LOGO_W = CW * 0.40
    _sf(c, WHITE); c.rect(ML, y - HDR_H, CW, HDR_H, fill=1, stroke=0)
    c.drawImage(tmp.name, ML, y - HDR_H + 2*mm,
                width=LOGO_W, height=HDR_H - 4*mm,
                preserveAspectRatio=True, anchor='w', mask='auto')
    _sf(c, BLACK)
    c.setFont("THB", 10)
    c.drawString(ML + LOGO_W + 4*mm, y - 7*mm, "Neobiotech (Thailand) Co.,Ltd.")
    c.setFont("TH", 7.5)
    c.drawString(ML + LOGO_W + 4*mm, y - 12*mm, "เลขที่ 16 อาคารคอมโพแม็ก ห้องเลขที่ 201,401 ชั้น 2,4")
    c.drawString(ML + LOGO_W + 4*mm, y - 16*mm, "ซ.เอกมัย 4 ถ.สุขุมวิท 63 แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพฯ 10110")
    c.setFont("THB", 7.5)
    c.drawString(ML + LOGO_W + 4*mm, y - 20.5*mm, "TAX ID No. 0105559043311")
    c.setFont("TH", 7.5)
    c.drawString(ML + LOGO_W + 4*mm, y - 25*mm, "Tel. 02-020-1536     Fax. 02-020-8448")
    _hl(c, ML, ML+CW, y - HDR_H, GRAY, 0.5)
    y -= HDR_H + 1*mm

    # ── Title ────────────────────────────────────────────────
    TITLE_H = 11*mm
    _sf(c, LGRAY); c.rect(ML, y - TITLE_H, CW, TITLE_H, fill=1, stroke=0)
    _sf(c, BLACK)
    c.setFont("THB", 12); c.drawCentredString(ML+CW/2, y - 4.5*mm, "Borrowing Form")
    c.setFont("TH",  9);  c.drawCentredString(ML+CW/2, y - 8.5*mm, "ใบยืมสินค้า")
    _hl(c, ML, ML+CW, y - TITLE_H, GRAY, 0.5)
    y -= TITLE_H

    # ── Info rows ────────────────────────────────────────────
    ROW_H = 7.5*mm
    DIV_X = ML + CW * 0.55

    def info_row(lbl_l, val_l, lbl_r, val_r, ry):
        _sf(c, WHITE); c.rect(ML, ry - ROW_H, CW, ROW_H, fill=1, stroke=0)
        _hl(c, ML, ML+CW, ry - ROW_H, LGRAY, 0.3)
        _sf(c, (0.4,0.4,0.4)); c.setFont("THB", 8)
        c.drawString(ML + 2*mm, ry - ROW_H + 2.5*mm, lbl_l)
        _sf(c, BLACK); c.setFont("TH", 8)
        c.drawString(ML + CW*0.17 + 2*mm, ry - ROW_H + 2.5*mm, val_l)
        _sf(c, (0.4,0.4,0.4)); c.setFont("THB", 8)
        c.drawString(DIV_X + 2*mm, ry - ROW_H + 2.5*mm, lbl_r)
        _sf(c, BLACK); c.setFont("TH", 8)
        c.drawRightString(ML + CW - 2*mm, ry - ROW_H + 2.5*mm, val_r)

    info_row("Customer Code", str(customer.get("cust_code","")),
             "NO.", br.get("borrow_no",""), y); y -= ROW_H
    info_row("Customer Name", customer.get("customer_name",""),
             "DATE", br.get("borrow_date",""), y); y -= ROW_H

    _sf(c, WHITE); c.rect(ML, y - ROW_H, CW, ROW_H, fill=1, stroke=0)
    _hl(c, ML, ML+CW, y - ROW_H, LGRAY, 0.3)
    _sf(c, (0.4,0.4,0.4)); c.setFont("THB", 8)
    c.drawString(DIV_X + 2*mm, y - ROW_H + 2.5*mm, "Sale Representative Name")
    _sf(c, BLACK); c.setFont("TH", 8)
    c.drawRightString(ML + CW - 2*mm, y - ROW_H + 2.5*mm, customer.get("sale",""))
    y -= ROW_H + 2*mm

    # ── Table ────────────────────────────────────────────────
    colW = [9*mm, 21*mm, 0, 13*mm, 12*mm, 23*mm, 27*mm]
    colW[2] = CW - sum(w for w in colW if w > 0)
    colX = [ML]
    for w in colW: colX.append(colX[-1] + w)

    TH_H = 13*mm
    _sf(c, LGRAY); c.rect(ML, y - TH_H, CW, TH_H, fill=1, stroke=0)
    _sf(c, BLACK)
    hdrs = [("No.","ลำดับ","C",0),("Code","รหัส","C",1),
            ("Description","รายการ","L",2),("Quantity","จำนวน","C",3),
            ("Unit","หน่วย","C",4),("Unit Price","ราคาต่อหน่วย","C",5),
            ("Amount (Baht)","จำนวนเงิน (บาท)","C",6)]
    for en, th, align, i in hdrs:
        mid = (colX[i]+colX[i+1])/2
        c.setFont("THB", 7.5)
        if align=="C": c.drawCentredString(mid, y-5*mm, en)
        else: c.drawString(colX[i]+1.5*mm, y-5*mm, en)
        c.setFont("TH", 7)
        if align=="C": c.drawCentredString(mid, y-9*mm, th)
        else: c.drawString(colX[i]+1.5*mm, y-9*mm, th)
    y -= TH_H

    R_H = 7.5*mm; grand = 0; n_rows = max(10, len(items))
    for i in range(n_rows):
        bg = (0.975,0.975,0.975) if i%2==0 else WHITE
        _sf(c, bg); c.rect(ML, y-R_H, CW, R_H, fill=1, stroke=0)
        _hl(c, ML, ML+CW, y-R_H, LGRAY, 0.25)
        if i < len(items):
            item = items[i]; grand += float(item.get("total_price",0) or 0)
            _sf(c, BLACK); c.setFont("TH", 8)
            mid = lambda a,b: (colX[a]+colX[b])/2
            c.drawCentredString(mid(0,1), y-R_H+2.5*mm, str(i+1))
            c.drawString(colX[1]+1.5*mm, y-R_H+2.5*mm, str(item.get("product_code","")))
            c.drawString(colX[2]+1.5*mm, y-R_H+2.5*mm, str(item.get("product_name","")))
            c.drawCentredString(mid(3,4), y-R_H+2.5*mm, str(item.get("quantity","")))
            c.drawCentredString(mid(4,5), y-R_H+2.5*mm, "EA")
            c.drawRightString(colX[6]-2*mm, y-R_H+2.5*mm, _fmt(item.get("price",0)))
            c.drawRightString(colX[7]-2*mm, y-R_H+2.5*mm, _fmt(item.get("total_price",0)))
        y -= R_H
    _hl(c, ML, ML+CW, y, GRAY, 0.5); y -= 3*mm

    # ── Totals ───────────────────────────────────────────────
    net = grand / 1.07; vat = grand - net
    T_H = 7*mm; LBL_TW = 74*mm; VAL_TW = 28*mm
    TX  = ML + CW - LBL_TW - VAL_TW
    for label, val, is_grand in [
        ("Total (รวมเงิน)", grand, False),
        ("Discount (ส่วนลด)", None, False),
        ("Net Total (มูลค่าก่อนภาษีมูลค่าเพิ่ม)", net, False),
        ("Vat 7% (ภาษีมูลค่าเพิ่ม)", vat, False),
        ("Grand Total (รวมเงินทั้งสิ้น)", grand, True),
    ]:
        if is_grand:
            _sf(c, LGRAY); c.rect(TX, y-T_H, LBL_TW+VAL_TW, T_H, fill=1, stroke=0)
            _sf(c, BLACK); c.setFont("THB", 8.5)
        else:
            _hl(c, TX, TX+LBL_TW+VAL_TW, y-T_H, LGRAY, 0.3)
            _sf(c, BLACK); c.setFont("THB", 8)
        c.drawRightString(TX+LBL_TW-2*mm, y-T_H+2.5*mm, label)
        c.setFont("THB" if is_grand else "TH", 8.5 if is_grand else 8)
        c.drawRightString(TX+LBL_TW+VAL_TW-2*mm, y-T_H+2.5*mm,
                          _fmt(val) if val is not None else "-")
        y -= T_H
    y -= 5*mm

    # ── Remark ───────────────────────────────────────────────
    remark = br.get("remark","")
    if remark:
        REM_H = 13*mm
        _sf(c, PINK); c.rect(ML, y-REM_H, 2.5, REM_H, fill=1, stroke=0)
        _sf(c, (1.0,0.96,0.97)); c.rect(ML+2.5, y-REM_H, CW-2.5, REM_H, fill=1, stroke=0)
        _sf(c, PINK); c.setFont("THB", 7.5)
        c.drawString(ML+4*mm, y-4*mm, "REMARK :")
        _sf(c, BLACK); c.setFont("TH", 8)
        c.drawString(ML+4*mm, y-9*mm, remark[:110])
        if len(remark) > 110:
            c.drawString(ML+4*mm, y-13*mm, remark[110:210])
        y -= REM_H + 5*mm

    # ── Signatures ───────────────────────────────────────────
    y -= 4*mm; SIG_H = 22*mm; SIG_W = CW/3
    for i, lbl in enumerate(["Sale Representative","Authorized By","Customer"]):
        sx = ML + SIG_W*i
        _hl(c, sx+4*mm, sx+SIG_W-4*mm, y-7*mm, GRAY, 0.4)
        _sf(c, (0.5,0.5,0.5)); c.setFont("TH", 7.5)
        c.drawString(sx+3*mm, y-7*mm+1*mm, "(")
        c.drawRightString(sx+SIG_W-3*mm, y-7*mm+1*mm, ")")
        _sf(c, BLACK); c.setFont("TH", 8)
        c.drawCentredString(sx+SIG_W/2, y-SIG_H+3*mm, lbl)

    c.save()
    _os.unlink(tmp.name)
    buf.seek(0)
    return buf.read()


@app.get("/brs/{borrow_no}/pdf")
def export_br_pdf(borrow_no: str, db: Session = Depends(get_db)):
    """Generate PDF for a single BR"""
    br_row = db.execute(text("""
        SELECT b.borrow_no, b.borrow_date, b.days_borrowed, b.borrow_alert,
               b.status, b.remark, b.cust_code
        FROM borrows b WHERE b.borrow_no = :bno AND b.sheet_status = 'active'
    """), {"bno": borrow_no}).fetchone()
    if not br_row:
        from fastapi import HTTPException
        raise HTTPException(404, f"BR {borrow_no} not found")

    cust_row = db.execute(text("""
        SELECT cust_code, customer_name, sale FROM customers WHERE cust_code = :cc
    """), {"cc": br_row.cust_code}).fetchone()

    items = db.execute(text("""
        SELECT product_code, product_name, price, quantity, total_price
        FROM borrow_items WHERE borrow_no = :bno ORDER BY id
    """), {"bno": borrow_no}).fetchall()

    br = dict(br_row._mapping)
    customer = dict(cust_row._mapping) if cust_row else {"cust_code": br_row.cust_code, "customer_name": "", "sale": ""}
    items_list = [dict(r._mapping) for r in items]

    pdf_bytes = generate_br_pdf(br, items_list, customer)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{borrow_no}.pdf"'}
    )