# Borrow Control System

ระบบติดตามสถานะการยืมสินค้า เชื่อมต่อข้อมูลจาก Google Sheets → PostgreSQL

## โครงสร้างโปรเจค

```
borrow-control/
├── frontend/          React + Vite (Sale View & Admin View)
│   ├── src/
│   │   ├── App.jsx             entry point + mock data
│   │   └── components/
│   │       ├── SaleView.jsx    หน้า Sale (ตาราง + BR detail)
│   │       └── AdminView.jsx   หน้า Admin (Pie, Bar, Full table, Sync log)
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── backend/
    ├── main.py          FastAPI endpoints
    ├── sync_engine.py   Google Sheets → PostgreSQL sync
    └── requirements.txt
```

## วิธีรัน (Local)

```bash
# Frontend
cd frontend
npm install
npm run dev
# เปิด http://localhost:3000
```

```bash
# Backend
cd backend
pip install -r requirements.txt

# ตั้งค่า .env
SHEET_ID=your_sheet_id
DATABASE_URL=postgresql://...
GOOGLE_CREDENTIALS=credentials.json

uvicorn main:app --reload
```

## เชื่อม API จริง

ใน `frontend/src/App.jsx` เปลี่ยน:
```js
const MOCK_MODE = false;  // บรรทัดที่ 5
```

แล้วตั้ง environment variable:
```
VITE_API_URL=https://your-api.onrender.com
```

## Deploy บน Render

1. Push code ขึ้น GitHub
2. Render → New → **Static Site** → เลือก repo → Root: `frontend` → Build: `npm run build` → Publish: `dist`
3. Render → New → **Web Service** → เลือก repo → Root: `backend` → Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Render → New → **Cron Job** → `*/5 * * * *` → `python sync_engine.py`

## API Endpoints

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/customers` | ลูกค้าทั้งหมด (filter: `?sale=X&status=BLOCK&team=Bangkok`) |
| GET | `/customers/{cust_code}/brs` | BR ของลูกค้า |
| GET | `/alerts` | เฉพาะ BLOCK/WARNING |
| GET | `/sync-logs` | ประวัติ sync |
| GET | `/sales` | รายชื่อ Sale ทั้งหมด |

## หมายเหตุสำหรับหัวหน้า (Integration)

- Frontend เป็น React component ล้วน ไม่มี auth ในตัว — ให้ wrap ด้วย auth ของระบบหลัก
- `VITE_API_URL` ชี้ไปที่ backend จริงได้เลย
- ข้อมูล team/sale อยู่ใน `App.jsx` ส่วน `TEAMS` object — ปรับได้ตามต้องการ
- DB schema อยู่ใน `sync_engine.py` ฟังก์ชัน `ensure_tables()`
