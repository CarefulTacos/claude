# วิธีเปิดใช้ระบบจองและหลังบ้าน ไปด้วยกัน

ระบบนี้อยู่บน Cloudflare ทั้งหมด (ฟรีสำหรับปริมาณงานของเรา):

- **Cloudflare Pages** เสิร์ฟหน้าเว็บ (`public/`)
- **Pages Functions** คือ API ใน `functions/` (รับจอง, หลังบ้าน)
- **D1** คือฐานข้อมูล เก็บนัด ผู้ช่วย ค่าใช้จ่าย การตั้งค่า

หน้าเว็บ: `/` หน้าแรก · `/book.html` ฟอร์มจอง · `/admin/` หลังบ้าน (ใช้รหัสผ่าน)

---

## ทำครั้งเดียวตอนเริ่มต้น

### 1. ตรวจ token ของ Cloudflare

GitHub secret `CLOUDFLARE_API_TOKEN` ต้องมีสิทธิ์ **Cloudflare Pages: Edit** และ **D1: Edit**
ถ้า token เดิมมีแค่ Pages ให้สร้าง token ใหม่ที่ https://dash.cloudflare.com/profile/api-tokens
(เลือก preset "Edit Cloudflare Workers" หรือเพิ่มสิทธิ์ D1 เอง) แล้วแทนที่ secret เดิมใน GitHub

### 2. สร้างฐานข้อมูล D1 แล้วใส่ id

ทำในหน้าเว็บ Cloudflare: **Storage & Databases → D1 → Create database** ตั้งชื่อ `pai-duay-gan`
(หรือในเครื่องที่ติดตั้ง Node: `cd pai-duay-gan/site && npm install && npx wrangler d1 create pai-duay-gan`)

คัดลอก **Database ID** ไปแทน `REPLACE_WITH_D1_ID` ใน `pai-duay-gan/site/wrangler.toml` แล้ว commit
(id นี้ไม่ใช่ความลับ ใส่ใน repo ได้)

### 3. Deploy ครั้งแรก

GitHub → แท็บ **Actions** → **Deploy Pai Duay Gan site** → **Run workflow**
workflow จะ: ทดสอบสูตรราคา → สร้างโปรเจกต์ Pages (ถ้ายังไม่มี) → สร้างตารางใน D1 → deploy

### 4. ตั้งรหัสผ่านหลังบ้าน (Pages secrets)

Cloudflare → **Workers & Pages → pai-duay-gan → Settings → Variables and Secrets** (Production) → เพิ่มแบบ **Secret**:

| ชื่อ | ค่า |
| --- | --- |
| `ADMIN_PASSWORD` | รหัสผ่านเข้าหลังบ้าน ยาว ๆ จำได้ เช่น ประโยค 4-5 คำ |
| `SESSION_SECRET` | ตัวอักษรสุ่มอย่างน้อย 32 ตัว (สร้างได้จาก https://1password.com/password-generator ) |
| `LINE_CHANNEL_TOKEN` | (ไม่บังคับ) Channel access token ของ LINE OA สำหรับแจ้งเตือนเมื่อมีคนจอง |
| `LINE_OWNER_USER_ID` | (ไม่บังคับ) User ID ของเจ้าของ (ขึ้นต้นด้วย U) ดูได้ใน LINE Developers → Basic settings |

หรือใช้คำสั่ง: `npx wrangler pages secret put ADMIN_PASSWORD --project-name=pai-duay-gan`

**secret มีผลกับ deploy ถัดไป** ให้กด Run workflow อีกครั้งหลังตั้งค่า
ถ้ายังไม่ตั้ง `ADMIN_PASSWORD`/`SESSION_SECRET` หลังบ้านจะแจ้งว่า "ยังไม่ได้ตั้งค่า" และเข้าไม่ได้ (ฟอร์มจองยังใช้ได้)

### 5. ตั้งค่าในหลังบ้าน

เข้า `/admin/` → **ตั้งค่า** ใส่ หมายเลขพร้อมเพย์, LINE OA จริง, เบอร์เจ้าของ, ตรวจราคาแพ็กเกจ แล้วกดบันทึก
จากนั้นเพิ่มผู้ช่วยในเมนู **ผู้ช่วย**

LINE แจ้งเตือน: ข้อความมีแค่ รหัสจอง วันที่ ธุระ เขต และปลายทาง (ไม่มีข้อมูลสุขภาพ) ถ้าไม่ตั้งค่าหรือ LINE ล่ม การจองยังสำเร็จตามปกติ

---

## งานประจำ

### Deploy หลังแก้ไขเว็บ
GitHub → Actions → Run workflow (ไม่ deploy เองอัตโนมัติ) ไฟล์ migration ใหม่ใน `migrations/` จะถูกใช้กับ D1 ให้อัตโนมัติ

### สำรองข้อมูล (แนะนำเดือนละครั้ง)
- วิธีง่าย: หลังบ้าน → **รายงาน** → ดาวน์โหลด CSV นัด ค่าใช้จ่าย ค่าผู้ช่วย (เปิดใน Excel ได้ ไม่มีข้อมูลสุขภาพ)
- สำรองทั้งฐานข้อมูล (ในเครื่องที่มี Node):
  ```bash
  cd pai-duay-gan/site
  npx wrangler d1 export pai-duay-gan --remote --output=backup-$(date +%F).sql
  ```
  ไฟล์นี้มีข้อมูลสุขภาพลูกค้า เก็บในที่ปลอดภัย อย่า commit เข้า git
- D1 มี Time Travel กู้ย้อนหลังได้ 30 วันอยู่แล้ว: `npx wrangler d1 time-travel restore pai-duay-gan --timestamp=...`

### เปลี่ยนรหัสผ่านหลังบ้าน
1. Cloudflare → pai-duay-gan → Settings → Variables and Secrets → แก้ `ADMIN_PASSWORD`
2. ถ้าต้องการให้ทุกเครื่องที่ล็อกอินอยู่หลุดทันที ให้เปลี่ยน `SESSION_SECRET` ด้วย
3. Run workflow เพื่อ deploy ใหม่

ล็อกอินอยู่ได้ 12 ชั่วโมง ใส่รหัสผิด 5 ครั้งใน 15 นาที จะถูกพักการล็อกอิน 15 นาที

### PDPA
หลังบ้าน → **PDPA** ลบข้อมูลสุขภาพ เบอร์ผู้สูงอายุ เบอร์ฉุกเฉิน และที่อยู่ ของนัดที่จบแล้วเกิน N วัน (ค่าเริ่มต้น 365) กดตรวจสอบก่อน แล้วยืนยันในหน้า ลบแล้วกู้ไม่ได้

---

## รันในเครื่อง (สำหรับนักพัฒนา)

```bash
cd pai-duay-gan/site
npm install
cp .dev.vars.example .dev.vars      # แก้รหัสผ่านในไฟล์นี้
npm run migrate:local               # สร้างตารางใน D1 จำลอง (.wrangler/)
npm run dev                         # http://localhost:8788
npm test                            # unit tests (สูตรราคา ยกเลิก QR พร้อมเพย์ ตรวจฟอร์ม)
npm run test:e2e                    # ทดสอบทั้งระบบด้วย Playwright (ใช้ฐานข้อมูลแยก)
```
