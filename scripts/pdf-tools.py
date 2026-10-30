"""Metadaten, Seitenrendering und strukturelle PDF-Prüfung. Keine PDF/UA-Zertifizierung."""
import sys,json,argparse,hashlib,re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
local=Path(__file__).resolve().parents[1]/'output'/'pdf-qa'
if local.exists():sys.path.insert(0,str(local))
try:import pymupdf
except ImportError:raise SystemExit('PyMuPDF fehlt. Siehe requirements-pdf.txt und README.')
parser=argparse.ArgumentParser();parser.add_argument('--dir',required=True);parser.add_argument('--stamp',action='store_true');args=parser.parse_args()
root=Path(args.dir).resolve();manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'));problems=[];warnings=[];previews=[]
publication=json.loads((root/'moderation/publication.json').read_text(encoding='utf-8'));qr_checks=[];font_checks=set()
for old in root.glob('kontaktbogen-*.png'):old.unlink()
sizes={'A4':(595.28,841.89),'A3':(841.89,1190.55),'A6':(297.64,419.53)}
for item in manifest['files']:
    font_checks=set()
    file=root/item['path'];doc=pymupdf.open(file)
    if args.stamp:
        metadata=doc.metadata;metadata.update(author='Benjamin Hanimann',title=item['kind']+' · Der zweite Blick',subject='Inhaltssnapshot '+manifest['snapshot'],creator='Fake oder nicht fake? · Der zweite Blick');doc.set_metadata(metadata);doc.xref_set_key(doc.pdf_catalog(),'Lang','(de-CH)');doc.saveIncr()
    dimensions=sizes[item['format']]
    if not len(doc):problems.append(f'{item["kind"]}: keine Seiten')
    if item['kind'].startswith('standplakat') or item['kind']=='merkkarte-a6':
        if len(doc)!=1:problems.append(f'{item["kind"]}: {len(doc)} statt einer Seite')
    rendered=root/'previews'/item['kind'];rendered.mkdir(parents=True,exist_ok=True)
    for old in rendered.glob('*.png'):old.unlink()
    current_case=None
    for i,page in enumerate(doc):
        if args.stamp:
            page.insert_font(fontname='CaseMeta',fontfile=str(Path(__file__).resolve().parents[1]/'public/fonts/DejaVuSansMono.ttf'))
            label=f'{manifest["snapshot"]} · {i+1}/{len(doc)}' if item['format']=='A6' else f'{item["kind"]} · {manifest["snapshot"]} · {publication["createdAt"][:10]} · {i+1}/{len(doc)}'
            page.insert_text((25 if item['format']=='A6' else 45,page.rect.height-(14 if item['format']=='A6' else 20)),label,fontname='CaseMeta',fontsize=9,color=(.32,.38,.42))
        if item['kind'] in ['fallblaetter','loesungen','werkstattheft','stationskarten']:
            page_text=page.get_text()
            found=[q for q in publication['cases'] if re.search(re.escape(q['id'])+r'\s*/\s*REV',page_text)]
            if found:current_case=found[0]
            if args.stamp and current_case:
                page.insert_font(fontname='CaseMeta',fontfile=str(Path(__file__).resolve().parents[1]/'public/fonts/DejaVuSansMono.ttf'))
                line=f'{current_case["id"]} / Revision {current_case["revision"]}'
                page.insert_text((45,page.rect.height-34),line,fontname='CaseMeta',fontsize=9,color=(.32,.38,.42))
        if abs(page.rect.width-dimensions[0])>2 or abs(page.rect.height-dimensions[1])>2:problems.append(f'{item["kind"]} Seite {i+1}: falsches Format')
        if len(page.get_text().strip())<30:problems.append(f'{item["kind"]} Seite {i+1}: unerwartet leer')
        spans=[s for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for s in line['spans'] if s['text'].strip()]
        for span in spans:
            if span['size']<8.9:problems.append(f'{item["kind"]} Seite {i+1}: Schrift unter 9 pt')
            rect=pymupdf.Rect(span['bbox'])
            if rect.x0<-1 or rect.x1>page.rect.width+1 or rect.y0<-1 or rect.y1>page.rect.height+1:problems.append(f'{item["kind"]} Seite {i+1}: Text ausserhalb der Seite')
        for info in page.get_image_info():
            box=pymupdf.Rect(info['bbox'])
            if box.width and box.height:
                ppi=min(info['width']/(box.width/72),info['height']/(box.height/72))
                if ppi<150:warnings.append(f'{item["kind"]} Seite {i+1}: Bildauflösung {ppi:.0f} ppi (<150)')
        image=rendered/f'{i+1:02}.png';page.get_pixmap(dpi=150).save(image);previews.append((file,i,item['kind']))
        if publication['join'].get('url') and item['kind'].startswith('standplakat'):
            try:
                import cv2
                decoded,points,_=cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(image)))
                if decoded!=publication['join']['url']:problems.append(f'{item["kind"]}: QR-Ziel nicht korrekt dekodiert')
                qr_checks.append({'document':item['kind'],'matched':decoded==publication['join']['url']})
            except ImportError:problems.append('QR-Prüfung benötigt opencv-python-headless (requirements-pdf.txt).')
        for font in page.get_fonts(full=True):
            xref=font[0]
            if xref in font_checks:continue
            font_checks.add(xref)
            try:
                name,ext,kind,data=doc.extract_font(xref)
                if not data:problems.append(f'{item["kind"]}: Schrift {name} nicht eingebettet')
            except Exception:problems.append(f'{item["kind"]}: Schrift nicht überprüfbar')
        if i==0:page.get_pixmap(dpi=150,colorspace=pymupdf.csGRAY).save(rendered/'graustufen.png')
    if args.stamp:doc.saveIncr()
    item['pages']=len(doc);doc.close();item['bytes']=file.stat().st_size;item['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
contact=pymupdf.open();per=6
for start in range(0,len(previews),per):
    sheet=contact.new_page(width=900,height=920)
    for j,(file,index,title) in enumerate(previews[start:start+per]):
        col,row=j%3,j//3;box=pymupdf.Rect(col*300+8,row*450+23,col*300+292,row*450+430)
        with pymupdf.open(file) as source:sheet.show_pdf_page(box,source,index)
        sheet.insert_text((col*300+10,row*450+15),f'{title} / {index+1}',fontsize=9)
contact.set_metadata({'author':'Benjamin Hanimann','title':'Kontaktbogen · Der zweite Blick','subject':'Inhaltssnapshot '+manifest['snapshot']})
contact.save(root/'kontaktbogen.pdf')
for i,page in enumerate(contact):page.get_pixmap(dpi=110).save(root/f'kontaktbogen-{i+1:02}.png')
contact.close()
manifest['qa']={'renderedPages':len(previews),'renderDpi':150,'problems':sorted(set(problems)),'warnings':sorted(set(warnings)),'visualReview':'pending','physicalPrint':'not-performed','pdfUa':'not-certified','qr':qr_checks if publication['join'].get('url') else 'not-applicable-generic-poster'}
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(manifest["files"])} PDFs · {len(previews)} Seiten bei 150 dpi gerendert. Probleme: {len(set(problems))}, Hinweise: {len(set(warnings))}')
for message in sorted(set(problems+warnings)):print(message)
if problems:sys.exit(1)
