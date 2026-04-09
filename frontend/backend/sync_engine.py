"""
sync_engine.py — Borrow Control
Sheet columns: A=DATE B=STATUS C=Borrow No. D=iStock(ID) E=ERP(ID)
               F=SALE G=Customer H=Product Code I=Product Name
               J=Price K=Quantity L=Total Price M=Days Borrowed
               N=Borrow Alert O=Customer Code Clean
"""
import os, logging
from datetime import datetime, timezone
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

SHEET_ID         = os.getenv("SHEET_ID", "your_spreadsheet_id")
SHEET_RANGE      = "Sheet1!A:O"
DATABASE_URL     = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/borrow_control")
CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS", "credentials.json")

# Column index (0-based) — ปรับถ้า header จริงต่างกัน
C = {
    "DATE": 0, "STATUS": 1, "BORROW_NO": 2, "ISTOCK_ID": 3, "ERP_ID": 4,
    "SALE": 5, "CUSTOMER_NAME": 6, "PRODUCT_CODE": 7, "PRODUCT_NAME": 8,
    "PRICE": 9, "QUANTITY": 10, "TOTAL_PRICE": 11,
    "DAYS_BORROWED": 12, "BORROW_ALERT": 13, "CUST_CODE": 14,
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler("sync.log"), logging.StreamHandler()],
)
log = logging.getLogger(__name__)
engine  = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)


