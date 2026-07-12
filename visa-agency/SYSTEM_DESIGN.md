# VisaFlow (ชื่อชั่วคราว) — Full System Design: ธุรกิจรับยื่นวีซ่าอัตโนมัติ

> ออกแบบจากผลรีเสิร์ชใน `MARKET_RESEARCH.md` (12 ก.ค. 2026) + สถาปัตยกรรม production
> ที่พิสูจน์แล้วของโปรเจ็คหมอไอย์ (MoreAI) — เป้าหมาย: ระบบครบวงจร Website / LINE OA /
> หลังบ้านจัดการเอกสาร / ระบบรับเงิน ที่ automate ทุกจุดที่กฎหมายและ ToS อนุญาต

---

## 0. หลักการออกแบบ (จากบทเรียนตลาด)

1. **Automation อยู่ฝั่งเราเท่านั้น** — ห้ามยิงบอทใส่ VFS/สถานทูต (ผิด ToS, โดนแบนถาวร)
   ระบบทำ: เก็บเอกสาร, ตรวจความครบ, ร่างคำตอบฟอร์ม, ประเมินเคส, แจ้งเตือน, ติดตามสถานะ
   พนักงานทำ: กรอก/ยื่นบนเว็บทางการด้วยมือ (ระบบเตรียม "draft sheet" ให้ copy ได้ใน 5 นาที)
2. **โปร่งใสฆ่าคู่แข่ง** — ทั้งตลาดซ่อนราคา เราโชว์ทุกบาท + สถานะเรียลไทม์ + สัญญาอัตโนมัติ
3. **Reply-first, human-in-the-loop** — AI รับหน้างาน 24 ชม. แต่การตัดสินใจสำคัญ (ประเมินเคสสุดท้าย, กดยื่น) มีคนตรวจเสมอ เพราะความผิดพลาด = ลูกค้าเสียประวัติวีซ่า
4. **PDPA by design** — consent แยกชัด, เข้ารหัส, TTL ลบอัตโนมัติ, audit log ทุกการเปิดดูเอกสาร
5. **ใช้ของที่พิสูจน์แล้ว** — สแต็คเดียวกับ MoreAI (Worker + Supabase + R2 + LINE + Gemini) ยกโค้ดที่ใช้ซ้ำได้มาเลย ไม่เริ่มจากศูนย์

## 1. ภาพรวมสถาปัตยกรรม

```
                    ┌─────────────────────────────────────────────┐
                    │           Cloudflare Worker (แยก repo ใหม่)   │
 ลูกค้า ──LINE OA──▶│  /webhook   LINE Messaging API dispatcher    │
 ลูกค้า ──เว็บ─────▶│  /           เว็บโปรโมท (SSR, SEO, ราคา, tools)│
 ลูกค้า ──LIFF─────▶│  /liff/*    ฟอร์ม intake + upload + consent  │
 พนักงาน ──────────▶│  /admin/*   หลังบ้าน: case board, doc review │
                    │  /track/:id หน้า track สถานะสาธารณะ (no login)│
                    │  cron: reminder, SLA watchdog, doc-TTL purge │
                    └──────┬──────────┬──────────┬────────────────┘
                           │          │          │
                     Supabase      R2 bucket   Gemini 2.5
                     (Postgres)    เอกสารเข้ารหัส  OCR/สกัดข้อมูล/ประเมินเคส/
                     cases,users,  + generated   ร่างจดหมาย/ตอบแชท
                     payments,     checklists,   (fal.ai fallback แบบ MoreAI)
                     audit_log     contracts(PDF)
                           │
                     EasySlip (ตรวจสลิป PromptPay) + Opn/Pay Solutions (บัตรเครดิต เฟส 2)
```

**ทำไมสแต็คนี้:** ต้นทุนคงที่ ~ไม่กี่ร้อยบาท/เดือน (Worker paid plan + Supabase free→pro),
scale อัตโนมัติ, ทีมเดียวดูแลได้ — พิสูจน์แล้ว 1 ปีบน MoreAI ที่มีผู้ใช้จ่ายเงินจริง

### โมดูลที่ยกมาจาก MoreAI ได้ทันที (ประหยัดงาน ~40%)

