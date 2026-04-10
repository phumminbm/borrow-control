from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Date, ForeignKey, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, timedelta
import os

# ─── Database Setup ───────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/borrow_control")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ─── Models ───────────────────────────────────────────────────────
class Sale(Base):
    __tablename__ = "sales"
    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String, nullable=False)
    email    = Column(String, unique=True, nullable=False)
    customers = relationship("Customer", back_populates="sale")

class Customer(Base):
    __tablename__ = "customers"
    id      = Column(Integer, primary_key=True, index=True)
    name    = Column(String, nullable=False)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    sale    = relationship("Sale", back_populates="customers")
    borrows = relationship("Borrow", back_populates="customer")

class Borrow(Base):
    __tablename__ = "borrows"
    id          = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    borrow_date = Column(Date, nullable=False)
    return_date = Column(Date, nullable=True)  # NULL = ยังไม่คืน
    customer    = relationship("Customer", back_populates="borrows")

# ─── Pydantic Schemas ─────────────────────────────────────────────
class BorrowOut(BaseModel):
    id: int
    borrow_date: date
    return_date: Optional[date]
    days_overdue: int

    class Config:
        from_attributes = True

class CustomerOut(BaseModel):
    id: int
    name: str
    sale_id: int
    sale_name: str
    status: str          # BLOCK / WARNING / NORMAL
    max_days: int        # วันที่ค้างนานสุด
    borrows: List[BorrowOut]

class AlertOut(BaseModel):
    customer_id: int
    customer_name: str
    sale_name: str
    status: str
    max_days: int

# ─── Status Logic ─────────────────────────────────────────────────
def calc_days_overdue(borrow: Borrow) -> int:
    """คำนวณวันค้างชำระ (ยังไม่คืน = นับถึงวันนี้)"""
    end = borrow.return_date if borrow.return_date else date.today()
    return max(0, (end - borrow.borrow_date).days)

def calc_customer_status(borrows: list) -> tuple[str, int]:
    """
    Returns (status, max_days)
    > 180 วัน → BLOCK
    > 90 วัน  → WARNING
    else      → NORMAL
    """
    if not borrows:
        return "NORMAL", 0

    max_days = max(calc_days_overdue(b) for b in borrows)

    if max_days > 180:
        return "BLOCK", max_days
    elif max_days > 90:
        return "WARNING", max_days
    else:
        return "NORMAL", max_days

# ─── App ──────────────────────────────────────────────────────────
app = FastAPI(title="Borrow Control API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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

# ─── Endpoints ────────────────────────────────────────────────────

@app.get("/customers", response_model=List[CustomerOut])
def get_customers(
    sale_id: Optional[int] = Query(None, description="Filter by sale ID"),
    status: Optional[str]  = Query(None, description="BLOCK / WARNING / NORMAL"),
    db: Session = Depends(get_db),
):
    """ดึงรายการลูกค้า พร้อมสถานะ BLOCK/WARNING/NORMAL"""
    query = db.query(Customer)
    if sale_id:
        query = query.filter(Customer.sale_id == sale_id)

    customers = query.all()
    result = []

    for c in customers:
        cust_status, max_days = calc_customer_status(c.borrows)

        # กรองตาม status ถ้ามี
        if status and cust_status != status.upper():
            continue

        borrow_list = [
            BorrowOut(
                id=b.id,
                borrow_date=b.borrow_date,
                return_date=b.return_date,
                days_overdue=calc_days_overdue(b),
            )
            for b in c.borrows
        ]

        result.append(
            CustomerOut(
                id=c.id,
                name=c.name,
                sale_id=c.sale_id,
                sale_name=c.sale.name,
                status=cust_status,
                max_days=max_days,
                borrows=borrow_list,
            )
        )

    return result


@app.get("/alerts", response_model=List[AlertOut])
def get_alerts(
    sale_id: Optional[int] = Query(None, description="Filter by sale ID"),
    db: Session = Depends(get_db),
):
    """ดึงลูกค้าที่มีสถานะ BLOCK หรือ WARNING เท่านั้น"""
    query = db.query(Customer)
    if sale_id:
        query = query.filter(Customer.sale_id == sale_id)

    customers = query.all()
    alerts = []

    for c in customers:
        cust_status, max_days = calc_customer_status(c.borrows)
        if cust_status in ("BLOCK", "WARNING"):
            alerts.append(
                AlertOut(
                    customer_id=c.id,
                    customer_name=c.name,
                    sale_name=c.sale.name,
                    status=cust_status,
                    max_days=max_days,
                )
            )

    # เรียงจากอันตรายสุดก่อน
    alerts.sort(key=lambda x: (0 if x.status == "BLOCK" else 1, -x.max_days))
    return alerts


@app.get("/sales")
def get_sales(db: Session = Depends(get_db)):
    """ดึงรายการ Sales ทั้งหมด (สำหรับ dropdown filter)"""
    return [{"id": s.id, "name": s.name} for s in db.query(Sale).all()]


@app.get("/health")
def health():
    return {"status": "ok"}
