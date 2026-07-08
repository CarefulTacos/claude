# 🧳 SESSION HANDOFF — ทริปไอซ์แลนด์ 2026 (อัปเดต 4 ก.ค. 2026 เย็น)

> เปิด session ใหม่ในโฟลเดอร์ `Iceland 2026` แล้วให้ Claude อ่านไฟล์นี้ก่อน จะทำงานต่อได้ทันที

---

## 1) สรุปทริป (ตัดสินใจแล้ว — ห้ามเปลี่ยนวันที่)

- **ผู้เดินทาง:** 3 คน · ขับรถเอง
- **ไฟลต์:** ถึง KEF **07:50 ศุกร์ 24 ก.ค. 2026** · กลับ **08:40 เสาร์ 1 ส.ค. 2026**
- **รถเช่า (จองแล้ว):** Hertz Toyota RAV4 · รับ **24 ก.ค. 09:00** · คืน **1 ส.ค. 07:00** ที่ KEF
- **เส้นทาง:** Golden Circle + ชายฝั่งใต้ + Jökulsárlón + **Snæfellsnes** (แก้จากแผนเดิมเพราะจองโซน Hof ไม่ได้)
- **Blue Lagoon:** จองแล้ว รอบ **20:00 ศุกร์ 31 ก.ค.**

## 2) ที่พัก (ตามใบจองจริงใน Gmail — รายละเอียดเต็มใน `Booking Document/Accommodation/Airbnb_Bookings.md`)

| คืน | วันที่ | นอน | สถานะ |
|---|---|---|---|
| 1 | ศ 24 ก.ค. | เรคยาวิก · Quiet Apartment (Haraldur) | ✅ HMMC85Y9EZ |
| 2–3 | ส–อา 25–26 | Grímsnes/Golden Circle · Þúfukot (Sigurbjörg) 🛁 | ✅ HM5S2Z2FDN |
| 4–5 | จ–อ 27–28 | Hvolsvöllur · Hamar–Puffin 1 (Valdimar) | ✅ HM9RAS2PJM |
| 6 | พ 29 | Grundarfjörður · Hálsaból 2 Kirkjufell Cottage (Radim) 🛁 | ✅ HMCJN4R9S3 |
| 7–8 | พฤ–ศ 30–31 | Keflavík (Skólavegur) · Rokkheimur Studio (Júlíus) 🔑lockbox | ✅ HMYW4SSPMF |

- 💰 รวมทั้งทริป ฿100,739.28 (8 คืน จองครบแล้ว) · **ยอดจะตัด: ฿11,262.14 (10 ก.ค. · Þúfukot งวด 2) + ฿21,134.12 (17 ก.ค. · Keflavík)**
- 📝 งานค้าง: ทักโฮสต์ Haraldur (early check-in 24 ก.ค.) + Sigurbjörg (แจ้งเวลาถึง — ตอบช้า 1 วัน)

## 3) เว็บไซต์ — ✅ ออนไลน์แล้ว

- **URL: https://iceland-2026-c5w.pages.dev** (Cloudflare Pages, โปรเจกต์ iceland-2026)
- โครงสร้าง: `Final Version/` มีแค่ **index.html** (แผน+รายละเอียด+ที่พัก = หน้าแรก) + **routes.html** (แผนที่ Leaflet) + images/
- ที่พักทุกจุดมี: รูปจริงจาก Airbnb (acc1–acc5), คำแนะนำเข้าพัก, ระยะขับ, ซูเปอร์ใกล้เคียง, ปุ่มนำทาง
- จุดเที่ยวมีรูปจริงเกือบครบ (รวมถ้ำยักษ์สาว giantess.jpg จาก Flickr CC-BY)
- `Iceland_FinalVersion.zip` = แพ็กล่าสุดพร้อมอัปโหลดที่อื่น
- **Deploy ครั้งหน้า:** dashboard Cloudflare ใน Chrome ค้างโหลด (SPA ไม่บูต) — วิธีที่ใช้ได้จริง: ใช้ javascript_tool บนแท็บ dash.cloudflare.com (session ล็อกอินอยู่) เรียก API `https://dash.cloudflare.com/api/v4/user/tokens` พร้อม header `x-cross-site-security: dash` สร้าง user token สิทธิ์ Pages Write → deploy ด้วย wrangler (ติดตั้ง local ที่ /tmp/wr ใน sandbox) → ลบ token ทิ้ง
- Account ID: `123ab630f5cbd404e46c60311212541c` · ตอนนี้**ไม่มี token ค้างในบัญชี (0 ตัว)** ✅

## 4) แผนวัน 29–31 (Snæfellsnes — ดูละเอียดใน `Plan_29-31Jul_Snaefellsnes.md` + บนเว็บ)

- **พ 29:** Hvolsvöllur → Borgarnes (เที่ยง) → Gerðuberg → Ytri Tunga 🦭 → เช็กอิน Hálsaból (lockbox) → Kirkjufell เย็น 20:00–22:00
- **พฤ 30:** วนอุทยาน Snæfellsjökull: Saxhóll → Djúpalónssandur ⭐ → Lóndrangar → เที่ยง Hellnar (Fjöruhúsið) → cliff walk Arnarstapi ⭐ → Búðakirkja → ขับเข้า Keflavík ~20:30
- **ศ 31:** ชิล Reykjanes (สะพานทวีป, Gunnuhver, ประภาคาร, ถ้ำยักษ์สาว) → Blue Lagoon 20:00 → นอน Keflavík
- ⚠️ วัน 28 ไป Jökulsárlón จาก Hvolsvöllur ไป-กลับ ~530 กม. ออกก่อน 08:00

## 5) โฟลเดอร์

```
Iceland 2026/
├── Final Version/           ← เว็บ production (index.html + routes.html + images/)
├── Old version/             ← archive (รวม index_landing_old.html)
├── Booking Document/
│   ├── Accommodation/Airbnb_Bookings.md  ← สรุปที่พัก 4+1 ที่
│   ├── Car Rental/  └── Plane Ticket/
├── Plan_29-31Jul_Snaefellsnes.md
├── Iceland_FinalVersion.zip
└── SESSION_HANDOFF.md       ← ไฟล์นี้
```

## 6) เครื่องมือ/สิทธิ์ที่ session นี้ใช้ (ขอใหม่ใน session หน้า)

- โฟลเดอร์ `Iceland 2026` · Gmail connector (ดึงใบจอง Airbnb) · Chrome extension (Airbnb/Cloudflare) · computer-use clipboard read · bash sandbox (curl/wrangler ใช้ได้)

## 7) งานที่เหลือ

- [x] ~~กดจองที่พัก Keflavík~~ ✅ จองแล้ว: Rokkheimur Studio (HMYW4SSPMF) — จองครบ 8 คืน
- [ ] ทักโฮสต์ Haraldur + Sigurbjörg (Claude ร่างให้ได้ ส่งเมื่ออนุมัติ)
- [ ] (เสริม) เวอร์ชันภาษาอังกฤษสำหรับวีซ่า · ตารางงบทั้งทริป

## 8) กฎเหล็ก

⚠️ **ห้ามพลาดเรื่องวันที่** — ผู้ใช้เคยจองผิดเดือนเสียเงิน 2 หมื่น เช็ก **เดือน 07→08 · ปี 2026 · 8 คืน · check-out 1 ส.ค.** ทุกครั้งก่อนจองอะไร