| โมดูล MoreAI | ใช้ทำอะไรในโปรเจ็คนี้ |
|---|---|
| `line.ts` (reply-first pipeline, ≤5 msgs/reply, push-quota guard) | โครง LINE OA ทั้งหมด — บทเรียน 300 push/เดือนใช้ตรง ๆ |
| `slip.ts` + EasySlip (fail-closed, dedupe transRef, ตรวจชื่อ/ยอด/บัญชีผู้รับ) | รับเงินมัดจำ/งวดผ่าน PromptPay ต้นทุน 0% |
| `db.ts` (PostgREST บน Worker, best-effort, ไม่มี client lib) | data layer — เปลี่ยนแค่ schema |
| `gemini.ts` (retry 429/5xx + fal.ai fallback + langLead/langSuffix) | AI ทุกจุด: OCR, ประเมินเคส, แชท, ร่างเอกสาร |
| `/admin/stats` pattern (dashboard เดียว, drill-down, `@adm` tagging) | ops dashboard + case board |
| watchdog cron + healthcheck (probe จริง ไม่ใช่ metadata GET) | SLA monitor: เคสค้าง, คิวใกล้หลุด, AI fail-rate |
| ระบบ QA 3 ชั้น (regression.sh gate + E2E จำลอง webhook + watchdog) | มาตรฐาน QA เดียวกันตั้งแต่วันแรก |
| PDPA erase flow (`eraseUserData`) + audit log การเปิดดูแชท | ขยายเป็น document audit + TTL purge |

## 2. Website โปรโมท (SEO-first, conversion ไป LINE)

**เป้า:** ยึดหน้าแรก Google คีย์เวิร์ด "รับยื่นวีซ่า{ประเทศ}" ทุกประเทศหลัก แล้วส่ง traffic เข้า LINE OA

- **หน้า per-ประเทศ** (`/visa/schengen`, `/visa/usa`, `/visa/china`, …): ราคาโชว์ชัด
  (ค่าบริการ + ค่าธรรมเนียมจริง pass-through), เอกสารที่ต้องใช้, timeline, FAQ, ปุ่ม "เริ่มเช็คเคสฟรีใน LINE"
  → คู่แข่งทุกเจ้าซ่อนราคา แค่หน้านี้ก็ต่างแล้ว
- **เครื่องมือฟรีเป็น lead magnet (SEO + แชร์ได้):**
  - เช็คลิสต์เอกสาร generator: ตอบ 5 ข้อ (ประเทศ/อาชีพ/สถานะ/เคยถูกปฏิเสธ?) → เช็คลิสต์ส่วนตัว + ส่งเข้า LINE
  - เครื่องคิดค่าใช้จ่ายรวม (ค่าธรรมเนียม EUR90/MRV$185@32฿ อัปเดตอัตโนมัติ + ค่าศูนย์ + ค่าบริการเรา)
  - "เช็คโอกาสผ่าน" mini-quiz → คะแนนคร่าว ๆ + CTA คุยกับเรา
- **Trust section:** เลข case จริงจากระบบ (อัปเดตอัตโนมัติ), รีวิว, นโยบายคืนเงินเขียนชัด, ป้าย PDPA
- **Content hub:** บทความ/อัปเดตกฎ (ETIAS Q4 2026, EES, US expedite $750 ก.ค.–ธ.ค. 2026) —
  ข่าวพวกนี้เปลี่ยนบ่อย = SEO ได้เรื่อย ๆ; ร่างด้วย AI + คนตรวจ
- เทคนิค: SSR จาก Worker เดียวกัน (แบบ `pages.ts` ของ MoreAI แต่ทำจริงจัง), schema.org
  `Service`+`FAQPage`, Core Web Vitals เขียว, ภาษาไทยหลัก + EN สำหรับ expat ในไทย

## 3. LINE OA — ระบบรับลูกค้า (หัวใจของ funnel)

**Flow ลูกค้าใหม่ (ทุกอย่างใน LINE จบ ไม่ต้องโหลดแอป):**

1. **Add friend** → welcome + rich menu: [เช็คเคสฟรี] [ราคา] [ติดตามเคส] [คุยกับคน]
2. **เช็คเคสฟรี (AI intake):** บอทถามทีละข้อ (ประเทศ, วัตถุประสงค์, อาชีพ/รายได้, ประวัติเดินทาง,
   เคยถูกปฏิเสธไหม) → Gemini ประเมิน → ตอบ **คะแนนเคส + จุดแข็ง/จุดเสี่ยง + ราคา + เอกสารที่ต้องใช้**
   ทันที ฟรี — นี่คือตัวเปลี่ยน lead เป็นลูกค้า และตรงข้ามกับตลาดที่ต้องรอแอดมินตอบ
