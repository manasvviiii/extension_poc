from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
import networkx as nx


app = FastAPI(title="Warm Graph POC")


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


# --------------------------------------------------
# DATA
# --------------------------------------------------

NETWORKS = {}

GRAPH = nx.Graph()


# --------------------------------------------------
# MODELS
# --------------------------------------------------

class Connection(BaseModel):
    name: str
    profile_url: str
    company: Optional[str] = None
    position: Optional[str] = None
    headline: Optional[str] = None
    connection_date: Optional[str] = None
    visible_text: Optional[str] = None
    source: Optional[str] = None


class ImportRequest(BaseModel):
    owner_id: str
    source: str
    connections: List[Connection]


class Relationship(BaseModel):
    person_a: str
    person_b: str
    strength: float = 1.0


class PathRequest(BaseModel):
    banker: str
    target: str


# --------------------------------------------------
# HEALTH
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok"
    }


# --------------------------------------------------
# ORIGINAL STATIC DEMO
# --------------------------------------------------

@app.get(
    "/demo/connections",
    response_class=HTMLResponse
)
def demo_connections():

    return """
    <!doctype html>

    <html>

    <head>
        <meta charset="utf-8">
        <title>Demo My Connections</title>
    </head>

    <body>

        <h1>Demo: My Connections</h1>

        <div class="connection"
             data-profile-url="https://example.com/person-x">

            <strong class="name">
                Person X
            </strong>

            <span class="position">
                CFO
            </span>

            <span class="company">
                Company X
            </span>

            <div>
                Connected on September 15, 2026
            </div>

        </div>


        <div class="connection"
             data-profile-url="https://example.com/person-y">

            <strong class="name">
                Person Y
            </strong>

            <span class="position">
                CEO
            </span>

            <span class="company">
                Company Y
            </span>

            <div>
                Connected on September 14, 2026
            </div>

        </div>


        <div class="connection"
             data-profile-url="https://example.com/person-z">

            <strong class="name">
                Person Z
            </strong>

            <span class="position">
                Partner
            </span>

            <span class="company">
                Company Z
            </span>

            <div>
                Connected on September 13, 2026
            </div>

        </div>

    </body>

    </html>
    """


# --------------------------------------------------
# DYNAMIC DOM TEST PAGE
# --------------------------------------------------

@app.get(
    "/demo/dynamic-connections",
    response_class=HTMLResponse
)
def dynamic_connections():

    return """
    <!DOCTYPE html>

    <html>

    <head>

        <meta charset="UTF-8">

        <title>
            Dynamic Connections Test
        </title>

        <style>

            body {
                font-family: Arial, sans-serif;
                max-width: 700px;
                margin: 40px auto;
                padding-bottom: 100px;
            }

            #status {
                position: sticky;
                top: 0;
                background: white;
                padding: 15px;
                border-bottom: 1px solid #ddd;
                margin-bottom: 20px;
                z-index: 10;
            }

            .connection {
                border: 1px solid #ddd;
                padding: 15px;
                margin: 10px 0;
                border-radius: 8px;
            }

            .connection a {
                font-weight: bold;
                color: #0a66c2;
                text-decoration: none;
            }

        </style>

    </head>


    <body>

        <div id="status">

            Loaded connections:

            <strong id="count">
                0
            </strong>

        </div>


        <div id="connections"></div>


        <script>

            const container =
                document.getElementById(
                    "connections"
                );

            const count =
                document.getElementById(
                    "count"
                );


            let current = 0;

            const total = 300;

            const batchSize = 19;


            function addBatch() {

                const end =
                    Math.min(
                        current + batchSize,
                        total
                    );


                for (
                    let i = current + 1;
                    i <= end;
                    i++
                ) {

                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "connection";


                    card.innerHTML = `

                        <a href="https://www.linkedin.com/in/test-person-${i}">
                            Test Person ${i}
                        </a>

                        <div>
                            Software Developer
                            @ Company ${i}
                        </div>

                        <div>
                            Connected on
                            September
                            ${((i - 1) % 28) + 1},
                            2026
                        </div>

                    `;


                    container.appendChild(card);

                }


                current = end;

                count.textContent = current;


                console.log(
                    "[Dynamic Test] Added batch."
                );

                console.log(
                    "[Dynamic Test] Total:",
                    current
                );

            }


            // First batch
            addBatch();


            // Simulate LinkedIn dynamically
            // rendering more records.

            const interval =
                setInterval(() => {

                    if (
                        current >= total
                    ) {

                        clearInterval(
                            interval
                        );

                        console.log(
                            "[Dynamic Test] Finished."
                        );

                        return;
                    }


                    addBatch();

                }, 2500);

        </script>


    </body>

    </html>
    """


