/**
 * Agent nodes and connections that together trace the outline of Kenya: a
 * mesh, not a map (the border is simplified and the inner nodes are only
 * roughly where towns are). On load, one node turns red once, like a flagged
 * agent, then settles; styles.css turns that off for reduced motion.
 * Decorative: hidden from screen readers.
 */

// Outline nodes first (clockwise from the north-west), then inner nodes.
const nodes: [number, number][] = [
  [61.2, 14.4],
  [82.8, 28.8],
  [118.8, 36],
  [162, 64.8],
  [216, 68.4],
  [259.2, 50.4],
  [298.8, 52.2],
  [266.4, 93.6],
  [266.4, 162],
  [266.4, 226.8],
  [288, 253.8],
  [237.6, 295.2],
  [219.6, 338.4],
  [201.6, 361.8],
  [147.6, 306],
  [82.8, 266.4],
  [14.4, 230.4],
  [14.4, 187.2],
  [36, 151.2],
  [46.8, 64.8],
  [28.8, 28.8],
  [115.2, 241.2],
  [90, 205.2],
  [61.2, 176.4],
  [41.4, 198],
  [216, 210.6],
  [158.4, 111.6],
  [72, 82.8],
  [144, 181.8],
  [178.2, 316.8],
  [232.2, 131.4],
  [122.4, 273.6],
  [104.4, 147.6],
  [194.4, 162],
  [169.2, 252],
];
const OUTLINE = 21;
const edges: [number, number][] = [
  [0, 1],
  [0, 20],
  [1, 2],
  [1, 27],
  [2, 3],
  [2, 27],
  [3, 4],
  [3, 26],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [7, 30],
  [8, 9],
  [8, 30],
  [9, 10],
  [9, 25],
  [10, 11],
  [11, 12],
  [12, 13],
  [12, 29],
  [13, 14],
  [13, 29],
  [14, 15],
  [14, 29],
  [14, 31],
  [14, 34],
  [15, 16],
  [15, 21],
  [15, 31],
  [16, 17],
  [16, 24],
  [17, 18],
  [17, 24],
  [18, 19],
  [18, 23],
  [19, 20],
  [19, 27],
  [21, 22],
  [21, 31],
  [21, 34],
  [22, 23],
  [22, 24],
  [22, 28],
  [22, 32],
  [23, 24],
  [23, 32],
  [25, 33],
  [25, 34],
  [26, 32],
  [26, 33],
  [28, 32],
  [28, 33],
  [30, 33],
  [31, 34],
];
// A few inner nodes in cyan for rhythm; one is the flagged agent.
const CYAN = new Set([21, 26, 30]);
const FLAGGED = 25;

export function KenyaMesh({ className = "" }: { className?: string }) {
  const [fx, fy] = nodes[FLAGGED];
  return (
    <svg
      className={`kenya-mesh ${className}`}
      viewBox="0 0 310 372"
      aria-hidden="true"
      focusable="false"
    >
      <g className="kenya-mesh-links">
        {edges.map(([a, b]) => {
          const onOutline = a < OUTLINE && b < OUTLINE;
          return (
            <line
              key={`${a}-${b}`}
              x1={nodes[a][0]}
              y1={nodes[a][1]}
              x2={nodes[b][0]}
              y2={nodes[b][1]}
              className={onOutline ? "kenya-mesh-border" : undefined}
            />
          );
        })}
      </g>
      {nodes.map(([x, y], index) =>
        index === FLAGGED ? null : (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={index < OUTLINE ? 3.4 : 5.2}
            className={
              index < OUTLINE
                ? "kenya-mesh-edge-node"
                : CYAN.has(index)
                  ? "kenya-mesh-node kenya-mesh-node-cyan"
                  : "kenya-mesh-node"
            }
          />
        ),
      )}
      <circle className="kenya-mesh-ring" cx={fx} cy={fy} r={7} />
      <circle
        className="kenya-mesh-node kenya-mesh-flag"
        cx={fx}
        cy={fy}
        r={6.2}
      />
    </svg>
  );
}