3. **ตกลงจ้าง:** ระบบสร้างใบเสนอราคา + สัญญา PDF อัตโนมัติ (สิ่งที่ผู้เชี่ยวชาญบน Pantip
   บอกให้ลูกค้าเรียกร้องแต่ไม่มีเจ้าไหนให้) → จ่ายมัดจำผ่าน PromptPay QR → ตรวจสลิปอัตโนมัติ (EasySlip)
4. **ส่งเอกสาร:** LIFF page มี **PDPA consent แยกชัดเจน** (explicit, ไม่ pre-tick — จำเป็นเพราะ
   สำเนาบัตรประชาชนมีศาสนา/หมู่เลือด = sensitive data) → อัปโหลดรูป/PDF ทีละรายการตามเช็คลิสต์
   → **AI ตรวจทันที**: OCR passport MRZ (เช็คอายุเล่ม >6 เดือน), statement ครบ 3/6 เดือนไหม,
   รูปถ่ายเข้าเกณฑ์ไหม, ตัวสะกดชื่อตรงกันทุกใบไหม → ตอบกลับใน 1 นาทีว่าอะไรผ่าน/อะไรต้องแก้
5. **ติดตามสถานะ:** ทุก transition แจ้งใน LINE (ใช้ reply/Flex สวย ๆ; push เท่าที่จำเป็น —
   บทเรียน quota จาก MoreAI) + หน้า `/track/:caseId` แบบ track พัสดุ
6. **หลังจบเคส:** ขอรีวิว (ผ่าน = ขอ Google review, ไม่ผ่าน = โค้ดส่วนลดยื่นรอบ 2 ตามสัญญา)
   + reminder อัตโนมัติก่อนวีซ่า/ETIAS หมดอายุ → repeat business

**AI แชทตอบคำถามทั่วไป 24 ชม.** (ค่าธรรมเนียม, ระยะเวลา, เอกสาร) ด้วย knowledge base ของเรา;
คำถามเชิงเคส/เชิงกฎหมายลึก ๆ → เปิด ticket ให้คนตอบ (แบบ feedback flow ของ MoreAI)

## 4. หลังบ้าน — จัดการเอกสารและเคส (`/admin/*`)

**Case pipeline (state machine):**
`LEAD → QUOTED → PAID_DEPOSIT → COLLECTING_DOCS → DOCS_COMPLETE → REVIEWING →
FORM_DRAFTED → APPOINTMENT_BOOKED → SUBMITTED → RESULT_PASS / RESULT_FAIL → CLOSED`
ทุก transition: timestamp + ผู้กระทำ + แจ้งลูกค้าอัตโนมัติ + นับ SLA

- **Case board (Kanban):** เคสทั้งหมดตามสถานะ, ไฮไลต์เคสค้างเกิน SLA, กรองตามประเทศ/พนักงาน/กำหนดเดินทาง
- **Document review:** เช็คลิสต์ per เคส — ทุกไฟล์มีผล AI pre-check แปะไว้ พนักงานกด ✓/✗ + เหตุผล
  (ปุ่มเดียวส่งข้อความขอเอกสารใหม่เข้า LINE ลูกค้า)
- **Form draft sheet:** AI รวบข้อมูลจากเอกสาร+intake เป็นตารางคำตอบเรียงตามฟอร์มจริง
  (DS-160, Schengen form, COVA) → พนักงานเปิดจอคู่ copy ลงเว็บทางการ **ด้วยมือ** — เร็วเท่าบอทแต่ไม่ผิด ToS
- **Appointment helper:** พนักงานบันทึกคิวที่จองได้ → ระบบ reminder ลูกค้า (T-7, T-1, เช้าวันนัด
  พร้อมเช็คลิสต์ของที่ต้องถือไป + กติกา "พลาดนัดต้องรอ 24 ชม. เลื่อนได้ 2 ครั้ง")
- **Passport custody log:** สแกนรับ-ส่งเล่ม + tracking number — กันข้อครหา "ยึดพาสปอร์ต" ที่ตลาดโดนด่า
- **PDPA console:** ทุกการเปิดดูเอกสารเขียน `audit_log` (แบบ `audit:chatview` ของ MoreAI),
  ปิดเคสแล้ว N วัน (default 90) → cron ลบไฟล์อ่อนไหวอัตโนมัติ เหลือ metadata, ปุ่ม erase ตามคำขอลูกค้า
- **Dashboard ธุรกิจ:** revenue, conversion funnel (add→intake→จ่าย), approval rate ต่อประเทศ,
  aging report, พนักงานคนไหนถือกี่เคส — โครงเดียวกับ `/admin/stats` MoreAI

