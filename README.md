# MES-API-GSL: MES to MuleSoft EAI Integration Service

Layanan integrasi otomatis antara sistem **MES (PT. SGMW Motor Indonesia)** dan **MuleSoft EAI** untuk data:
1. `MES_OrderBroadcast_Pub` *(Selesai, Teruji & Live di Server)*
2. `MES_VehicleBasicInfo_Pub` *(Selesai, Teruji & Live di Server)*
3. `MES_VehiclePassingPoint_Pub` *(Selesai, Teruji & Live di Server)*
4. `MES_VehiclePreciseTraceability_Pub` *(Selesai & Terintegrasi)*
5. `MES_VehicleOfflineBOM_Pub` *(Selesai & Terintegrasi)*

---

## 🚀 Fitur Utama
* **Web Monitoring Dashboard UI**: Dibuka langsung lewat browser di `http://10.140.240.10:3000/`.
* **Cron Scheduler 30 Menit**: Otomatis mengecek dan mengirim data baru per 30 menit (`*/30 * * * *`) untuk ke-5 interface (dapat diaktifkan/dinonaktifkan via `CRON_ENABLED`).
* **Anti-Duplikasi & Audit Log di SQL Server**:
  * `MES_OrderBroadcast_Pub`: Menggunakan tabel `[MES_EAI_OrderBroadcast_Log]`.
  * `MES_VehicleBasicInfo_Pub`: Menggunakan tabel `[MES_EAI_VehicleBasicInfo_Log]` *(mg_car_as_data bersifat READ-ONLY)*.
  * `MES_VehiclePassingPoint_Pub`: Menggunakan tabel `[MES_EAI_VehiclePassingPoint_Log]`.
  * `MES_VehiclePreciseTraceability_Pub`: Menggunakan tabel `[MES_EAI_VehiclePreciseTraceability_Log]`.
  * `MES_VehicleOfflineBOM_Pub`: Menggunakan tabel `[MES_Vehicle_OfflineBOM]` dan audit log `[MES_EAI_VehicleOfflineBOM_Log]`.
* **Auto Log Retention 90 Hari**: Log lebih dari 90 hari otomatis dibersihkan setiap pukul 01:00 AM dan saat boot.
* **REST API On-Demand**:
  * Health check status database & EAI.
  * Trigger sinkronisasi manual per batch (maksimal 50 rows/VIN/Record).
  * Re-send manual spesifik untuk 1 VIN atau 1 Record BOM tertentu.
  * Audit log riwayat pengiriman langsung dari DB.
  * Inspeksi payload JSON transmisi (`/payload/:vin` atau `/payload/:id`).
* **Daily Rotating Log**: Log disimpan di folder `logs/` dengan rotasi harian dan retensi 14 hari.

---

## 🛠️ Konfigurasi (`.env`)

