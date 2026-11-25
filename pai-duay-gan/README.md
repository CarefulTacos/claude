# ไปด้วยกัน (Pai Duay Gan)

บริการผู้ช่วยพาผู้สูงอายุไปหาหมอและทำธุระในกรุงเทพฯ รับถึงบ้าน อยู่ด้วยตลอดนัด ส่งกลับถึงบ้าน

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `site/index.html` | เว็บไซต์หน้าเดียว (ไฟล์เดียว ไม่ต้อง build) ใช้ deploy จริง |
| `site/body.html` | เนื้อหาเดียวกัน แบบที่ใช้แสดงตัวอย่างบน claude.ai |
| `site/terms.html`, `site/privacy.html` | หน้าเงื่อนไขบริการและนโยบายความเป็นส่วนตัว (ร่าง รอนักกฎหมาย) |
| `templates/booking-tracker.csv` | หัวคอลัมน์ชีตติดตามนัด นำเข้า Google Sheets ได้เลย |
| `templates/pai-duay-gan-operations.xlsx` | ไฟล์บริหารนัด ค่าผู้ช่วย ค่าใช้จ่าย และกำไรรายเดือน (มีสูตรคำนวณ) สร้างใหม่ได้ด้วย `python3 tools/make_workbook.py` |
| `assets/out/` | รูป Instagram 6 รูป เมนู LINE ใบปลิว A5 (PDF) การ์ดผู้ช่วย (PDF) และ QR LINE |
| `assets/src/` + `assets/build.js` | ต้นฉบับของรูปทั้งหมด แก้ `assets/config.json` แล้วรัน `npm install && node build.js` เพื่อสร้างใหม่ |

## ต้องแก้ก่อนเปิดเว็บจริง

- LINE ID `@paiduaygan` เป็นค่าตัวอย่าง แก้ให้ตรงกับ LINE OA จริง (มี 2 จุดใน `site/index.html`)
- ราคาเป็นราคาตั้งต้น รอผลสำรวจคู่แข่งและผลนัดทดลอง
- ต้องได้คำตอบจาก สบส. (1426) และสำนักงานเขตเรื่องใบอนุญาตก่อนเปิดรับเงิน

## Deploy

Workflow `.github/workflows/deploy-paiduaygan.yml` รันเองไม่ได้จนกว่าจะกดเอง (workflow_dispatch)
และจะเห็นปุ่ม Run ก็ต่อเมื่อไฟล์นี้อยู่บน branch หลักแล้ว ใช้ secret `CLOUDFLARE_API_TOKEN` ตัวเดียวกับเว็บ Iceland