**Schema หลัก (Supabase):** `users` (line_user_id, ชื่อ, consent timestamps) ·
`cases` (user_id, ประเทศ, ประเภทวีซ่า, สถานะ, คะแนน AI, ราคา, travel_date, assignee) ·
`case_documents` (case_id, ชนิด, r2_key, ai_check_json, สถานะรีวิว) ·
`payments` (case_id, งวด, ยอด, transRef unique, slip r2_key) · `case_events` (audit ทุกอย่าง) ·
`quotes/contracts` · `staff` (role-based: admin/officer/viewer)

## 5. ระบบรับเงิน

- **โครงราคา:** ค่าบริการโชว์ชัดต่อประเทศ + ค่าธรรมเนียมรัฐ pass-through ตามจริง (แบบ Plan-Travel
  แต่โชว์ตัวเลขจริงบนเว็บ) — ตำแหน่งราคา: จีน 1,290฿ / เชงเก้น 3,990฿ / US 6,990฿
  (ต่ำกว่า Quality Express 9,900฿ ราว 30% แต่เหนือ freelance ด้วยระบบ+สัญญา+tracking)
  + tier "Premium" (แปลเอกสาร, จัดตั๋ว/ที่พัก, ซ้อมสัมภาษณ์, door-to-door เอกสาร) สำหรับ margin
- **จ่ายตาม milestone กันความกลัวโดนเท:** มัดจำ 30–50% ตอนเซ็นสัญญา → ส่วนที่เหลือเมื่อเอกสารครบ
  พร้อมยื่น → (ค่าธรรมเนียมรัฐจ่ายตรงตามจริงมีใบเสร็จ)
- **Rails:** เฟส 1 = PromptPay QR + ตรวจสลิป EasySlip (ต้นทุน 0%, โค้ด MoreAI พร้อมใช้ —
  dedupe transRef, ตรวจยอด/บัญชีผู้รับ, fail-closed) · เฟส 2 = Opn/Pay Solutions สำหรับบัตรเครดิต
  (ตั๋วใหญ่/องค์กร/ผ่อน) · ใบเสร็จ/ใบกำกับ PDF อัตโนมัติ
- **Refund ledger:** นโยบายเขียนชัดในสัญญา (เช่น ยกเลิกก่อนยื่นคืน X%, ไม่ผ่านรอบแรก → ยื่นรอบ 2
  ลดค่าบริการ 50% *ไม่ใช่* "การันตีผ่าน") — ทุก refund ลง ledger แบบ coin refund ของ MoreAI

## 6. จุด Automate ทั้งหมด (สรุป)

| ขั้น | Automate | คน |
|---|---|---|
| Lead → ประเมินเคส | AI intake + scoring + ใบเสนอราคา/สัญญา PDF | ตรวจเคสก้ำกึ่งก่อนส่งราคา |
| รับเงิน | ตรวจสลิป, ออกใบเสร็จ, ledger | — |
| เก็บเอกสาร | เช็คลิสต์ per เคส, OCR/MRZ, ตรวจครบ-ถูก, ทวงอัตโนมัติ | สุ่มตรวจ + เคสซับซ้อน |
| กรอกฟอร์ม | ร่าง draft sheet จากข้อมูลจริง | **กรอก/ยื่นเว็บทางการด้วยมือเสมอ** |
| จองคิว | reminder + บันทึกคิว + เตือนกติกา VFS | จองด้วยมือ (ห้ามบอท) |
| ติดตามสถานะ | แจ้งทุก transition + หน้า track | อัปเดตผลจากสถานทูต |
| หลังการขาย | ขอรีวิว, เตือนวีซ่าหมดอายุ, ชวนทริปถัดไป | — |
| Ops | SLA watchdog, AI fail-rate alert, PDPA purge cron | ตอบ alert |

## 7. Go-to-Market — ดึงลูกค้าจากตลาด

1. **SEO ยึดคีย์เวิร์ดราคา:** "รับยื่นวีซ่า{ประเทศ} ราคา" — เราเป็นเจ้าเดียวที่มีหน้าราคาจริง
   ให้ Google index → intent สูงสุด conversion สูงสุด
2. **เครื่องมือฟรี = viral loop:** เช็คลิสต์ generator + เช็คโอกาสผ่าน แชร์ลง กลุ่ม FB
   เที่ยวยุโรป/อเมริกา/ทำวีซ่า (กลุ่มละหลักหมื่น-แสนคน) — ให้คุณค่าก่อนขาย
