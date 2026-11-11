import sys,glob
from PIL import Image
# planche de controle : sheet.py <prefixe> -> out/_stills/_sheet-<prefixe>.jpg
pre=sys.argv[1]
fs=sorted(glob.glob(f"out/_stills/{pre}-[0-9]*.jpg"))
ims=[Image.open(f) for f in fs]
h=640; ims=[i.resize((int(i.width*h/i.height),h)) for i in ims]
cols=min(len(ims),8 if ims[0].width<h else 4); rows=-(-len(ims)//cols)
W=ims[0].width
s=Image.new("RGB",(cols*W,rows*h),"#888")
for n,i in enumerate(ims): s.paste(i,((n%cols)*W,(n//cols)*h))
s.save(f"out/_stills/_sheet-{pre}.jpg",quality=80)
