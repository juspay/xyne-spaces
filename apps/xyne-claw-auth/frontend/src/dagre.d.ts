declare module "@dagrejs/dagre" {
  interface GraphNode {
    x: number;
    y: number;
    [key: string]: unknown;
  }

  interface GraphOptions {
    rankdir?: string;
    nodesep?: number;
    ranksep?: number;
    marginx?: number;
    marginy?: number;
    [key: string]: unknown;
  }

  class Graph {
    setGraph(options: GraphOptions): void;
    setDefaultEdgeLabel(label: () => Record<string, unknown>): void;
    setNode(id: string, attrs: Record<string, unknown>): void;
    hasNode(id: string): boolean;
    setEdge(source: string, target: string): void;
    node(id: string): GraphNode;
  }

  function layout(g: Graph): void;

  export default {
    graphlib: { Graph },
    layout,
  };
}
