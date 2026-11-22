# Uso: python3 tools/mutopia_crawl.py mutopia-raw.json
import urllib.request,re,json,html,time,sys
out=sys.argv[1]
B="https://www.mutopiaproject.org/cgibin/make-table.cgi?startat=%d&searchingfor=&Composer=&Instrument=&Style=&collection=&id=&solo=&recent=&timelength=&timeunit=&lilyversion=&preview="
def cells(t): return [html.unescape(re.sub(r'<[^>]+>','',c)).strip() for c in re.findall(r'<td>(.*?)</td>',t,re.S)]
items=[];start=0
while True:
    for a in range(4):
        try: s=urllib.request.urlopen(B%start,timeout=40).read().decode('utf8','replace');break
        except Exception as e: time.sleep(3)
    tabs=re.findall(r'<table class="table-bordered result-table">(.*?)</table>',s,re.S)
    for t in tabs:
        c=cells(t)
        links=re.findall(r'href="(https://www\.mutopiaproject\.org/ftp/[^"]+)"',t)
        pid=re.search(r'piece-info\.cgi\?id=(\d+)',t)
        lic=c[9] if len(c)>9 else ''
        get=lambda suf:[l for l in links if l.endswith(suf)]
        items.append(dict(id=int(pid.group(1)) if pid else None,title=c[0],composer=re.sub(r'^by ','',c[1]),opus=c[2],
          instrument=re.sub(r'^for ','',c[4]),date=c[5],style=c[6],source=c[8],license=lic,
          pdf=(get('-a4.pdf')+get('-let.pdf')+get('.pdf'))[:1],mid=get('.mid')[:1],zip=get('.zip'),
          preview=get('-preview.png')[:1],ly=get('.ly')[:1],dir=[l for l in links if l.endswith('/')][:1]))
    print(start,len(tabs),file=sys.stderr)
    if 'startat=%d'%(start+10) not in s or not tabs: break
    start+=10; time.sleep(0.6)
json.dump(items,open(out,'w'),ensure_ascii=False)
print(len(items))
