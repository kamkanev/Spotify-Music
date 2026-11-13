"""Generate a landscape SVG and editable Archi model from model.json (stdlib only)."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from html import escape

HERE = Path(__file__).resolve().parent
MODEL = json.loads((HERE / 'model.json').read_text())
PALETTE = {
    'business': ('#fff2bd', '#96712b', '#fffbec'),
    'application': ('#dceefa', '#367197', '#f2f8fc'),
    'technology': ('#dff0dc', '#4e7850', '#f3f9f1'),
}
NODES = {n['id']: n for n in MODEL['elements']}
RELATIONS = MODEL['relationships']

def center(node):
    x, y, w, h = node['bounds']
    return x + w / 2, y + h / 2

# Human-readable SVG; type captions explicitly identify every ArchiMate element.
svg = ['''<svg xmlns="http://www.w3.org/2000/svg" width="2640" height="1380" viewBox="0 0 2640 1380" role="img" aria-labelledby="title description">
<title id="title">Music Room — layered ArchiMate architecture</title>
<desc id="description">Landscape view of the business, application and technology layers. Yellow: user and music-library activities. Blue: Express application, library records and external Spotify integration. Green: browser, Docker services and persistent MySQL data.</desc>
<defs>
  <marker id="serving" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,1 L10,6 L1,11" fill="none" stroke="#475569" stroke-width="1.8"/></marker>
  <marker id="realization" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,1 L12,7 L1,13 Z" fill="white" stroke="#475569" stroke-width="1.6"/></marker>
  <marker id="assignment" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,1 L10,6 L1,11 Z" fill="#475569"/></marker>
  <marker id="assigned" markerWidth="9" markerHeight="9" refX="4" refY="4" markerUnits="userSpaceOnUse"><circle cx="4" cy="4" r="3" fill="#475569"/></marker>
  <marker id="composition" markerWidth="15" markerHeight="12" refX="1" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,6 L7,1 L13,6 L7,11 Z" fill="#475569"/></marker>
  <marker id="access-end" markerWidth="11" markerHeight="11" refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,1 L9,5.5 L1,10" fill="none" stroke="#475569" stroke-width="1.6"/></marker>
  <marker id="access-start" markerWidth="11" markerHeight="11" refX="2" refY="5.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M10,1 L2,5.5 L10,10" fill="none" stroke="#475569" stroke-width="1.6"/></marker>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #1e293b; }
    .heading { font-size: 34px; font-weight: 700; }
    .subtitle { font-size: 17px; fill: #64748b; }
    .layer-title { font-size: 17px; font-weight: 700; letter-spacing: 2px; }
    .type { font-size: 12px; letter-spacing: 0.6px; }
    .name { font-size: 19px; font-weight: 700; }
    .detail { font-size: 13px; fill: #475569; }
    .relation { font-size: 12px; fill: #475569; paint-order: stroke; stroke: white; stroke-width: 5px; stroke-linejoin: round; }
  </style>
</defs>
<rect width="2640" height="1380" fill="#ffffff"/>
<text x="60" y="62" class="heading">MUSIC ROOM</text>
<text x="340" y="62" class="subtitle">Business • application • technology</text>
<text x="60" y="95" class="subtitle">Layered viewpoint · current implementation · Spotify is an external dependency</text>
''']
for layer in MODEL['layers']:
    x,y,w,h = layer['bounds']
    fill, stroke, bg = PALETTE[layer['id']]
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{bg}" stroke="{stroke}" stroke-opacity="0.35"/>')
    svg.append(f'<rect x="{x}" y="{y}" width="10" height="{h}" rx="4" fill="{stroke}"/>')
    svg.append(f'<text x="{x+28}" y="{y+32}" class="layer-title">{escape(layer["name"].upper())}</text>')
# Outer technology node is a real model element; its nesting expresses composition.
for node in MODEL['elements']:
    if not node.get('container'): continue
    x,y,w,h=node['bounds']; fill,stroke,bg=PALETTE[node['layer']]
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" fill-opacity="0.4" stroke="{stroke}" stroke-dasharray="5 4"/>')
    svg.append(f'<text x="{x+18}" y="{y+24}" class="detail">NODE · {escape(node["name"])} — {escape(node.get("detail", ""))}</text>')
# Draw connections before cards so lines cannot obscure element labels.
for rel in RELATIONS:
    if rel.get('hidden'): continue
    points = rel['points']
    d = 'M'+' L'.join(f'{x},{y}' for x,y in points)
    typ=rel['type']; attrs=''
    if typ=='ServingRelationship': attrs='marker-end="url(#serving)"'
    elif typ=='RealizationRelationship': attrs='stroke-dasharray="7 5" marker-end="url(#realization)"'
    elif typ=='AssignmentRelationship': attrs='marker-start="url(#assigned)" marker-end="url(#assignment)"'
    elif typ=='CompositionRelationship': attrs='marker-start="url(#composition)"'
    elif typ=='AccessRelationship':
        attrs='stroke-dasharray="3 5" marker-end="url(#access-end)"'
        if rel.get('accessType')==3: attrs+=' marker-start="url(#access-start)"'
    svg.append(f'<path d="{d}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round" {attrs}/>')
    if 'labelAt' in rel:
        x,y=rel['labelAt'];svg.append(f'<text x="{x}" y="{y}" class="relation">{escape(rel["name"])}</text>')
for node in MODEL['elements']:
    if node.get('container'): continue
    x,y,w,h=node['bounds'];fill,stroke,bg=PALETTE[node['layer']]
    rounded = node['type'].endswith(('Service','Process'))
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{16 if rounded else 3}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    svg.append(f'<text x="{x+14}" y="{y+20}" class="type">{escape(node["typeLabel"].upper())}</text>')
    svg.append(f'<text x="{x+14}" y="{y+47}" class="name">{escape(node["name"])}</text>')
    if node.get('detail'): svg.append(f'<text x="{x+14}" y="{y+68}" class="detail">{escape(node["detail"])}</text>')
    # Standard component tabs and object header line provide additional notation cues.
    if node['type']=='ApplicationComponent':
        svg.append(f'<path d="M{x+w-22},{y+9} h12 v17 h-12 z M{x+w-27},{y+12} h9 v4 h-9 z M{x+w-27},{y+20} h9 v4 h-9 z" fill="{fill}" stroke="{stroke}"/>')
    if node['type'] in ('DataObject','BusinessObject'):
        svg.append(f'<path d="M{x},{y+27} H{x+w}" fill="none" stroke="{stroke}"/>')
svg.append('<text x="60" y="1275" class="layer-title">RELATIONSHIPS</text>')
legend = [('AssignmentRelationship','assigned / deployed',95),('ServingRelationship','serves',550),('RealizationRelationship','realizes',900),('CompositionRelationship','part of',1280),('AccessRelationship','accesses data',1650)]
for typ,label,x in legend:
    marker={'AssignmentRelationship':'assignment','ServingRelationship':'serving','RealizationRelationship':'realization','CompositionRelationship':'composition','AccessRelationship':'access-end'}[typ]
    style='stroke-dasharray="7 5"' if typ in ('RealizationRelationship','AccessRelationship') else ''
    end=f'marker-start="url(#{marker})"' if typ=='CompositionRelationship' else f'marker-end="url(#{marker})"'
    if typ=='AssignmentRelationship':end+=' marker-start="url(#assigned)"'
    svg.append(f'<path d="M{x},1305 H{x+65}" fill="none" stroke="#475569" stroke-width="1.7" {style} {end}/><text x="{x+80}" y="1310" class="detail">{label}</text>')
svg.append('<text x="60" y="1352" class="subtitle">Colour identifies the layer. Solid diamonds denote composition. Database data is persisted; Spotify audio remains on Spotify devices.</text></svg>')
(HERE/'music-room-archimate.svg').write_text('\n'.join(svg))

# Native Archi XML follows the official Archi model test fixtures (model version 5).
XSI='http://www.w3.org/2001/XMLSchema-instance'
ARCHI='http://www.archimatetool.com/archimate'
ET.register_namespace('xsi',XSI);ET.register_namespace('archimate',ARCHI)
root=ET.Element(f'{{{ARCHI}}}model',{'name':'Music Room — Business and Technology Design','id':'id-music-room','version':'5.0.0'})
folders={}
for key,name in [('strategy','Strategy'),('business','Business'),('application','Application'),('technology','Technology & Physical'),('motivation','Motivation'),('implementation_migration','Implementation & Migration'),('other','Other'),('relations','Relations'),('diagrams','Views')]:
    folders[key]=ET.SubElement(root,'folder',{'name':name,'id':'folder-'+key,'type':key})
for node in MODEL['elements']:
    element=ET.SubElement(folders[node['layer']],'element',{f'{{{XSI}}}type':'archimate:'+node['type'],'id':node['id'],'name':node['name']})
    ET.SubElement(element,'documentation').text=node['documentation']
for rel in RELATIONS:
    attrs={f'{{{XSI}}}type':'archimate:'+rel['type'],'id':rel['id'],'name':rel['name'],'source':rel['source'],'target':rel['target']}
    if rel['type']=='AccessRelationship': attrs['accessType']=str(rel.get('accessType',1))
    ET.SubElement(folders['relations'],'element',attrs)
view=ET.SubElement(folders['diagrams'],'element',{f'{{{XSI}}}type':'archimate:ArchimateDiagramModel','name':'Music Room — Landscape Layered View','id':'view-landscape'})
ET.SubElement(view,'documentation').text='Current architecture, left-to-right landscape view. Business yellow; application blue; technology green. Native element notation is rendered by Archi. Nesting in Docker host expresses composition of the two container nodes.'
parents={}
for layer in MODEL['layers']:
    group=ET.SubElement(view,'child',{f'{{{XSI}}}type':'archimate:Group','id':'view-layer-'+layer['id'],'name':layer['name'],'fillColor':PALETTE[layer['id']][2]})
    x,y,w,h=layer['bounds'];ET.SubElement(group,'bounds',{'x':str(x),'y':str(y),'width':str(w),'height':str(h)})
    parents[layer['id']]=(group,x,y)
objects={}
for node in MODEL['elements']:
    parent,px,py=parents.get(node.get('parent'),parents[node['layer']])
    attrs={f'{{{XSI}}}type':'archimate:DiagramObject','id':'view-'+node['id'],'archimateElement':node['id'],'fillColor':PALETTE[node['layer']][0]}
    incoming=['view-'+r['id'] for r in RELATIONS if r['target']==node['id'] and not r.get('hidden')]
    if incoming:attrs['targetConnections']=' '.join(incoming)
    obj=ET.SubElement(parent,'child',attrs)
    x,y,w,h=node['bounds'];ET.SubElement(obj,'bounds',{'x':str(x-px),'y':str(y-py),'width':str(w),'height':str(h)})
    objects[node['id']]=obj
    if node.get('container'):parents[node['id']]=(obj,x,y)
for rel in RELATIONS:
    if rel.get('hidden'):continue
    obj=objects[rel['source']]
    conn=ET.SubElement(obj,'sourceConnection',{f'{{{XSI}}}type':'archimate:Connection','id':'view-'+rel['id'],'source':'view-'+rel['source'],'target':'view-'+rel['target'],'archimateRelationship':rel['id']})
    sx,sy=center(NODES[rel['source']]);tx,ty=center(NODES[rel['target']])
    for x,y in rel['points'][1:-1]:
        ET.SubElement(conn,'bendpoint',{'startX':str(int(x-sx)),'startY':str(int(y-sy)),'endX':str(int(x-tx)),'endY':str(int(y-ty))})
ET.SubElement(root,'purpose').text='Current-state ArchiMate model of Music Room: local music library management, Spotify discovery/playback integration, and Docker/MySQL deployment. See README.md for scope, assumptions and code mapping.'
ET.indent(root,space='  ')
ET.ElementTree(root).write(HERE/'music-room.archimate',encoding='UTF-8',xml_declaration=True)

# Structural validation of generated element, view and relationship references.
ids=[el.attrib['id'] for el in root.iter() if 'id' in el.attrib]
assert len(ids)==len(set(ids)), 'Duplicate XML identifier'
known=set(ids)
for element in root.iter():
    for key in ['source','target','archimateElement','archimateRelationship']:
        if key in element.attrib:assert element.attrib[key] in known,(key,element.attrib[key])
    for target in element.attrib.get('targetConnections','').split():assert target in known
assert MODEL['width']>MODEL['height']
print(f'Generated landscape SVG and Archi model: {len(NODES)} elements, {len(RELATIONS)} relationships. XML references validated.')
