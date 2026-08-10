# Tested scene catalog

Each scene is self-contained Manim Community Edition code designed for the Lens Cairo image. Treat it as a pattern to adapt, not a template to copy blindly. Preserve the runtime boundaries in `SKILL.md` and render only the scene class you use.

## CS: architecture, code, and review

Read [scenes-cs-architecture.py](scenes-cs-architecture.py) for:

- `LayeredArchitecture` — responsibility boundaries across a web system.
- `RequestLifecycle` — a request moving through API, service, and database.
- `LoadBalancing` — traffic fan-out from one entry point to several instances.
- `DependencyGraph` — a focused dependency relationship.
- `CodeReviewFlow` — a small diff becoming an approved change.

## CS: databases and data structures

Read [scenes-cs-data.py](scenes-cs-data.py) for:

- `CacheAside` — hit/miss flow and cache population.
- `DatabaseIndex` — an index narrowing a table lookup.
- `BTreeLookup` — branching toward a target key.
- `TransactionLifecycle` — begin, write, commit/rollback states.
- `QueryPipeline` — scan, filter, join, and result stages.

## CS: networks and distributed systems

Read [scenes-cs-network.py](scenes-cs-network.py) for:

- `DNSResolution` — resolver-to-authoritative lookup path.
- `TCPHandshake` — SYN, SYN-ACK, ACK exchange.
- `RateLimiter` — a bounded token bucket.
- `JobQueue` — producer, queue, workers, and result.
- `EventPipeline` — publish, route, consume, and store.

## Math and probability

Read [scenes-math.py](scenes-math.py) for:

- `VectorProjection`, `FunctionTransform`, `MatrixTransform`, `DerivativeTangent`, and `BayesUpdate`.

## Physics and general science

Read [scenes-science.py](scenes-science.py) for:

- `WaveInterference`, `PendulumEnergy`, `OrbitMechanics`, `GeometryPythagoras`, `SignalSampling`, and `SurfaceLandscape`.

For a long-form video, adapt several patterns into chapter methods in one master `Scene`; do not assume the renderer concatenates separately rendered scene classes.

Read [scenes-long-form.py](scenes-long-form.py) for `FullLesson` and `MechanismPreview`, the executable master-scene and chapter-preview pattern.
