from pathlib import Path
from datetime import datetime
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

work=Path(__file__).resolve().parent/'operator'
wb=Workbook(); ws=wb.active; ws.title='Order Payments'
headers=['Sub Order No','Order Date','Payment Date','Supplier SKU','Live Order Status','Quantity','Total Sale Amount (Incl. Shipping & GST)','Total Sale Return Amount (Incl. Shipping & GST)','Final Settlement Amount','TCS','TDS','Shipping Charge (Incl. GST)','Return Shipping Charge (Incl. GST)']
ws.append(['SYNTHETIC OPERATOR AUDIT']); ws.append(headers); ws.append([''])
ws.append(['AUDIT-ORDER-1',datetime(2026,9,1),datetime(2026,9,10),'AUDIT-NECKLACE','Delivered',2,500,0,450,2,1,25,0])
wb.save(work/'meesho-synthetic.xlsx')
(work/'orders-synthetic.csv').write_text('Order Id,Ordered On,SKU,Product,Invoice No.,Invoice Date (mm/dd/yy),Invoice Amount,Selling Price Per Item,Quantity,Order State,HSN CODE\nAUDIT-FK-1,2026-09-01,AUDIT-NECKLACE,Audit Necklace,AUDIT-INV-1,09/01/26,500,250,2,Delivered,7117\n',encoding='utf-8')
pdfmetrics.registerFont(TTFont('AuditFont',r'C:\Windows\Fonts\arial.ttf'))
c=canvas.Canvas(str(work/'supplier-synthetic.pdf')); c.setFont('AuditFont',12)
lines=['Audit Supplier','Party statement','01/09/2026 Purchase AUDIT-BILL-1 Paid ₹ 360.00','# Item name Quantity Price Amount','1 AUDIT-NECKLACE 2 Pcs ₹ 180.00 ₹ 360.00','Total ₹ 360.00']
for i,line in enumerate(lines): c.drawString(50,790-i*24,line)
c.save()
print('Synthetic fixtures created; no real financial data used')
