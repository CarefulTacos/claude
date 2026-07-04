# 📘 Playbook — ย้ายโปรเจกต์ขึ้น Claude Code Web + ตั้ง Auto-deploy Cloudflare Pages

> บันทึกจาก session ที่ย้ายเว็บ Iceland 2026 เข้ามาใน repo `CarefulTacos/claude` และตั้ง auto-deploy สำเร็จ
> ใช้เป็นแบบแผนทำซ้ำกับโปรเจกต์อื่นได้เลย

---

## ส่วนที่ 1 — วิธีใช้ Repo บน Claude Code Web

### 1.1 สภาพแวดล้อมเป็นแบบ ephemeral (ชั่วคราว)
- Container ถูกสร้างใหม่ทุก session · repo ถูก clone สดตอนเริ่ม · ถูกเก็บคืนเมื่อ idle
- **อะไรที่อยากเก็บ = ต้อง `commit` + `push` เท่านั้น** ไฟล์ในเครื่องหายหมดเมื่อ session จบ
- ทำงานบน **designated branch** ที่ระบบกำหนด (เช่น `claude/<ชื่อ>-<hash>`) ไม่ push ทับ default โดยไม่ได้รับอนุญาต

### 1.2 ถ้าไฟล์โปรเจกต์ต้นฉบับอยู่ "ที่อื่น" (ไม่ได้อยู่ใน repo)
บ่อยครั้งไฟล์จริงอยู่ใน session เดิม/เครื่อง/คลาวด์ ซึ่งเข้าไม่ถึงจาก session ใหม่ → ต้องดึงจากแหล่งที่ยัง live อยู่:

| แหล่ง | วิธีดึง | เหมาะกับ |
|---|---|---|
| **เว็บที่ deploy อยู่** (เช่น Cloudflare Pages) | `curl` โหลด HTML + assets โดยตรง | ✅ **source of truth ล่าสุด** (สะท้อน deploy ล่าสุด) |
| Google Drive (connector) | `search_files` / `download` | ระวังเป็นเวอร์ชันเก่า — ใช้เป็น backup เท่านั้น |
| Gmail (connector) | ดึงใบจอง/ข้อมูล | ข้อมูลอ้างอิง ไม่ใช่โค้ด |

**เทคนิคดึงเว็บทั้งชุดด้วย curl:**
```bash
# 1) โหลด HTML หลัก
curl -sSL -o index.html   https://<site>/index.html
curl -sSL -o routes.html  https://<site>/routes.html
# 2) หา asset ที่อ้างถึงใน HTML แล้ววนโหลด
imgs=$(grep -ohiE 'images/[a-zA-Z0-9._-]+\.(jpg|png|webp|svg)' *.html | sort -u)
for img in $imgs; do curl -sSL -o "$img" "https://<site>/$img"; done
# 3) verify: file * | grep -v image   → ต้องเป็นรูปจริงทั้งหมด ไม่ใช่หน้า error
```
> ⚠️ ข้อควรระวัง: curl โหลดได้แต่ "เวอร์ชันที่ deploy ล่าสุด" — ถ้าในเครื่องเดิมเคยแก้แล้วยังไม่ deploy ส่วนนั้นจะไม่ตามมา

### 1.3 Git workflow ที่ใช้
```bash
git add -A
git commit -m "ข้อความสื่อความหมาย"
# push พร้อม retry (เผื่อ network สะดุด)
for i in 1 2 3 4; do git push -u origin <branch> && break; sleep $((2**i)); done
```