# --------------------------------------------------
# IMPORT NETWORK
# --------------------------------------------------

@app.post("/network/import")
def network_import(req: ImportRequest):

    NETWORKS[req.owner_id] = {
        "source": req.source,

        "connections": [
            c.model_dump()
            for c in req.connections
        ]
    }


    # Add owner/banker node

    GRAPH.add_node(
        req.owner_id,
        type="banker"
    )


    # Add connections

    for connection in req.connections:

        GRAPH.add_node(
            connection.name,

            type="person",

            company=connection.company,

            position=connection.position,

            headline=connection.headline,

            connection_date=connection.connection_date,

            profile_url=connection.profile_url
        )


        GRAPH.add_edge(
            req.owner_id,

            connection.name,

            strength=1.0,

            source=req.source
        )


    return {

        "status": "ok",

        "owner_id": req.owner_id,

        "source": req.source,

        "imported": len(
            req.connections
        )

    }


# --------------------------------------------------
# ADD RELATIONSHIP
# --------------------------------------------------

@app.post("/graph/relationship")
def add_relationship(req: Relationship):

    GRAPH.add_node(
        req.person_a,
        type="person"
    )


    GRAPH.add_node(
        req.person_b,
        type="person"
    )


    GRAPH.add_edge(
        req.person_a,
        req.person_b,

        strength=req.strength
    )


    return {

        "status": "ok",

        "relationship": {

            "from": req.person_a,

            "to": req.person_b,

            "strength": req.strength

        }

    }


# --------------------------------------------------
# FIND WARM PATH
# --------------------------------------------------

@app.post("/graph/path")
def find_warm_path(req: PathRequest):

    if req.banker not in GRAPH:

        raise HTTPException(
            status_code=404,

            detail=
            f"Banker '{req.banker}' not found"
        )


    if req.target not in GRAPH:

        raise HTTPException(
            status_code=404,

            detail=
            f"Target '{req.target}' not found"
        )


    if not nx.has_path(
        GRAPH,
        req.banker,
        req.target
    ):

        return {

            "found": False,

            "message":
            "No path found"

        }


    # Find paths up to 4 hops

    paths = list(
        nx.all_simple_paths(
            GRAPH,
            req.banker,
            req.target,
            cutoff=4
        )
    )


    results = []


    for path in paths:

        strengths = []


        for a, b in zip(
            path,
            path[1:]
        ):

            edge = GRAPH[a][b]

            strengths.append(
                edge.get(
                    "strength",
                    1.0
                )
            )


        # Warmth =
        # product of relationship strengths

        warmth = 1.0


        for strength in strengths:

            warmth *= strength


        results.append({

            "path": path,

            "hops":
                len(path) - 1,

            "warmth":
                round(
                    warmth,
                    4
                )

        })


    results.sort(
        key=lambda x: (
            -x["warmth"],
            x["hops"]
        )
    )


    best = results[0]


    return {

        "found": True,

        "banker":
            req.banker,

        "target":
            req.target,

        "best_path":
            best,

        "alternatives":
            results[:5]

    }


# --------------------------------------------------
# VIEW NETWORK
# --------------------------------------------------

@app.get("/network/{owner_id}")
def network(owner_id: str):

    return NETWORKS.get(

        owner_id,

        {

            "source": None,

            "connections": []

        }

    )


# --------------------------------------------------
# GRAPH SUMMARY
# --------------------------------------------------

@app.get("/graph")
def graph_summary():

    return {

        "nodes":
            GRAPH.number_of_nodes(),

        "edges":
            GRAPH.number_of_edges(),

        "nodes_list": [

            {

                "id": node,

                **data

            }

            for node, data
            in GRAPH.nodes(
                data=True
            )

        ],

        "edges_list": [

            {

                "from": a,

                "to": b,

                **data

            }

            for a, b, data
            in GRAPH.edges(
                data=True
            )

        ]

    }