3. **Content สั้น TikTok/Reels:** "เอกสารที่คนโดนปฏิเสธวีซ่าพลาดบ่อยสุด", "อัปเดตกฎใหม่ ETIAS/EES",
   เคสจริง (ขอ consent) — หมุนจาก knowledge base เดียวกับบอท
4. **Transparency marketing:** ตีตรง pain "โดนเท/โดนโกง/ยึดเล่ม" — แคมเปญ "สัญญาชัด จ่ายเป็นงวด
   เห็นสถานะทุกวัน" + โชว์ approval rate จริงจากระบบ
5. **Referral:** โค้ดส่วนลดให้ทั้งผู้แนะนำ/ผู้ถูกแนะนำ (โครง coin ledger MoreAI รองรับอยู่แล้ว)
6. **B2B:** แพ็คเกจองค์กร (บริษัทส่งพนักงานดูงาน/ทำงาน) — ตลาดที่ Pantip ยืนยันว่ามีดีมานด์และคู่แข่ง
   ยังไม่มีระบบรองรับจริงจัง; ยาวไปถึง partnership บริษัททัวร์/โรงเรียนสอนภาษา/agency เรียนต่อ
7. **Google Reviews + Pantip presence:** ระบบขอรีวิวอัตโนมัติหลังเคสผ่าน — สะสม social proof
   ที่ตลาดนี้ขาด

## 8. Roadmap

**MVP (4–6 สัปดาห์): เจาะ 1–2 ประเทศก่อน (เชงเก้น + จีน — ดีมานด์สูง กติกาชัด ไม่ต้องสัมภาษณ์)**
- เว็บ 5 หน้า (home, เชงเก้น, จีน, ราคา, track) + LINE OA intake + AI scoring
- PromptPay + EasySlip, สัญญา/ใบเสนอราคา PDF, case board + doc review ขั้นต่ำ, PDPA consent + audit
- ระบบ QA 3 ชั้นแบบ MoreAI ตั้งแต่วันแรก (typecheck → deploy → regression → พูดว่าเสร็จ)

**Phase 2 (เดือน 2–3):** US (มี draft DS-160 + ซ้อมสัมภาษณ์ AI), UK/ออสเตรเลีย/เกาหลี K-ETA ·
OCR ครบทุกชนิดเอกสาร · บัตรเครดิต (Opn/Pay Solutions) · referral · SEO content engine

**Phase 3 (เดือน 4+):** B2B portal · แปลเอกสารในระบบ (AI ร่าง + certified translator ตรวจ) ·
บริการเสริม (ประกันเดินทาง, ตั๋ว/ที่พักสำหรับยื่น) · dashboard ลูกค้าองค์กร · ขยายทุกประเทศหลัก

## 9. ความเสี่ยงหลัก + ตัวกัน

| ความเสี่ยง | ตัวกัน |
|---|---|
| โดน VFS มองว่าเป็นบอท | ไม่มี automation ฝั่งเว็บทางการเลย, บัญชีลูกค้าเป็นของลูกค้า, ใช้ช่องทาง group booking ทางการ |
| PDPA (ปรับสูงสุด 5 ล้าน/ครั้ง) | consent แยกชัด, เข้ารหัส, TTL purge, audit log, erase on request — ทำเป็นจุดขายไปเลย |
| AI ประเมินเคสพลาด → ลูกค้าเสียประวัติ | AI เป็น pre-screen เท่านั้น, เคสก้ำกึ่งคนตรวจเสมอ, ไม่เคลม "การันตีผ่าน" |
| กฎเปลี่ยนบ่อย (ETIAS เลื่อน, ค่าธรรมเนียมขึ้น) | knowledge base มี version + `last_verified` date + cron เตือนรีวิวรายเดือน — และทุกการเปลี่ยน = โอกาสทำ content |
| Gemini/quota ล่ม | fal.ai fallback + watchdog + healthcheck (โค้ด MoreAI) |
| คู่แข่งลอกราคาโปร่งใส | moat จริงคือระบบ (AI intake, tracking, PDPA, B2B) ไม่ใช่แค่หน้าเว็บราคา |

---

*เอกสารนี้คือ blueprint สำหรับเริ่มลงมือ — ก่อนเขียนโค้ดจริงควรยืนยัน: ชื่อแบรนด์/OA,
ประเทศ MVP, ตำแหน่งราคาสุดท้าย, และจดทะเบียนนิติบุคคล + บัญชี PromptPay ธุรกิจ*