### 1.4 เครื่องมือที่มีบน session Web (สำคัญต่อการ deploy)
- ✅ bash sandbox: `curl`, `node`/`npm`/`npx`, ติดตั้ง package ได้ (เช่น wrangler, playwright-core)
- ✅ GitHub ผ่าน **MCP tools** (`mcp__github__*`) — ไม่มี `gh` CLI
- ✅ Chromium + Playwright (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`) render/ screenshot ตรวจงานได้
- ❌ **ไม่มี** browser ล็อกอิน dashboard / computer-use / clipboard เหมือน session เดสก์ท็อป
- ⚠️ browser ใน sandbox ต่อ **internet ภายนอกไม่ได้** (โหลดได้แค่ไฟล์ `file://` ในเครื่อง) — ใช้ `curl` ตรวจเว็บ live แทน

---

## ส่วนที่ 2 — ปัญหา Wrangler / Cloudflare Pages และวิธีแก้

### 2.1 โจทย์
อยากให้แก้เว็บแล้วขึ้น Cloudflare Pages ได้ — แต่ session Web:
- ❌ ไม่มี `CLOUDFLARE_API_TOKEN` เก็บไว้ · ไม่มี wrangler ติดตั้ง
- ❌ ไม่มี browser ล็อกอิน dash.cloudflare.com (วิธีมินต์ token ผ่าน dashboard แบบ session เดิมทำไม่ได้)
- 🔒 การ deploy = ต้อง auth เข้าบัญชี Cloudflare → **ข้ามกำแพงนี้เองไม่ได้ ต้องได้ credential จากผู้ใช้**

### 2.2 ข้อจำกัดสำคัญที่ต้องรู้ก่อนเลือกวิธี
> **Cloudflare Pages project ที่สร้างแบบ "Direct Upload" (deploy ด้วย wrangler) แปลงเป็น "Git-connected" ไม่ได้**

ดังนั้นถ้าจะใช้ Git integration แบบ native ของ Cloudflare = ต้องสร้าง project ใหม่ = **URL เปลี่ยน** (เสีย URL เดิม)

### 2.3 ✅ ทางออกที่เลือก — GitHub Actions + wrangler-action (คง URL เดิม)
Deploy เข้า project **เดิม** ทุกครั้งที่ push โดยไม่ต้องแตะ token ซ้ำ · token เก็บเป็น **GitHub Secret** (ปลอดภัยกว่าวางในแชต)

**ไฟล์ `.github/workflows/deploy.yml`:**
```yaml
name: Deploy to Cloudflare Pages
on:
  push:
    branches: [ main, <designated-branch> ]
    paths: [ 'Final Version/**' ]     # trigger เฉพาะเมื่อเนื้อหาเว็บเปลี่ยน
  workflow_dispatch: {}               # สั่งรันมือได้
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, deployments: write }
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: <ACCOUNT_ID>     # account id ไม่ใช่ความลับ ใส่ inline ได้
          command: pages deploy "<build-output-dir>" --project-name=<project> --branch=main
```
หลักการ:
- `--branch=main` = บอก Cloudflare ว่าให้เป็น **production deployment** (ขึ้น URL หลัก) แม้ commit จะอยู่บน branch อื่น
- `"<build-output-dir>"` = โฟลเดอร์เว็บ (ของเราคือ `Final Version` — มีเว้นวรรค ต้องใส่ quote)
- static site ไม่มี build step → ไม่ต้องใส่ build command

### 2.4 ขั้นตอนที่ "ผู้ใช้ต้องทำเอง" ครั้งเดียว (ผู้ช่วยทำแทนไม่ได้)
1. สร้าง **API Token** (ไม่ใช่ Global API Key) ที่ https://dash.cloudflare.com/profile/api-tokens
   - Create Custom Token → สิทธิ์ **Account · Cloudflare Pages · Edit**
     (บนมือถือ UI ใหม่ ถ้าหา permission เป๊ะยาก เลือก preset **"Developer Services"** ก็ได้ — รวม Pages:Edit)
   - **Token expiration:** No expiration (เพื่อใช้ต่อเนื่อง) · **Client IP filtering:** เว้นว่าง (Actions รันจาก IP หลากหลาย)
   - UI ใหม่ (breadcrumb "Account API tokens") **ไม่มีขั้น Account Resources แยก** — ผูกกับบัญชีอัตโนมัติ
2. เอา token ไปใส่เป็น **GitHub Actions secret**:
   `https://github.com/<owner>/<repo>/settings/secrets/actions/new`
   - Name: `CLOUDFLARE_API_TOKEN` (สะกดเป๊ะ) · Secret: วาง token

### 2.5 การสั่ง deploy + ตรวจผล (ทำผ่าน MCP ได้หมด)
```
# สั่งรัน workflow มือ (ครั้งแรก)
mcp__github__actions_run_trigger  method=run_workflow  workflow_id=deploy.yml  ref=<branch>
# ดูสถานะ
mcp__github__actions_list  method=list_workflow_runs  resource_id=deploy.yml
# ดู log ตอน fail
mcp__github__get_job_logs  run_id=<id>  failed_only=true  return_content=true
# re-run เฉพาะ job ที่ fail
mcp__github__actions_run_trigger  method=rerun_failed_jobs  run_id=<id>
```
**ยืนยันเว็บ live ด้วย curl (browser ใน sandbox ต่อเน็ตนอกไม่ได้):**
```bash
cb=$(head -c3 /dev/urandom | od -An -tx1 | tr -d ' ')   # cache-buster
curl -s -o /dev/null -w "%{size_download}" "https://<site>/<asset>?cb=$cb"   # เทียบขนาดไฟล์
curl -s "https://<site>/index.html?cb=$cb" | grep -o "<marker ที่คาดว่าเปลี่ยน>"
```

---

## ส่วนที่ 3 — Gotchas ที่เจอจริง + วิธีแก้

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `it's necessary to set a CLOUDFLARE_API_TOKEN` (deploy fail) | secret เป็นค่าว่าง — ใส่ผิดที่/ผิดชนิด | เช็ก secret อยู่ **Settings → Secrets and variables → Actions → Repository secrets** (ไม่ใช่ Variables / Codespaces / Dependabot) · ชื่อสะกดเป๊ะ แล้ว **rerun_failed_jobs** |
| ใน log ส่วน `with:` ไม่มีบรรทัด `apiToken` | ยืนยันว่า secret มาถึงเป็นค่าว่าง | (เหมือนข้างบน) |
| อยากใช้ Git integration แต่ URL จะเปลี่ยน | project เดิมเป็น Direct Upload | ใช้ GitHub Actions deploy เข้า project เดิมแทน (คง URL) |
| ปุ่ม "Run workflow" (workflow_dispatch) ไม่ขึ้นบน GitHub UI | workflow file ยังไม่อยู่บน **default branch** | สั่งรันผ่าน MCP `run_workflow` (ref=branch) หรือ push แก้ไฟล์ใน path ที่ trigger ได้เลย — push trigger ใช้ workflow ใน branch นั้น |
| deploy โฟลเดอร์ชื่อมีเว้นวรรค | argv พัง | ใส่ quote: `pages deploy "Final Version" ...` |
| push ไฟล์ workflow แล้วยิง run ที่ fail (ยังไม่มี secret) | path ของ workflow อยู่ใน trigger | เอา `.github/workflows/*.yml` ออกจาก `paths:` — ให้ trigger เฉพาะเนื้อหาเว็บ |
| อ่านรูป/ตรวจงานเว็บ | ต้องเห็นภาพจริง | render ด้วย Playwright + `chromium-*/chrome-linux/chrome` แล้ว screenshot (`file://` โหลด local ได้) |
| หา token/secret ในเครื่อง | ระบบบล็อก (credential scan) | อย่าไล่ scan env/config หา secret — ขอจากผู้ใช้ตรงๆ |

---

## สรุปสั้น (TL;DR)
1. **ดึงไฟล์จากเว็บ live ด้วย curl** (ไม่ใช่ Drive ที่อาจเก่า) → commit เข้า repo บน designated branch
2. **deploy ไม่ได้เองเพราะไม่มี credential** — ต้องให้ผู้ใช้สร้าง Cloudflare **API Token (Pages:Edit)** ใส่เป็น GitHub secret `CLOUDFLARE_API_TOKEN`
3. **ตั้ง GitHub Actions + wrangler-action** deploy เข้า project เดิม (Direct Upload) → **คง URL** · push แล้วขึ้น live เอง
4. ตรวจทุกอย่างผ่าน **MCP (Actions) + curl (verify live)** เพราะ browser ใน sandbox ต่อเน็ตนอกไม่ได้
