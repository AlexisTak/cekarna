"""Build the Cekarna V2 dossier from cekarna_v2.json into documents/generated."""
from pathlib import Path
from xml.sax.saxutils import escape
import json
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

BASE=Path(__file__).resolve().parent
OUT=BASE.parent/'generated'
OUT.mkdir(exist_ok=True)
DATA=json.loads((BASE/'cekarna_v2.json').read_text(encoding='utf-8'))
for name,file in [('Body','calibri.ttf'),('Bold','calibrib.ttf'),('Italic','calibrii.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
NAVY=colors.HexColor('#132B3A')
TEAL=colors.HexColor('#087E83')
TEXT=colors.HexColor('#253845')
MUTED=colors.HexColor('#526975')
PALE=colors.HexColor('#EAF4F3')
LINE=colors.HexColor('#D8E3E8')
W,H=A4
WIDTH=W-100
styles={
 'p':ParagraphStyle('p',fontName='Body',fontSize=10.5,leading=14.5,textColor=TEXT,spaceAfter=8),
 'h':ParagraphStyle('h',fontName='Bold',fontSize=12,leading=15,textColor=NAVY,spaceBefore=5,spaceAfter=5,keepWithNext=True),
 'title':ParagraphStyle('title',fontName='Bold',fontSize=22,leading=25,textColor=NAVY,spaceAfter=9),
 'lead':ParagraphStyle('lead',fontName='Body',fontSize=11.5,leading=15.5,textColor=MUTED,spaceAfter=13),
 'cell':ParagraphStyle('cell',fontName='Body',fontSize=9.7,leading=12.5,textColor=TEXT),
 'th':ParagraphStyle('th',fontName='Bold',fontSize=9.7,leading=12.5,textColor=colors.white),
 'boxlabel':ParagraphStyle('boxlabel',fontName='Bold',fontSize=9,leading=12,textColor=TEAL,spaceAfter=5),
 'box':ParagraphStyle('box',fontName='Body',fontSize=10.3,leading=14,textColor=NAVY),
 'bullet':ParagraphStyle('bullet',fontName='Body',fontSize=10.5,leading=14.5,textColor=TEXT,leftIndent=10,firstLineIndent=-10,spaceAfter=6),
 'ref':ParagraphStyle('ref',fontName='Body',fontSize=8,leading=11,textColor=MUTED,spaceAfter=3),
}

def q(s):
    return escape(s).replace('&lt;br/&gt;','<br/>')

def draw_frame(docdata):
    def draw(c,doc):
        c.saveState()
        c.setFillColor(NAVY); c.rect(0,H-115,W,115,fill=1,stroke=0)
        c.setFillColor(colors.HexColor('#79D6CA')); c.setFont('Bold',10)
        c.drawString(50,H-28,'CEKARNA  /  DOSSIER STRATÉGIQUE')
        c.setFillColor(colors.white); c.setFont('Bold',25)
        c.drawString(50,H-62,docdata['title'])
        c.setFont('Body',10); c.drawString(50,H-83,docdata['subtitle'])
        c.setFillColor(colors.HexColor('#79D6CA')); c.setFont('Bold',7.4)
        c.drawString(50,H-102,docdata['status'])
        c.setStrokeColor(LINE); c.line(50,43,W-50,43)
        c.setFillColor(MUTED); c.setFont('Body',8)
        c.drawString(50,29,f"{docdata['code']}   ·   V{DATA['version']}   ·   {DATA['date']}")
        c.drawRightString(W-50,29,f"{doc.page} / {len(docdata['pages'])}")
        c.restoreState()
    return draw

def block(b):
    kind=b['type']
    if kind in ('p','h'): return [Paragraph(q(b['text']),styles[kind])]
    if kind=='bullets': return [Paragraph('• '+q(x),styles['bullet']) for x in b['items']]
    if kind=='box':
        inner=[Paragraph(q(b['label']),styles['boxlabel']),Paragraph(q(b['text']),styles['box'])]
        t=Table([[inner]],colWidths=[WIDTH],hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.4,LINE),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
        return [t,Spacer(1,10)]
    if kind=='table':
        n=len(b['headers'])
        widths=[WIDTH*0.26,WIDTH*0.74] if n==2 else [WIDTH*0.23,WIDTH*0.59,WIDTH*0.18]
        rows=[[Paragraph(q(x),styles['th']) for x in b['headers']]]
        rows += [[Paragraph(q(str(x)),styles['cell']) for x in row] for row in b['rows']]
        t=Table(rows,colWidths=widths,hAlign='LEFT',repeatRows=1,splitByRow=0)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F1F5F7'),colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),0.35,LINE)]))
        return [t,Spacer(1,10)]
    if kind=='refs':
        result=[Spacer(1,3)]
        for key in b['keys']:
            s=DATA['sources'][key]
            result.append(Paragraph(f'[{key}] <link href="{escape(s["url"])}" color="#087E83">{q(s["label"])}</link> · consulté le 06/09/2026.',styles['ref']))
        return result
    raise ValueError(kind)

report=[]
for d in DATA['documents']:
    flow=[]
    for i,page in enumerate(d['pages']):
        if i: flow.append(PageBreak())
        flow.append(Paragraph(q(page['title']),styles['title']))
        flow.append(Paragraph(q(page['lead']),styles['lead']))
        for b in page['blocks']: flow.extend(block(b))
    dest=OUT/d['file']
    doc=SimpleDocTemplate(str(dest),pagesize=A4,rightMargin=50,leftMargin=50,topMargin=132,bottomMargin=57,title=f"Cekarna — {d['title']} — V2.0",author='Cekarna',subject=d['subtitle'],pageCompression=1)
    doc.build(flow,onFirstPage=draw_frame(d),onLaterPages=draw_frame(d))
    pdf=PdfReader(dest)
    assert len(pdf.pages)==len(d['pages']), f"Pagination overflow: {d['file']} = {len(pdf.pages)} expected {len(d['pages'])}"
    for i,pg in enumerate(pdf.pages):
        text=pg.extract_text()
        assert d['pages'][i]['title'] in text, (d['file'],i,'title missing')
        assert '\ufffd' not in text, (d['file'],i,'invalid glyph')
    report.append({'file':d['file'],'pages':len(pdf.pages),'bytes':dest.stat().st_size})
print(json.dumps(report,ensure_ascii=False,indent=2))
(OUT/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
