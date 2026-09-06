declare module 'd3-delaunay' {
  export interface VoronoiDiagram {
    /**
     * The cell for the seed at this index, clipped to the requested bounds,
     * or `null` when the seed has no cell inside them.
     */
    cellPolygon(index: number): [number, number][] | null;
  }

  export class Delaunay {
    /**
     * @param points - Flat coordinates: `[x0, y0, x1, y1, ...]`.
     */
    public constructor(points: ArrayLike<number>);

    /** Flat input coordinates. */
    public readonly points: ArrayLike<number>;

    /** Vertex indices, three per triangle. */
    public readonly triangles: ArrayLike<number>;

    /** Point indices along the hull. */
    public readonly hull: ArrayLike<number>;

    /**
     * Present only when every input point lies on one line.
     *
     * @remarks
     * The kernel perturbs such input to produce a triangulation at all, so
     * the presence of this field means the geometry it went on to report was
     * built from points nobody supplied.
     */
    public readonly collinear?: ArrayLike<number>;

    /**
     * @param bounds - `[xmin, ymin, xmax, ymax]`.
     */
    public voronoi(bounds: [number, number, number, number]): VoronoiDiagram;
  }
}
