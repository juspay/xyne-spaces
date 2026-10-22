import re, json, sys
# argv[1]: the shared package's schema.ts in a checkout of juspay/xyne-spaces.
src = open(sys.argv[1]).read()
Q = r"['\"]"
def strs(s): return re.findall(r"['\"]([^'\"]+)['\"]", s)

tables = {}; var_to_name = {}; order = []
for m in re.finditer(r"export const (\w+) = table\(\s*" + Q + r"([^'\"]+)" + Q, src):
    var, name = m.group(1), m.group(2)
    var_to_name[var] = name; order.append(name)
    start = m.end()
    pk = re.search(r"\.primaryKey\(([^)]*)\)", src[start:])
    body = src[start:start+pk.start()]
    cols = []
    for cm in re.finditer(r"^\s*(\w+):\s*([a-zA-Z]+)(<[^>]*>)?\(\)((?:\.\w+\([^)]*\))*)", body, re.M):
        cols.append((cm.group(1), cm.group(2)))
    tables[name] = {'var': var, 'columns': cols, 'pkey': strs(pk.group(1))}

rels = {}; wide = []
for m in re.finditer(r"relationships\(\s*(\w+),\s*\(\{[^}]*\}\)\s*=>\s*\(\{", src):
    tname = var_to_name[m.group(1)]
    i = m.end(); depth = 1; j = i
    while depth > 0:
        if src[j] == '{': depth += 1
        elif src[j] == '}': depth -= 1
        j += 1
    body = src[i:j]
    out = {}
    for rm in re.finditer(r"(\w+):\s*(one|many)\(", body):
        rname, kind = rm.group(1), rm.group(2)
        k = rm.end(); d = 1; s = k
        while d > 0:
            if body[k] == '(': d += 1
            elif body[k] == ')': d -= 1
            k += 1
        hops = re.findall(r"sourceField:\s*\[([^\]]*)\][^{}]*?destField:\s*\[([^\]]*)\][^{}]*?destSchema:\s*(\w+)", body[s:k-1], re.S)
        hops = [(strs(a), strs(b), var_to_name.get(c, c)) for a, b, c in hops]
        for a, b, _ in hops:
            if len(a) != 1 or len(b) != 1: wide.append((tname, rname, a, b))
        out[rname] = {'kind': kind, 'hops': hops}
    rels[tname] = out

json.dump({'tables': tables, 'rels': rels, 'order': order}, open('app_schema.json', 'w'), indent=1)
print(len(tables), 'tables;', sum(len(v) for v in rels.values()), 'relationships')
print('multi-hop:', [(t, r) for t, rs in rels.items() for r, v in rs.items() if len(v['hops']) != 1])
print('multi-column hops:', wide)
print('column types:', sorted({t for tb in tables.values() for _, t in tb['columns']}))
print('compound pkeys:', [(n, t['pkey']) for n, t in tables.items() if len(t['pkey']) != 1])
print('unresolved dest:', sorted({h[2] for rs in rels.values() for v in rs.values() for h in v['hops'] if h[2] not in tables}))
print('conversations cols:', tables['conversations']['columns'][:6], tables['conversations']['pkey'])

# The Rust catalog (`catalog.rs`) is generated from app_schema.json by the
# companion step kept in the session notes: one `Rel` per relationship
# (table, name, source, dest_table, dest) and one `TABLES` entry per table
# with `number` -> Int, `boolean` -> Bool, `string`/`enumeration`/`json` -> String.
