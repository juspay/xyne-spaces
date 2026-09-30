# Search (Vespa)

Full-text and vector search over messages, files, mail, tickets, calls and memories. Without it,
every search in the app fails with `Vespa search error: fetch failed`.

- [What gets deployed](#what-gets-deployed)
- [Turn it on](#turn-it-on)
- [How a document becomes searchable](#how-a-document-becomes-searchable)
- [The application package](#the-application-package)
- [Changing the embedding model](#changing-the-embedding-model)
- [Check it works](#check-it-works)
- [Sizing](#sizing)

## What gets deployed

| Piece | Argo CD Application | Runs on | Role |
|---|---|---|---|
| config server | `xyne-vespa` (`vespa-configserver`) | `vespa` pool | holds the application package and hands config to every node; also runs the admin and cluster-controller services |
| content | `xyne-vespa-content` (`vespa-content`) | `vespa` pool | stores and indexes the documents, 200 GiB disk |
| feed | `xyne-vespa-feed` (`vespa-feed:8080`) | `vespa` pool | `/document/v1`: writes documents, embedding their text on the way in |
| search | `xyne-vespa-search` (`vespa-search:8080`) | `vespa` pool | `/search/`: queries, embedding the query text |
| embedder | `xyne-vespa-embedder` (`vespa-embedder:80`) | `gpu` pool | Hugging Face text-embeddings-inference serving `BAAI/bge-base-en-v1.5` (768 dimensions) |
| batch proxy | `xyne-tei-batch-proxy` (`tei-batch-proxy:8080`) | `vespa` pool | splits embedding requests of any size into batches TEI accepts |
| application package | `xyne-vespa-app` | a Job | uploads schemas and topology to the config server after every change |
| ingestion worker | `xyne-worker-<name>` with `ENABLE_VESPA_WORKER` | `general` pool | takes documents off the queue and feeds them |

The backend receives `VESPA_FEED_URL=http://vespa-feed:8080`,
`VESPA_QUERY_URL=http://vespa-search:8080` and
`VESPA_CONFIG_SERVER_URL=http://vespa-configserver:19071`.

## Turn it on

`01-infra.tfvars`:

```hcl
vespa_enabled = true                          # the vespa node pool
gpu_enabled   = true                          # the embedder's GPU node (AWS)
worker_names  = ["default", "vespa-ingestion"]
```

`02-platform.tfvars`:

```hcl
enable_vespa = true

workers = [
  { name = "default" },
  {
    name = "vespa-ingestion"
    env  = { ENABLE_VESPA_WORKER = "true", VESPA_WORKER_QUEUE_NAME = "vespa-ingestion" }
  },
]
```

Then `deployment/scripts/setup.sh --env prod` (both stages: the worker's cloud identity is bound
in `01-infra`). The doctor checks the three prerequisites: the `vespa` pool, a GPU for the
embedder, and a worker with `ENABLE_VESPA_WORKER`.

The first start takes a while: the embedder image is large (about five minutes to pull on AWS), and
on its first boot it compiles
its GPU kernels for the card it finds before `/health` answers. Its startup probe allows 30
minutes for that.

## How a document becomes searchable

```
backend ──queue──► vespa-ingestion worker ──► vespa-feed ──► tei-batch-proxy ──► vespa-embedder (GPU)
                                                   │
                                                   ▼
                                             vespa-content ◄── vespa-search ◄── backend (queries)
```

The feed and search containers call the proxy through Vespa's `openai-embedder` component. The
schemas embed with `embed hf-embedder`, which goes to `/v1/embeddings`; the `embed-file` component
goes to `/v1/embeddings/file`, which the proxy can send to a separate embedder
(`UPSTREAM_FILE_EMBEDDINGS_URL`).

## The application package

Vespa needs its schemas and topology uploaded to the config server before feed and search can
start. The `xyne-vespa-app` chart, at `vespa-core/vespa` in this repository next to the schemas,
does it:

- it renders `services.xml` (feed and query container clusters, both on port 8080, the content
  cluster, admin on the config server) and `hosts.xml` from the replica counts;
- it fills the schemas' `v[DIMS]` placeholder with `embedder.dimensions`;
- a PostSync Job uploads the package to the config server and waits until every service runs
  the new version. It runs again whenever the package changes.

Vespa checks every host name in `hosts.xml` before it accepts a package, so every Vespa pod must
have a resolvable name. The config server and content nodes are named through their headless
Services. Feed and search keep ordinary Services for the backend and get extra headless
`vespa-feed-hosts` and `vespa-search-hosts` Services for their pod names, published before the
pods are ready (they only become ready after the package is deployed).

The config server is outside the Istio mesh and reads feed and search on port 8080 over plain
HTTP, so those two workloads get a PeerAuthentication with port 8080 `PERMISSIVE`; the backend
and workers still use mTLS.

The laptop layout, where one Vespa container embeds in-process, stays in
`vespa-core/vespa/docker/services.xml` and `vespa-core/scripts/deploy-dev.sh`.

## Changing the embedding model

`addons.vespa.embedder.model` and `addons.vespa.embedder.dimensions` (through
`addon_values["vespa"]`) must match the model the embedder serves (`--model-id` in
`addons.vespa.values.embedder.args`). A different model changes the vector size, and Vespa only
accepts a changed tensor type on an empty index: plan a re-index.

## Check it works

```bash
kubectl -n argocd get applications | grep -E 'vespa|tei'
kubectl -n xyne-apps logs job/xyne-vespa-app-deploy | tail -1      # vespa application deployed and converged
kubectl -n xyne-apps exec vespa-configserver-0 -- curl -s \
  http://localhost:19071/application/v2/tenant/default/application/default/environment/prod/region/default/instance/default/serviceconverge \
  | jq .converged                                                  # true
```

An end-to-end test from the backend pod (embed, feed, query, delete):

```bash
kubectl -n xyne-apps exec deploy/xyne-backend -c xyne-backend -- node -e '
const post=(u,b,m="POST")=>fetch(u,{method:m,headers:{"content-type":"application/json"},body:b&&JSON.stringify(b)}).then(r=>r.json().then(j=>[r.status,j]));
(async()=>{
 console.log("embed", (await post("http://tei-batch-proxy:8080/v1/embeddings",{model:"m",input:["hello"]}))[1].data[0].embedding.length);
 const doc="http://vespa-feed:8080/document/v1/e2e/memory/docid/check-1";
 console.log("feed", (await post(doc,{fields:{docId:"check-1",orgId:"e2e",userQuery:"How do I deploy on EKS?"}}))[0]);
 const q=await post("http://vespa-search:8080/search/",{yql:"select docId from memory where {targetHits:5}nearestNeighbor(query_embeddings, e)","input.query(e)":"embed(hf-embedder, \"running on amazon kubernetes\")",ranking:"initial"});
 console.log("vector hits", q[1].root.fields.totalCount);
 console.log("delete", (await post(doc,null,"DELETE"))[0]);
})()'
```

Expected: `embed 768`, `feed 200`, `vector hits 1`, `delete 200`.

## Sizing

| Setting | Default | Through |
|---|---|---|
| Vespa image | `vespaengine/vespa:8.754.14` | `addon_values["vespa"]`: `image.tag` |
| config server disk | 50 GiB | `configserverStorage` |
| content disk | 200 GiB | `contentStorage`, `storageClass` |
| feed and search memory | 8 GiB and 10 GiB | `values.feed.resources`, `values.search.resources` |
| replicas | one of each role | `values.content/feed/search.replicaCount`; the package and `hosts.xml` follow |
| `vespa` pool | `m6i.2xlarge` (AWS), `n2-standard-8` (GCP), `Standard_D8s_v5` (Azure), 1 to 3 | `node_pools.vespa` in `01-infra` |

All four roles fit on one `vespa` node at the defaults. The embedder needs one GPU of its own; on
AWS the GPU pool allows two nodes, which covers the embedder and the OCR model server together.