```ini
# Server
PORT=3000
NODE_ENV=development

# SQL Server MES
DB_SERVER=10.140.240.10
DB_PORT=1433
DB_USER=your_db_user_here
DB_PASSWORD=your_db_password_here
DB_NAME=PTSGMW_MES

# EAI Environment (TEST atau PRD)
EAI_ENV=TEST
EAI_ORDER_BROADCAST_TEST_URL=http://10.140.240.6:8888/http2dumpdb/MES_OrderBroadcast_Pub
EAI_ORDER_BROADCAST_PRD_URL=http://<prd-ip>:<prd-port>/MES_OrderBroadcast_Pub

EAI_VEHICLE_BASIC_INFO_TEST_URL=http://10.140.240.6:8888/http2dumpdb/MES_VehicleBasicInfo_Pub
EAI_VEHICLE_BASIC_INFO_PRD_URL=http://<prd-ip>:<prd-port>/MES_VehicleBasicInfo_Pub

EAI_VEHICLE_PASSING_POINT_TEST_URL=http://10.140.240.6:8888/http2dumpdb/MES_VehiclePassingPoint_Pub
EAI_VEHICLE_PASSING_POINT_PRD_URL=http://<prd-ip>:<prd-port>/MES_VehiclePassingPoint_Pub

EAI_VEHICLE_PRECISE_TRACEABILITY_TEST_URL=http://10.140.240.6:8888/http2dumpdb/MES_VehiclePreciseTraceability_Pub
EAI_VEHICLE_PRECISE_TRACEABILITY_PRD_URL=http://<prd-ip>:<prd-port>/MES_VehiclePreciseTraceability_Pub

EAI_VEHICLE_OFFLINE_BOM_TEST_URL=http://10.140.240.6:8888/http2dumpdb/MES_VehicleOfflineBOM_Pub
EAI_VEHICLE_OFFLINE_BOM_PRD_URL=http://<prd-ip>:<prd-port>/MES_VehicleOfflineBOM_Pub

# Scheduler
CRON_ENABLED=false
CRON_ORDER_BROADCAST=*/30 * * * *
CRON_VEHICLE_BASIC_INFO=*/30 * * * *
CRON_VEHICLE_PASSING_POINT=*/30 * * * *
CRON_VEHICLE_PRECISE_TRACEABILITY=*/30 * * * *
CRON_VEHICLE_OFFLINE_BOM=*/30 * * * *

# Processing (Max 50 per batch)
BATCH_SIZE=50
MAX_RETRY_COUNT=3
RELEASE_START_DATE=2026-11-11

# Dashboard Authentication
AUTH_USERNAME=admin
AUTH_PASSWORD=change_this_admin_password
JWT_SECRET=change_this_jwt_secret_key
```

---

## 📡 Daftar REST API Endpoints

### 1. Health Check & Dashboard
* `GET /health` : Cek status kesehatan aplikasi, koneksi SQL Server, dan status EAI.
* `GET /` atau `GET /dashboard` : Web Dashboard UI.
* `GET /api/dashboard/summary` : Ringkasan statistik dan log 50 transaksi terakhir dari ke-5 interface.

### 2. Order Broadcast
* `POST /api/order-broadcast/sync` : Trigger manual batch sync.
* `POST /api/order-broadcast/sync/:vin` : Trigger manual khusus 1 nomor VIN.
* `GET /api/order-broadcast/logs` : Histori log pengiriman.
* `GET /api/order-broadcast/payload/:vin` : Inspeksi payload JSON yang dikirim ke EAI.

### 3. Vehicle Basic Info
* `POST /api/vehicle-basic-info/sync` : Trigger manual batch sync data basic info & features.
* `POST /api/vehicle-basic-info/sync/:vin` : Trigger manual khusus 1 nomor VIN.
* `GET /api/vehicle-basic-info/logs` : Histori log pengiriman basic info.
* `GET /api/vehicle-basic-info/payload/:vin` : Inspeksi payload JSON yang dikirim ke EAI.

### 4. Vehicle Passing Point
* `POST /api/vehicle-passing-point/sync` : Trigger manual batch sync data passing point.
* `POST /api/vehicle-passing-point/sync/:vin` : Trigger manual khusus 1 nomor VIN.
* `GET /api/vehicle-passing-point/logs` : Histori log pengiriman passing point.
* `GET /api/vehicle-passing-point/payload/:vin` : Inspeksi payload JSON yang dikirim ke EAI.

### 5. Vehicle Precise Traceability
* `POST /api/vehicle-precise-traceability/sync` : Trigger manual batch sync data barcode keyparts.
* `POST /api/vehicle-precise-traceability/sync/:vin` : Trigger manual khusus 1 nomor VIN.
* `GET /api/vehicle-precise-traceability/logs` : Histori log pengiriman keyparts.
* `GET /api/vehicle-precise-traceability/payload/:vin` : Inspeksi payload JSON yang dikirim ke EAI.

### 6. Vehicle Offline BOM
* `POST /api/vehicle-offline-bom/sync` : Trigger manual batch sync data Vehicle Offline BOM.
* `POST /api/vehicle-offline-bom/sync/:id` : Trigger manual khusus 1 Record ID BOM.
* `GET /api/vehicle-offline-bom/logs` : Histori log pengiriman Offline BOM.
* `GET /api/vehicle-offline-bom/payload/:id` : Inspeksi payload JSON yang dikirim ke EAI.
