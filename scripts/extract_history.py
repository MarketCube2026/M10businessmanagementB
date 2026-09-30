"""Read PPTX sources without executing document content."""
import sys, zipfile, hashlib, json, re, pathlib, posixpath
import xml.etree.ElementTree as E
NS={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def text(el): return ''.join(t.text or '' for t in el.findall('.//a:t',NS))
def scrub(s):
 s=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]+','[邮箱隐去]',s)
 s=re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)','[电话隐去]',s)
 s=re.sub(r'\bSA\d{7,}\b','[受试者编号隐去]',s)
 return s
def category(title):
 for words,c in [('拜访|沟通会|销售意向|跟进|意向|中标|需求','商务与拜访'),('回款|开票|结算|合同|订单金额|试剂订单','订单与财务'),('稽查|异常|样本|交付|检测流程|进度|分析|文章|手册|质控|timeline|时间线','交付与质量'),('汇总|同比|业绩|占比|销售额','经营快照')]:
  if re.search(words,title,re.I):return c
 return '项目档案'
def extract(file,display=None):
 name=display or file.name
 h=hashlib.sha256(file.read_bytes()).hexdigest()
 line='SR' if name.endswith('-SR.pptx') else 'PB'
 date='2025-10' if '工作总结' in name else '2025-11-19' if 'QLS5316' in name else '2025-06-24' if 'BGB' in name and '研发汇报' in name else '2025-10' if 'BGB' in name and '文章框架' in name else '2023-11-29' if 'FCN-159' in name else '2025-11' if 'JMT101' in name else ''
 out={'name':name,'hash':h,'businessLine':line,'sourceDate':date,'slides':[]}
 with zipfile.ZipFile(file) as z:
  names=sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',n)],key=lambda n:int(re.search(r'slide(\d+)',n).group(1)))
  for name in names:
   page=int(re.search(r'slide(\d+)',name).group(1)); root=E.fromstring(z.read(name))
   paragraphs=[scrub(text(t)) for t in root.findall('.//a:p',NS) if text(t).strip()]
   title=' '.join(paragraphs[:8])[:180]
   tables=[]
   for ti,tbl in enumerate(root.findall('.//a:tbl',NS)):
    rows=[]
    for tr in tbl.findall('a:tr',NS):
     rows.append([scrub(text(tc)).strip() for tc in tr.findall('a:tc',NS)])
    tables.append({'index':ti+1,'rows':rows})
   charts=[]; relfile=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
   rels={}
   if relfile in z.namelist():
    rels={r.attrib['Id']:r.attrib.get('Target','') for r in E.fromstring(z.read(relfile))}
   for c in root.findall('.//c:chart',NS):
    target=rels.get(c.attrib.get('{'+NS['r']+'}id'),'')
    target=posixpath.normpath(posixpath.join(posixpath.dirname(name),target))
    if target in z.namelist():
     chart=E.fromstring(z.read(target))
     for si,series in enumerate(chart.findall('.//c:ser',NS)):
      charts.append({'series':len(charts)+1,'values':[v.text for v in series.findall('.//c:v',NS)]})
   out['slides'].append({'page':page,'title':title,'category':category(title),'text':'\n'.join(paragraphs),'tables':tables,'charts':charts,'imageCount':len(root.findall('.//p:pic',NS))})
 return out
if __name__=='__main__':
 source=pathlib.Path(sys.argv[1]);dest=pathlib.Path(sys.argv[2])
 files=list(source.glob('*.pptx')) if source.is_dir() else [source]
 result=[extract(f,sys.argv[3] if len(sys.argv)>3 else None) for f in files]
 dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'files':len(result),'slides':sum(len(f['slides']) for f in result),'tableRows':sum(len(t['rows']) for f in result for s in f['slides'] for t in s['tables'])}))
