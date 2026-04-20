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
            sheet_status TEXT DEFAULT 'active',
            first_seen_at TIMESTAMPTZ DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ DEFAULT NOW(), closed_at TIMESTAMPTZ
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS borrow_items (
            id SERIAL PRIMARY KEY, borrow_no TEXT, product_code TEXT,
            product_name TEXT, price NUMERIC(14,2), quantity INTEGER,
            total_price NUMERIC(14,2), updated_at TIMESTAMPTZ DEFAULT NOW()
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
    db.commit()

def calc_status(days: int) -> str:
    if days > 180: return "BLOCK"
    if days > 90:  return "WARNING"
    return "NORMAL"

def recalc_all_customers(db):
    """Recalculate status/max_days/active_br_count จาก borrows ทั้งหมดใน DB"""
    db.execute(text("""
        UPDATE customers c SET
            max_days        = COALESCE(sub.max_days, 0),
            active_br_count = COALESCE(sub.cnt, 0),
            status = CASE
                WHEN COALESCE(sub.max_days, 0) > 180 THEN 'BLOCK'
                WHEN COALESCE(sub.max_days, 0) > 90  THEN 'WARNING'
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
    db.commit()

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
    product_code: str = ""
    product_name: str = ""
    price: float = 0
    quantity: int = 0
    total_price: float = 0

class SyncPayload(BaseModel):
    rows: list[SyncRow]
    is_final_batch: bool = False

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
        SELECT borrow_no, borrow_date, days_borrowed, borrow_alert, status
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

    now = datetime.now(timezone.utc)
    sheet_brs = {r.borrow_no for r in payload.rows if r.borrow_no}

    # ── Upsert customers (เฉพาะ name/sale/istock/erp) ────────────
    cust_map = {}
    for row in payload.rows:
        if not row.borrow_no or not row.cust_code: continue
        cc = row.cust_code
        if cc not in cust_map:
            cust_map[cc] = {"cust_code": cc, "customer_name": row.customer_name,
                            "istock_id": row.istock_id, "erp_id": row.erp_id,
                            "sale": row.sale}

    for cc, c in cust_map.items():
        try:
            db.execute(text("""
                INSERT INTO customers (cust_code,customer_name,istock_id,erp_id,sale,
                    status,max_days,active_br_count,updated_at)
                VALUES (:cc,:name,:istock,:erp,:sale,'NORMAL',0,0,:now)
                ON CONFLICT (cust_code) DO UPDATE SET
                    customer_name=EXCLUDED.customer_name,
                    sale=EXCLUDED.sale,
                    updated_at=EXCLUDED.updated_at
            """), {"cc": cc, "name": c["customer_name"], "istock": c["istock_id"],
                   "erp": c["erp_id"], "sale": c["sale"], "now": now})
        except: stats["errors"] += 1

    # ── Upsert borrows + items ────────────────────────────────────
    for row in payload.rows:
        if not row.borrow_no: continue
        try:
            ex = db.execute(text(
                "SELECT borrow_no FROM borrows WHERE borrow_no=:bno"
            ), {"bno": row.borrow_no}).fetchone()

            if ex:
                db.execute(text("""
                    UPDATE borrows SET days_borrowed=:days, borrow_alert=:alert,
                        status=:status, last_seen_at=:now WHERE borrow_no=:bno
                """), {"days": row.days_borrowed, "alert": row.borrow_alert,
                       "status": row.status, "now": now, "bno": row.borrow_no})
                stats["updated"] += 1
            else:
                db.execute(text("""
                    INSERT INTO borrows (borrow_no,cust_code,borrow_date,status,
                        days_borrowed,borrow_alert,sheet_status,first_seen_at,last_seen_at)
                    VALUES (:bno,:cc,:date,:status,:days,:alert,'active',:now,:now)
                """), {"bno": row.borrow_no, "cc": row.cust_code, "date": row.borrow_date,
                       "status": row.status, "days": row.days_borrowed,
                       "alert": row.borrow_alert, "now": now})
                stats["inserted"] += 1

            # ── insert/update items ────────────────────────────────
            if row.product_code:
                existing = db.execute(text("""
                    SELECT id FROM borrow_items
                    WHERE borrow_no=:bno AND product_code=:code
                """), {"bno": row.borrow_no, "code": row.product_code}).fetchone()

                if existing:
                    db.execute(text("""
                        UPDATE borrow_items SET
                            product_name=:name, price=:price,
                            quantity=:qty, total_price=:total, updated_at=:now
                        WHERE borrow_no=:bno AND product_code=:code
                    """), {"name": row.product_name, "price": row.price,
                           "qty": row.quantity, "total": row.total_price,
                           "now": now, "bno": row.borrow_no, "code": row.product_code})
                else:
                    db.execute(text("""
                        INSERT INTO borrow_items
                            (borrow_no,product_code,product_name,price,quantity,total_price,updated_at)
                        VALUES (:bno,:code,:name,:price,:qty,:total,:now)
                    """), {"bno": row.borrow_no, "code": row.product_code,
                           "name": row.product_name, "price": row.price,
                           "qty": row.quantity, "total": row.total_price, "now": now})

        except Exception as e:
            stats["errors"] += 1
            try: db.rollback()
            except: pass

    # ── Close BRs ที่หายจาก Sheet (ทำเฉพาะ batch สุดท้าย) ──────────
    if payload.is_final_batch:
        try:
            active = db.execute(text(
                "SELECT borrow_no FROM borrows WHERE sheet_status='active'"
            )).fetchall()
            gone = [r[0] for r in active if r[0] not in sheet_brs]
            if gone:
                db.execute(text("""
                    UPDATE borrows SET sheet_status='closed',closed_at=:now
                    WHERE borrow_no=ANY(:ids)
                """), {"now": now, "ids": gone})
                stats["closed"] = len(gone)
        except: pass

    db.commit()

    # ── Recalculate customer status จาก borrows ทั้งหมดใน DB ─────
    try:
        recalc_all_customers(db)
    except: pass

    duration = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    try:
        db.execute(text("""
            INSERT INTO sync_logs (status,sheet_rows,br_inserted,br_updated,br_closed,errors,duration_ms)
            VALUES (:st,:rows,:ins,:upd,:cl,:err,:dur)
        """), {"st": "success" if not stats["errors"] else "partial",
               "rows": len(payload.rows), "ins": stats["inserted"],
               "upd": stats["updated"], "cl": stats["closed"],
               "err": stats["errors"], "dur": duration})
        db.commit()
    except: pass

    return {"success": True, "duration_ms": duration, **stats}

@app.get("/recalc")
def recalc(db: Session = Depends(get_db)):
    """Force recalculate customer status จาก borrows ทั้งหมด"""
    try:
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
        b = db.execute(text("SELECT COUNT(*) FROM borrows")).fetchone()[0]
        c = db.execute(text("SELECT COUNT(*) FROM customers")).fetchone()[0]
        i = db.execute(text("SELECT COUNT(*) FROM borrow_items")).fetchone()[0]
        return {"customers": c, "borrows": b, "borrow_items": i}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/reset-db")
def reset_db(db: Session = Depends(get_db)):
    db.execute(text("TRUNCATE borrow_items, borrows, customers, sync_logs RESTART IDENTITY CASCADE"))
    db.commit()
    return {"success": True, "message": "DB cleared"}