# ── DB setup ──────────────────────────────────────────────────────
def ensure_tables():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS customers (
                cust_code       TEXT PRIMARY KEY,
                customer_name   TEXT,
                istock_id       TEXT,
                erp_id          TEXT,
                sale            TEXT,
                status          TEXT DEFAULT 'NORMAL',
                max_days        INTEGER DEFAULT 0,
                active_br_count INTEGER DEFAULT 0,
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS borrows (
                borrow_no     TEXT PRIMARY KEY,
                cust_code     TEXT,
                borrow_date   TEXT,
                status        TEXT,
                days_borrowed INTEGER DEFAULT 0,
                borrow_alert  TEXT,
                sheet_status  TEXT DEFAULT 'active',
                first_seen_at TIMESTAMPTZ DEFAULT NOW(),
                last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
                closed_at     TIMESTAMPTZ
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS borrow_items (
                id           SERIAL PRIMARY KEY,
                borrow_no    TEXT,
                product_code TEXT,
                product_name TEXT,
                price        NUMERIC(14,2),
                quantity     INTEGER,
                total_price  NUMERIC(14,2),
                updated_at   TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sync_logs (
                id          SERIAL PRIMARY KEY,
                synced_at   TIMESTAMPTZ DEFAULT NOW(),
                status      TEXT,
                sheet_rows  INTEGER DEFAULT 0,
                br_inserted INTEGER DEFAULT 0,
                br_updated  INTEGER DEFAULT 0,
                br_closed   INTEGER DEFAULT 0,
                errors      INTEGER DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                error_msg   TEXT
            )
        """))
        for idx in [
            "CREATE INDEX IF NOT EXISTS idx_b_cust  ON borrows(cust_code)",
            "CREATE INDEX IF NOT EXISTS idx_b_sheet ON borrows(sheet_status)",
            "CREATE INDEX IF NOT EXISTS idx_c_sale  ON customers(sale)",
            "CREATE INDEX IF NOT EXISTS idx_i_bno   ON borrow_items(borrow_no)",
        ]:
            conn.execute(text(idx))
        conn.commit()
    log.info("Tables ready")


# ── Helpers ───────────────────────────────────────────────────────
def _get(row, key, default=""):
    idx = C[key]
    return row[idx] if len(row) > idx and row[idx] != "" else default

def _int(v):
    try: return int(float(v))
    except: return 0

def _float(v):
    try: return float(v)
    except: return 0.0

def calc_cust_status(max_days: int) -> str:
    if max_days > 180: return "BLOCK"
    if max_days > 90:  return "WARNING"
    return "NORMAL"


# ── Fetch Sheet ───────────────────────────────────────────────────
def fetch_sheet():
    """คืน (br_map, item_map) — br_map: {borrow_no → br_data}"""
    creds = Credentials.from_service_account_file(
        CREDENTIALS_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    svc = build("sheets", "v4", credentials=creds)
    rows = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=SHEET_RANGE,
        valueRenderOption="UNFORMATTED_VALUE",
    ).execute().get("values", [])

    if len(rows) < 2:
        return {}, {}

    br_map, item_map = {}, {}
    for row in rows[1:]:
        bno = str(_get(row, "BORROW_NO")).strip()
        if not bno:
            continue

        # BR header fields (เขียนทับถ้าเจอแถวซ้ำ — ค่าเดียวกันทุกแถวของ BR เดียว)
        br_map[bno] = {
            "borrow_no":     bno,
            "cust_code":     str(_get(row, "CUST_CODE")).strip(),
            "customer_name": str(_get(row, "CUSTOMER_NAME")),
            "istock_id":     str(_get(row, "ISTOCK_ID")),
            "erp_id":        str(_get(row, "ERP_ID")),
            "sale":          str(_get(row, "SALE")),
            "borrow_date":   str(_get(row, "DATE")),
            "status":        str(_get(row, "STATUS")),
            "days_borrowed": _int(_get(row, "DAYS_BORROWED")),
            "borrow_alert":  str(_get(row, "BORROW_ALERT")),
        }

        item_map.setdefault(bno, []).append({
            "borrow_no":    bno,
            "product_code": str(_get(row, "PRODUCT_CODE")),
            "product_name": str(_get(row, "PRODUCT_NAME")),
            "price":        _float(_get(row, "PRICE")),
            "quantity":     _int(_get(row, "QUANTITY")),
            "total_price":  _float(_get(row, "TOTAL_PRICE")),
        })

    log.info(f"Sheet: {len(rows)-1} แถว → {len(br_map)} BR")
    return br_map, item_map


# ── Sync ──────────────────────────────────────────────────────────
def run_sync():
    start  = datetime.now(timezone.utc)
    stats  = {"br_inserted": 0, "br_updated": 0, "br_closed": 0, "errors": 0}
    log.info("─── เริ่ม sync ───")

    try:
        br_map, item_map = fetch_sheet()
        now = datetime.now(timezone.utc)

        with Session() as db:
            # active BRs ใน DB
            db_rows  = db.execute(text(
                "SELECT borrow_no, days_borrowed, borrow_alert FROM borrows WHERE sheet_status='active'"
            )).fetchall()
            db_brs   = {r[0]: (r[1], r[2]) for r in db_rows}
            sheet_ids = set(br_map.keys())
            db_ids    = set(db_brs.keys())

            # ── Upsert customers (คำนวณ status จาก max days ทุก BR) ──
            cust_agg = {}
            for br in br_map.values():
                cc = br["cust_code"]
                if not cc: continue
                if cc not in cust_agg:
                    cust_agg[cc] = {"cust_code": cc, "customer_name": br["customer_name"],
                                    "istock_id": br["istock_id"], "erp_id": br["erp_id"],
                                    "sale": br["sale"], "max_days": 0, "count": 0}
                cust_agg[cc]["max_days"] = max(cust_agg[cc]["max_days"], br["days_borrowed"])
                cust_agg[cc]["count"] += 1

            for cc, c in cust_agg.items():
                db.execute(text("""
                    INSERT INTO customers
                        (cust_code,customer_name,istock_id,erp_id,sale,
                         status,max_days,active_br_count,updated_at)
                    VALUES (:cc,:name,:istock,:erp,:sale,:status,:max_days,:count,:now)
                    ON CONFLICT (cust_code) DO UPDATE SET
                        customer_name=EXCLUDED.customer_name, sale=EXCLUDED.sale,
                        status=EXCLUDED.status, max_days=EXCLUDED.max_days,
                        active_br_count=EXCLUDED.active_br_count, updated_at=EXCLUDED.updated_at
                """), {"cc": cc, "name": c["customer_name"], "istock": c["istock_id"],
                       "erp": c["erp_id"], "sale": c["sale"],
                       "status": calc_cust_status(c["max_days"]),
                       "max_days": c["max_days"], "count": c["count"], "now": now})

            # ── Insert new BRs ────────────────────────────────────
            for bno in sheet_ids - db_ids:
                br = br_map[bno]
                try:
                    db.execute(text("""
                        INSERT INTO borrows
                            (borrow_no,cust_code,borrow_date,status,
                             days_borrowed,borrow_alert,sheet_status,first_seen_at,last_seen_at)
                        VALUES (:bno,:cc,:date,:status,:days,:alert,'active',:now,:now)
                    """), {"bno": bno, "cc": br["cust_code"], "date": br["borrow_date"],
                           "status": br["status"], "days": br["days_borrowed"],
                           "alert": br["borrow_alert"], "now": now})
                    _replace_items(db, bno, item_map.get(bno, []), now)
                    stats["br_inserted"] += 1
                except Exception as e:
                    log.warning(f"INSERT {bno}: {e}")
                    stats["errors"] += 1

            # ── Update changed BRs ────────────────────────────────
            for bno in sheet_ids & db_ids:
                br = br_map[bno]
                old_days, old_alert = db_brs[bno]
                if br["days_borrowed"] != old_days or br["borrow_alert"] != old_alert:
                    try:
                        db.execute(text("""
                            UPDATE borrows SET days_borrowed=:days, borrow_alert=:alert,
                                status=:status, last_seen_at=:now WHERE borrow_no=:bno
                        """), {"days": br["days_borrowed"], "alert": br["borrow_alert"],
                               "status": br["status"], "now": now, "bno": bno})
                        _replace_items(db, bno, item_map.get(bno, []), now)
                        stats["br_updated"] += 1
                    except Exception as e:
                        log.warning(f"UPDATE {bno}: {e}")
                        stats["errors"] += 1
                else:
                    db.execute(text(
                        "UPDATE borrows SET last_seen_at=:now WHERE borrow_no=:bno"
                    ), {"now": now, "bno": bno})

            # ── Close BRs gone from Sheet ─────────────────────────
            gone = list(db_ids - sheet_ids)
            if gone:
                db.execute(text("""
                    UPDATE borrows SET sheet_status='closed', closed_at=:now
                    WHERE borrow_no=ANY(:ids)
                """), {"now": now, "ids": gone})
                stats["br_closed"] = len(gone)

                # Recalculate customer status ของลูกค้าที่ BR ถูกปิด
                affected = db.execute(text(
                    "SELECT DISTINCT cust_code FROM borrows WHERE borrow_no=ANY(:ids)"
                ), {"ids": gone}).fetchall()
                for (cc,) in affected:
                    _recalc_customer(db, cc, now)

            db.commit()

        dur = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        _write_log("success" if not stats["errors"] else "partial",
                   len(br_map), stats, dur)
        log.info(
            f"✓ {dur}ms | {len(br_map)} BRs | "
            f"+{stats['br_inserted']} ใหม่ | ~{stats['br_updated']} เปลี่ยน | "
            f"-{stats['br_closed']} ปิด | {stats['errors']} error"
        )

    except Exception as e:
        dur = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        log.error(f"✗ ล้มเหลว: {e}")
        _write_log("error", 0, stats, dur, str(e))
        raise


def _replace_items(db, borrow_no, items, now):
    db.execute(text("DELETE FROM borrow_items WHERE borrow_no=:bno"), {"bno": borrow_no})
    for item in items:
        db.execute(text("""
            INSERT INTO borrow_items (borrow_no,product_code,product_name,price,quantity,total_price,updated_at)
            VALUES (:borrow_no,:product_code,:product_name,:price,:quantity,:total_price,:now)
        """), {**item, "now": now})


def _recalc_customer(db, cust_code, now):
    """คำนวณ status ลูกค้าใหม่จาก active BRs ที่เหลือ"""
    r = db.execute(text("""
        SELECT COALESCE(MAX(days_borrowed),0), COUNT(*)
        FROM borrows WHERE cust_code=:cc AND sheet_status='active'
    """), {"cc": cust_code}).fetchone()
    max_days, count = r
    db.execute(text("""
        UPDATE customers SET status=:status, max_days=:max_days,
            active_br_count=:count, updated_at=:now WHERE cust_code=:cc
    """), {"status": calc_cust_status(max_days), "max_days": max_days,
           "count": count, "now": now, "cc": cust_code})


def _write_log(status, sheet_rows, stats, duration_ms, error_msg=None):
    with Session() as db:
        db.execute(text("""
            INSERT INTO sync_logs
                (status,sheet_rows,br_inserted,br_updated,br_closed,errors,duration_ms,error_msg)
            VALUES (:status,:sheet_rows,:br_inserted,:br_updated,:br_closed,:errors,:duration_ms,:error_msg)
        """), {"status": status, "sheet_rows": sheet_rows, **stats,
               "duration_ms": duration_ms, "error_msg": error_msg})
        db.commit()


if __name__ == "__main__":
    ensure_tables()
    run_sync()
