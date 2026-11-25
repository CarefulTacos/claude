# ไปด้วยกัน (Pai Duay Gan)

บริการผู้ช่วยพาผู้สูงอายุไปหาหมอและทำธุระในกรุงเทพฯ รับถึงบ้าน อยู่ด้วยตลอดนัด ส่งกลับถึงบ้าน

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `site/public/index.html` | เว็บไซต์หน้าเดียว (ไม่ต้อง build) |
| `site/public/book.html` | ฟอร์มจองออนไลน์ (ทุกธุระ) |
| `site/public/admin/` | หลังบ้าน: นัด ผู้ช่วย ค่าผู้ช่วย ลูกค้า ค่าใช้จ่าย รายงาน QR พร้อมเพย์ ตั้งค่า PDPA |
| `site/public/terms.html`, `site/public/privacy.html` | หน้าเงื่อนไขบริการและนโยบายความเป็นส่วนตัว (ร่าง รอนักกฎหมาย) |
| `site/public/shared/` | สูตรราคา/ยกเลิก, QR พร้อมเพย์, กฎฟอร์ม ใช้ร่วมกันทั้งหน้าเว็บ API และ test |
| `site/functions/` | API (Cloudflare Pages Functions) |
| `site/migrations/` | โครงสร้างฐานข้อมูล D1 |
| `site/tests/` | unit test (`npm test`) และ e2e (`npm run test:e2e`) |
| `site/DEPLOY.md` | ขั้นตอนเปิดใช้ สำรองข้อมูล เปลี่ยนรหัสผ่าน |
| `site/body.html` | เนื้อหาหน้าแรก แบบที่ใช้แสดงตัวอย่างบน claude.ai (ไม่ deploy) |
| `templates/booking-tracker.csv` | หัวคอลัมน์ชีตติดตามนัด นำเข้า Google Sheets ได้เลย |
| `templates/pai-duay-gan-operations.xlsx` | ไฟล์บริหารนัด ค่าผู้ช่วย ค่าใช้จ่าย และกำไรรายเดือน (มีสูตรคำนวณ) สร้างใหม่ได้ด้วย `python3 tools/make_workbook.py` |
| `assets/out/` | รูป Instagram 6 รูป เมนู LINE ใบปลิว A5 (PDF) การ์ดผู้ช่วย (PDF) และ QR LINE |
| `assets/src/` + `assets/build.js` | ต้นฉบับของรูปทั้งหมด แก้ `assets/config.json` แล้วรัน `npm install && node build.js` เพื่อสร้างใหม่ |

## ต้องแก้ก่อนเปิดเว็บจริง

- LINE ID `@paiduaygan` เป็นค่าตัวอย่าง แก้ให้ตรงกับ LINE OA จริง (มี 2 จุดใน `site/public/index.html` และตั้งในหลังบ้าน → ตั้งค่า)
- ราคาเป็นราคาตั้งต้น รอผลสำรวจคู่แข่งและผลนัดทดลอง
- ต้องได้คำตอบจาก สบส. (1426) และสำนักงานเขตเรื่องใบอนุญาตก่อนเปิดรับเงิน

## Deploy

ดูขั้นตอนทั้งหมดใน `site/DEPLOY.md` (สร้าง D1, ใส่ id ใน `site/wrangler.toml`, ตั้ง secret `ADMIN_PASSWORD`/`SESSION_SECRET`)
Workflow `.github/workflows/deploy-paiduaygan.yml` รันเมื่อกดเอง (workflow_dispatch) และจะเห็นปุ่ม Run ก็ต่อเมื่อไฟล์นี้อยู่บน branch หลักแล้ว
ใช้ secret `CLOUDFLARE_API_TOKEN` ตัวเดียวกับเว็บ Iceland แต่ต้องมีสิทธิ์ D1 เพิ่ม
