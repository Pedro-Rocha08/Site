# Uso: python3 tools/mutopia_build.py mutopia-raw.json .   (baixa os MIDIs de teclado e gera data/mutopia.json)
import json,re,sys,os,time,urllib.request
src,site=sys.argv[1],sys.argv[2]
d=json.load(open(src))
FTP='https://www.mutopiaproject.org/ftp/'
KEY=re.compile(r'piano|harpsichord|clavichord|keyboard',re.I)
mdir=os.path.join(site,'assets/mutopia'); os.makedirs(mdir,exist_ok=True)
def rel(u): return u[len(FTP):] if u and u.startswith(FTP) else ''
items=[];credits=[]
for x in sorted(d,key=lambda x:(x['composer'],x['title'])):
    pdf=rel((x['pdf'] or [z for z in x['zip'] if 'pdf' in z.lower()] or [''])[0])
    mid=rel((x['mid'] or [z for z in x['zip'] if 'mid' in z.lower()] or [''])[0])
    local=0
    if x['mid'] and KEY.search(x['instrument']):
        f=os.path.join(mdir,'%d.mid'%x['id'])
        if not os.path.exists(f):
            for a in range(3):
                try:
                    b=urllib.request.urlopen(x['mid'][0],timeout=40).read()
                    if b[:4]==b'MThd': open(f,'wb').write(b)
                    break
                except Exception as e: time.sleep(2)
            time.sleep(0.25)
        if os.path.exists(f):
            local=1; credits.append(x)
    items.append([x['id'],x['title'],x['composer'],x['opus'],x['instrument'],x['style'],x['license'],pdf,mid,local,rel((x['preview'] or [''])[0])])
os.makedirs(os.path.join(site,'data'),exist_ok=True)
json.dump({'source':'Mutopia Project — https://www.mutopiaproject.org/','generated':time.strftime('%Y-%m-%d'),'fields':['id','title','composer','opus','instrument','style','license','pdf','mid','local','preview'],'items':items},
  open(os.path.join(site,'data/mutopia.json'),'w'),ensure_ascii=False,separators=(',',':'))
with open(os.path.join(mdir,'CREDITS.md'),'w') as fh:
    fh.write('# MIDIs do Mutopia Project\n\nEstes arquivos MIDI vêm do [Mutopia Project](https://www.mutopiaproject.org/) e são redistribuídos sem modificação, conforme a licença de cada obra (domínio público ou Creative Commons). O nome do arquivo é o número da peça no Mutopia.\n\n| Arquivo | Obra | Compositor | Edição de origem | Licença | Página |\n|---|---|---|---|---|---|\n')
    for x in sorted(credits,key=lambda x:x['id']):
        c=lambda s:str(s).replace('|','/')
        fh.write('| %d.mid | %s | %s | %s | %s | https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=%d |\n'%(x['id'],c(x['title']),c(x['composer']),c(x['source']),c(x['license']),x['id']))
print(len(items),len(credits))
