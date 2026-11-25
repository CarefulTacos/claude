"""Builds templates/pai-duay-gan-operations.xlsx: bookings, assistant payouts, expenses, monthly P&L.
Run: python3 tools/make_workbook.py  (from pai-duay-gan/). Opens fine in Google Sheets (File > Import)."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import FormulaRule
import os

JADE = "1E6A5B"; SOFT = "E3F0EC"; MARI = "FBF0DC"; LINE = "D9E3E0"
HF = Font(bold=True, color="FFFFFF"); HFILL = PatternFill("solid", fgColor=JADE)
INFILL = PatternFill("solid", fgColor="FFFFFF"); CALC = PatternFill("solid", fgColor=SOFT)
thin = Side(style="thin", color=LINE); BOX = Border(top=thin, bottom=thin, left=thin, right=thin)
BAHT = '#,##0'; N = 300  # booking rows prepared

wb = Workbook()

def header(ws, cols, widths, row=1):
    for i, (c, w) in enumerate(zip(cols, widths), 1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font = HF; cell.fill = HFILL; cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 34
    ws.freeze_panes = ws.cell(row=row + 1, column=1)

# --- ตั้งค่า
st = wb.active; st.title = "ตั้งค่า"
header(st, ["แพ็กเกจ", "ชั่วโมงที่รวม", "ราคา (บาท)", "ค่าตอบแทนผู้ช่วย (บาท)"], [22, 14, 14, 24])
pk = [("รายชั่วโมง 3 ชม.", 3, 1170, 600), ("ครึ่งวัน", 4, 1490, 750), ("เต็มวัน", 8, 2690, 1300),
      ("บัตร 5 ครั้ง (ต่อครั้ง)", 4, 1398, 750)]
for r, row in enumerate(pk, 2):
    for c, v in enumerate(row, 1):
        st.cell(row=r, column=c, value=v).number_format = BAHT if c > 2 else "General"
st["F1"] = "ค่าเกินเวลา ต่อ 30 นาที (ลูกค้า)"; st["G1"] = 200
st["F2"] = "ค่าเกินเวลา ต่อ 30 นาที (จ่ายผู้ช่วย)"; st["G2"] = 200
st["F3"] = "ค่ารถเริ่มก่อน 06:30 / ชานเมือง (ต่อรายการ)"; st["G3"] = 200
st["F5"] = "แก้ตัวเลขในช่องขาวได้ ชีตอื่นดึงไปคำนวณเอง"
st.column_dimensions["F"].width = 40; st.column_dimensions["G"].width = 10
for c in ("F1", "F2", "F3"): st[c].font = Font(bold=True)
st["F5"].font = Font(italic=True, color="566664")

# --- ผู้ช่วย
asst = wb.create_sheet("ผู้ช่วย")
header(asst, ["ชื่อเล่น", "ชื่อ-นามสกุล", "เบอร์", "LINE", "เขตที่อยู่", "วันที่ว่าง", "ตรวจประวัติแล้ว", "อบรมแล้ว", "ประกันหมดอายุ", "สถานะ", "หมายเหตุ"],
       [12, 24, 14, 14, 14, 18, 14, 12, 14, 12, 30])
for c, v in enumerate(["ผู้ช่วย A", "(ตัวอย่าง)", "", "", "บางกะปิ", "จ, พ, ศ", "ใช่", "ใช่", None, "พร้อมรับงาน", "แถวตัวอย่าง ลบได้"], 1):
    asst.cell(row=2, column=c, value=v)
dv_yes = DataValidation(type="list", formula1='"ใช่,ไม่ใช่"', allow_blank=True); asst.add_data_validation(dv_yes)
dv_yes.add("G2:H200")
dv_st = DataValidation(type="list", formula1='"พร้อมรับงาน,พัก,เลิกแล้ว"', allow_blank=True); asst.add_data_validation(dv_st); dv_st.add("J2:J200")
for r in range(2, 201): asst.cell(row=r, column=9).number_format = "yyyy-mm-dd"

# --- นัด
bk = wb.create_sheet("นัด", 0)
cols = ["รหัสนัด", "วันนัด", "ผู้จอง", "เบอร์ผู้จอง", "ผู้สูงอายุ", "เขต", "โรงพยาบาล/จุดหมาย", "แพ็กเกจ", "ผู้ช่วย",
        "ส่วนลด %", "ค่าบริการ", "ยอดหลังส่วนลด", "เวลาเกิน (นาที)", "ค่าเกินเวลา", "บวกพิเศษ (ครั้ง)", "ค่าบวกพิเศษ",
        "ค่ารถตามใบเสร็จ", "ยอดรวมเก็บลูกค้า", "สถานะชำระ", "ค่าตอบแทนผู้ช่วย", "จ่ายผู้ช่วยแล้ว", "กำไรขั้นต้น", "เดือน", "รีวิว (1-5)", "หมายเหตุ"]
widths = [11, 12, 16, 13, 16, 12, 22, 20, 12, 9, 11, 12, 11, 11, 10, 11, 12, 13, 13, 13, 11, 12, 9, 9, 28]
header(bk, cols, widths)
for r in range(2, N + 2):
    f = {
        "A": f'=IF(B{r}="","","PDG-"&TEXT(ROW()-1,"0000"))',
        "K": f'=IF(H{r}="","",IFERROR(VLOOKUP(H{r},ตั้งค่า!$A$2:$D$20,3,FALSE),""))',
        "L": f'=IF(K{r}="","",ROUND(K{r}*(1-N(J{r})/100),0))',
        "N": f'=IF(N(M{r})<=0,0,CEILING(M{r}/30,1)*ตั้งค่า!$G$1)',
        "P": f'=N(O{r})*ตั้งค่า!$G$3',
        "R": f'=IF(L{r}="","",L{r}+N{r}+P{r}+N(Q{r}))',
        "T": f'=IF(H{r}="","",IFERROR(VLOOKUP(H{r},ตั้งค่า!$A$2:$D$20,4,FALSE),0)+IF(N(M{r})<=0,0,CEILING(M{r}/30,1)*ตั้งค่า!$G$2))',
        "V": f'=IF(L{r}="","",L{r}+N{r}+P{r}-T{r})',
        "W": f'=IF(B{r}="","",TEXT(B{r},"yyyy-mm"))',
    }
    for col, formula in f.items():
        c = bk[f"{col}{r}"]; c.value = formula; c.fill = CALC
    bk[f"B{r}"].number_format = "yyyy-mm-dd"
    for col in "KLNPQRTV": bk[f"{col}{r}"].number_format = BAHT
# example row
ex = {"B": "2026-12-14", "C": "ตัวอย่าง: คุณเอ", "E": "คุณแม่", "F": "บางกะปิ", "G": "รพ.ตัวอย่าง", "H": "ครึ่งวัน",
      "I": "ผู้ช่วย A", "J": 30, "M": 20, "Q": 320, "S": "ชำระครบ", "U": "ใช่", "X": 5, "Y": "แถวตัวอย่าง ลบได้"}
from datetime import date
for k, v in ex.items():
    bk[f"{k}2"] = date(2026, 12, 14) if k == "B" else v
dv_pk = DataValidation(type="list", formula1="=ตั้งค่า!$A$2:$A$20", allow_blank=True); bk.add_data_validation(dv_pk); dv_pk.add(f"H2:H{N+1}")
dv_as = DataValidation(type="list", formula1="=ผู้ช่วย!$A$2:$A$200", allow_blank=True); bk.add_data_validation(dv_as); dv_as.add(f"I2:I{N+1}")
dv_pay = DataValidation(type="list", formula1='"รอชำระ,ชำระค่าบริการแล้ว,ชำระครบ,ยกเลิก-คืนเงิน"', allow_blank=True); bk.add_data_validation(dv_pay); dv_pay.add(f"S2:S{N+1}")
dv_y = DataValidation(type="list", formula1='"ใช่,ยัง"', allow_blank=True); bk.add_data_validation(dv_y); dv_y.add(f"U2:U{N+1}")
bk.conditional_formatting.add(f"S2:S{N+1}", FormulaRule(formula=[f'S2="รอชำระ"'], fill=PatternFill("solid", fgColor=MARI)))

# --- ค่าใช้จ่าย
ex_ws = wb.create_sheet("ค่าใช้จ่าย")
header(ex_ws, ["วันที่", "รายการ", "หมวด", "จำนวน (บาท)", "เดือน", "หมายเหตุ"], [12, 30, 16, 14, 9, 30])
dv_cat = DataValidation(type="list", formula1='"ใบอนุญาต/ภาษี,ประกัน,การตลาด,เว็บ/ระบบ,อบรม,อุปกรณ์,อื่น ๆ"', allow_blank=True)
ex_ws.add_data_validation(dv_cat); dv_cat.add("C2:C500")
for r in range(2, 501):
    ex_ws[f"A{r}"].number_format = "yyyy-mm-dd"; ex_ws[f"D{r}"].number_format = BAHT
    ex_ws[f"E{r}"] = f'=IF(A{r}="","",TEXT(A{r},"yyyy-mm"))'; ex_ws[f"E{r}"].fill = CALC
ex_ws["A2"] = date(2026, 12, 1); ex_ws["B2"] = "โดเมนและเว็บ (ตัวอย่าง)"; ex_ws["C2"] = "เว็บ/ระบบ"; ex_ws["D2"] = 450

# --- สรุปเดือน
sm = wb.create_sheet("สรุปเดือน", 1)
header(sm, ["เดือน", "จำนวนนัด", "รายได้ค่าบริการ+เกินเวลา", "ค่าผู้ช่วย", "กำไรขั้นต้น", "ค่าใช้จ่ายอื่น", "กำไรสุทธิ", "ค่าเฉลี่ยรีวิว", "ค้างชำระ (นัด)"],
       [10, 10, 22, 13, 13, 14, 13, 13, 13])
months = []
y, m = 2026, 12
for _ in range(24):
    months.append(f"{y}-{m:02d}"); m += 1
    if m == 13: y, m = y + 1, 1
R = f"$2:${N+1}"
for i, mo in enumerate(months, 2):
    sm[f"A{i}"] = mo
    sm[f"B{i}"] = f'=COUNTIFS(นัด!$W$2:$W${N+1},A{i},นัด!$S$2:$S${N+1},"<>ยกเลิก-คืนเงิน")'
    sm[f"C{i}"] = f'=SUMIFS(นัด!$L$2:$L${N+1},นัด!$W$2:$W${N+1},A{i})+SUMIFS(นัด!$N$2:$N${N+1},นัด!$W$2:$W${N+1},A{i})+SUMIFS(นัด!$P$2:$P${N+1},นัด!$W$2:$W${N+1},A{i})'
    sm[f"D{i}"] = f'=SUMIFS(นัด!$T$2:$T${N+1},นัด!$W$2:$W${N+1},A{i})'
    sm[f"E{i}"] = f'=C{i}-D{i}'
    sm[f"F{i}"] = f'=SUMIFS(ค่าใช้จ่าย!$D$2:$D$500,ค่าใช้จ่าย!$E$2:$E$500,A{i})'
    sm[f"G{i}"] = f'=E{i}-F{i}'
    sm[f"H{i}"] = f'=IFERROR(AVERAGEIFS(นัด!$X$2:$X${N+1},นัด!$W$2:$W${N+1},A{i}),"")'
    sm[f"I{i}"] = f'=COUNTIFS(นัด!$W$2:$W${N+1},A{i},นัด!$S$2:$S${N+1},"รอชำระ")'
    for c in "CDEFG": sm[f"{c}{i}"].number_format = BAHT
    sm[f"H{i}"].number_format = "0.0"
t = len(months) + 2
sm[f"A{t}"] = "รวม"; sm[f"A{t}"].font = Font(bold=True)
for c in "BCDEFGI":
    sm[f"{c}{t}"] = f"=SUM({c}2:{c}{t-1})"; sm[f"{c}{t}"].font = Font(bold=True)
    if c in "CDEFG": sm[f"{c}{t}"].number_format = BAHT

# --- จ่ายผู้ช่วย (per assistant per month)
pay = wb.create_sheet("จ่ายผู้ช่วย", 2)
pay["A1"] = "เดือน"; pay["B1"] = months[0]; pay["A1"].font = Font(bold=True); pay["B1"].fill = INFILL
pay["D1"] = "พิมพ์เดือนในช่อง B1 เช่น 2027-01"
pay["D1"].font = Font(italic=True, color="566664")
header(pay, ["ผู้ช่วย", "จำนวนนัด", "ค่าตอบแทนรวม", "จ่ายแล้ว", "ค้างจ่าย"], [16, 10, 14, 12, 12], row=3)
for i in range(4, 34):
    src = i - 2
    pay[f"A{i}"] = f'=IF(ผู้ช่วย!A{src}="","",ผู้ช่วย!A{src})'
    pay[f"B{i}"] = f'=IF(A{i}="","",COUNTIFS(นัด!$I$2:$I${N+1},A{i},นัด!$W$2:$W${N+1},$B$1))'
    pay[f"C{i}"] = f'=IF(A{i}="","",SUMIFS(นัด!$T$2:$T${N+1},นัด!$I$2:$I${N+1},A{i},นัด!$W$2:$W${N+1},$B$1))'
    pay[f"D{i}"] = f'=IF(A{i}="","",SUMIFS(นัด!$T$2:$T${N+1},นัด!$I$2:$I${N+1},A{i},นัด!$W$2:$W${N+1},$B$1,นัด!$U$2:$U${N+1},"ใช่"))'
    pay[f"E{i}"] = f'=IF(A{i}="","",C{i}-D{i})'
    for c in "CDE": pay[f"{c}{i}"].number_format = BAHT

out = os.path.join(os.path.dirname(__file__), "..", "templates", "pai-duay-gan-operations.xlsx")
wb.save(out); print("saved", os.path.abspath(out))
