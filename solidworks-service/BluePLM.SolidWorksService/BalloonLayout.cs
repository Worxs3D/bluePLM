using System;
using System.Collections.Generic;
using System.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Where new inspection balloons go on a sheet (1.30.0). Pure geometry, no SOLIDWORKS calls, so it
    /// is unit-tested; <c>SolidWorksAPI.BalloonScene.cs</c> fills the scene from the drawing.
    ///
    /// The problem is the cartographers' point-feature label placement problem: every balloon must sit
    /// next to its own characteristic, read as belonging to it, and cover nothing. It is solved the
    /// deterministic way (candidate positions, a cost per position, greedy placement of the most
    /// constrained subject first, then improvement passes), so the same drawing always gets the same
    /// balloons and a re-run never shuffles them.
    ///
    /// Rules, in cost order:
    ///   hard   a balloon never covers text (every annotation's text, tables, title block notes), a
    ///          balloon that stays, another new balloon, or leaves the usable sheet area;
    ///   lines  crossing annotation lines (dimension, extension and leader lines, symbol frames) and
    ///          view geometry (edges, hatching, sheet format lines) costs by the length covered, so the
    ///          result does not depend on how finely an arc was tessellated;
    ///   near   distance from the characteristic's text costs, so a balloon hugs it;
    ///   clear  a balloon closer to another characteristic's text than to its own costs, so no balloon
    ///          reads as belonging to its neighbour;
    ///   side   reading order: after the text (right) first, then above, before (left), below,
    ///          then the corners.
    /// When no position is free the least-bad one is taken; nothing is ever left out.
    /// </summary>
    public static class BalloonLayout
    {
        // Costs, in units of "one balloon diameter of extra distance".
        internal const double HardCost = 1000;
        internal const double AnnotationLineCost = 4.0;   // per diameter of annotation line covered
        internal const double GeometryLineCost = 3.0;     // per diameter of view or format line covered
        internal const double DistanceCost = 1.0;         // per diameter beyond the gap
        internal const double AmbiguityCost = 3.0;        // per diameter closer to a neighbour than to its own
        internal const double AmbiguityMarginD = 0.3;     // own text must be this much nearer than any other
        internal const double SoftAreaCost = 1.5;         // centre inside a soft area

        /// <summary>Gap between a characteristic's text and its balloon, in diameters.</summary>
        internal const double GapD = 0.2;
        /// <summary>Minimum free space around a balloon (to text, lines and other balloons), in diameters.</summary>
        internal const double ClearanceD = 0.08;
        /// <summary>Centre spacing of the balloons of one characteristic, in diameters (just apart).</summary>
        internal const double StackStepD = 1.06;
        /// <summary>Rings of candidates around the text: ring k sits k * RingStepD further out.</summary>
        internal const int Rings = 12;
        internal const double RingStepD = 0.5;
        internal const int ImprovementPasses = 2;

        /// <summary>Axis-aligned box in sheet metres.</summary>
        public readonly struct Box
        {
            public Box(double x1, double y1, double x2, double y2)
            {
                MinX = Math.Min(x1, x2); MaxX = Math.Max(x1, x2);
                MinY = Math.Min(y1, y2); MaxY = Math.Max(y1, y2);
            }
            public double MinX { get; }
            public double MinY { get; }
            public double MaxX { get; }
            public double MaxY { get; }
            public double CentreX => (MinX + MaxX) / 2;
            public double CentreY => (MinY + MaxY) / 2;
            public double Width => MaxX - MinX;
            public double Height => MaxY - MinY;
            public Box Inflate(double d) => new Box(MinX - d, MinY - d, MaxX + d, MaxY + d);
            public static Box Union(Box a, Box b) =>
                new Box(Math.Min(a.MinX, b.MinX), Math.Min(a.MinY, b.MinY), Math.Max(a.MaxX, b.MaxX), Math.Max(a.MaxY, b.MaxY));
            /// <summary>Distance from a point to the box (0 inside).</summary>
            public double DistanceTo(double x, double y)
            {
                var dx = Math.Max(0, Math.Max(MinX - x, x - MaxX));
                var dy = Math.Max(0, Math.Max(MinY - y, y - MaxY));
                return Math.Sqrt(dx * dx + dy * dy);
            }
            public override string ToString() => $"[{MinX:0.####},{MinY:0.####} - {MaxX:0.####},{MaxY:0.####}]";
        }

        public readonly struct Segment
        {
            public Segment(double x1, double y1, double x2, double y2) { X1 = x1; Y1 = y1; X2 = x2; Y2 = y2; }
            public double X1 { get; }
            public double Y1 { get; }
            public double X2 { get; }
            public double Y2 { get; }
            public Box Bounds => new Box(X1, Y1, X2, Y2);
        }

        public readonly struct Circle
        {
            public Circle(double x, double y, double r) { X = x; Y = y; R = r; }
            public double X { get; }
            public double Y { get; }
            public double R { get; }
        }

        /// <summary>Everything already on one sheet that new balloons must respect.</summary>
        public sealed class Scene
        {
            /// <summary>The area balloons must stay inside (the sheet less its border margin).</summary>
            public Box Usable;
            /// <summary>Text boxes of every annotation, table cell and sheet format note. Hard.</summary>
            public readonly List<Box> Text = new List<Box>();
            /// <summary>Balloons that stay (kept BluePLM balloons, the drawing's own balloons). Hard.</summary>
            public readonly List<Circle> Balloons = new List<Circle>();
            /// <summary>Dimension, extension and leader lines, symbol frames, table grid lines.</summary>
            public readonly List<Segment> AnnotationLines = new List<Segment>();
            /// <summary>View edges and hatching, sheet format lines.</summary>
            public readonly List<Segment> GeometryLines = new List<Segment>();
            /// <summary>Text boxes of characteristics that get no new balloon here (their balloon is kept),
            /// so a new balloon does not read as theirs.</summary>
            public readonly List<Box> OtherAnchors = new List<Box>();
            /// <summary>Areas better left free when their lines are unknown (a view whose edges could not
            /// be read is represented by its outline).</summary>
            public readonly List<Box> SoftAreas = new List<Box>();
        }

        /// <summary>One characteristic that needs <see cref="Count"/> new balloons.</summary>
        public sealed class Subject
        {
            public Subject(Box anchor, int count) { Anchor = anchor; Count = count; }
            /// <summary>The characteristic's own text (a dimension's value and tolerance, a GTOL frame, a callout).</summary>
            public Box Anchor { get; }
            /// <summary>Balloons it needs, placed as one row or column in label order.</summary>
            public int Count { get; }
        }

        private enum Side { Right, Top, Left, Bottom, TopRight, BottomRight, TopLeft, BottomLeft }

        private static double SidePenalty(Side s) => s switch
        {
            Side.Right => 0,
            Side.Top => 0.25,
            Side.Left => 0.35,
            Side.Bottom => 0.45,
            Side.TopRight => 0.4,
            Side.TopLeft => 0.55,
            Side.BottomRight => 0.6,
            _ => 0.7,
        };

        private sealed class Candidate
        {
            public (double X, double Y)[] Centres = Array.Empty<(double, double)>();
            public double Static;    // cost against the scene alone
            public double EdgeDistance;
            public double SidePenalty;
        }

        /// <summary>
        /// Centres for every subject's balloons, in subject order and, within a subject, label order.
        /// </summary>
        public static List<(double X, double Y)>[] Place(IReadOnlyList<Subject> subjects, Scene scene, double diameter)
        {
            var result = new List<(double X, double Y)>[subjects.Count];
            if (subjects.Count == 0) return result;
            if (!(diameter > 0)) throw new ArgumentOutOfRangeException(nameof(diameter));

            var index = new SceneIndex(scene, diameter);
            var r = diameter / 2;

            // Every subject's candidates with their cost against the scene (text, kept balloons, lines,
            // distance, side, and nearness to other characteristics).
            var anchors = subjects.Select(s => s.Anchor).Concat(scene.OtherAnchors).ToList();
            var candidates = new List<Candidate>[subjects.Count];
            for (var i = 0; i < subjects.Count; i++)
            {
                var s = subjects[i];
                candidates[i] = Candidates(s, diameter)
                    .Select(c => { c.Static = StaticCost(c, i, s, anchors, scene.SoftAreas, index, scene.Usable, r, diameter); return c; })
                    .OrderBy(c => c.Static)
                    .ToList();
            }

            // Most constrained first (fewest free positions), then top-to-bottom, left-to-right, so the
            // order, and with it the result, depends only on the drawing.
            var order = Enumerable.Range(0, subjects.Count)
                .OrderBy(i => candidates[i].Count(c => c.Static < HardCost))
                .ThenByDescending(i => subjects[i].Anchor.MaxY)
                .ThenBy(i => subjects[i].Anchor.MinX)
                .ThenBy(i => i)
                .ToList();

            var chosen = new Candidate?[subjects.Count];
            foreach (var i in order) chosen[i] = Best(i, candidates[i], chosen, r, diameter);
            for (var pass = 0; pass < ImprovementPasses; pass++)
            {
                var improved = false;
                foreach (var i in order)
                {
                    var current = chosen[i]!;
                    chosen[i] = null;
                    var best = Best(i, candidates[i], chosen, r, diameter);
                    var currentCost = current.Static + PlacedCost(current, chosen, r, diameter);
                    var bestCost = best.Static + PlacedCost(best, chosen, r, diameter);
                    if (bestCost < currentCost - 1e-9) { chosen[i] = best; improved = true; }
                    else chosen[i] = current;
                }
                if (!improved) break;
            }

            for (var i = 0; i < subjects.Count; i++) result[i] = chosen[i]!.Centres.ToList();
            return result;
        }

        private static Candidate Best(int self, List<Candidate> list, Candidate?[] chosen, double r, double d)
        {
            Candidate? best = null;
            var bestCost = double.PositiveInfinity;
            foreach (var c in list)
            {
                // Sorted by static cost: nothing further down can beat the best total any more.
                if (c.Static >= bestCost) break;
                var cost = c.Static + PlacedCost(c, chosen, r, d);
                if (cost < bestCost) { bestCost = cost; best = c; }
            }
            return best ?? list[0];
        }

        /// <summary>Cost against the balloons other subjects already have.</summary>
        private static double PlacedCost(Candidate c, Candidate?[] chosen, double r, double d)
        {
            var min = 2 * r + ClearanceD * d;
            double cost = 0;
            foreach (var other in chosen)
            {
                if (other == null) continue;
                foreach (var (ox, oy) in other.Centres)
                    foreach (var (x, y) in c.Centres)
                    {
                        var dist = Math.Sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy));
                        if (dist < min) cost += HardCost + (min - dist) / d;
                    }
            }
            return cost;
        }

        private static double StaticCost(Candidate c, int self, Subject s, List<Box> anchors, List<Box> softAreas, SceneIndex index, Box usable, double r, double d)
        {
            double cost = 0;
            var clear = r + ClearanceD * d;
            foreach (var (x, y) in c.Centres)
            {
                if (x - r < usable.MinX || x + r > usable.MaxX || y - r < usable.MinY || y + r > usable.MaxY)
                    cost += HardCost + 1;
                cost += index.TextOverlap(x, y, clear, d);
                cost += index.BalloonOverlap(x, y, clear, d);
                cost += AnnotationLineCost * index.AnnotationLineLength(x, y, clear) / d;
                cost += GeometryLineCost * index.GeometryLineLength(x, y, clear) / d;
                foreach (var soft in softAreas)
                    if (soft.DistanceTo(x, y) <= 0) cost += SoftAreaCost;

                // A balloon must be nearer its own text than any other characteristic's text.
                var own = s.Anchor.DistanceTo(x, y);
                for (var a = 0; a < anchors.Count; a++)
                {
                    if (a == self) continue;
                    var other = anchors[a].DistanceTo(x, y);
                    var shortfall = own + AmbiguityMarginD * d - other;
                    if (shortfall > 0) cost += AmbiguityCost * shortfall / d;
                }
            }
            cost += DistanceCost * Math.Max(0, c.EdgeDistance - GapD * d) / d;
            cost += c.SidePenalty;
            return cost;
        }

        /// <summary>
        /// Candidate rows / columns around the anchor box: eight sides, each slid along the box edge in
        /// half-diameter steps, on <see cref="Rings"/> rings moving outward.
        /// </summary>
        private static IEnumerable<Candidate> Candidates(Subject s, double d)
        {
            var r = d / 2;
            var a = s.Anchor;
            var n = Math.Max(1, s.Count);
            var step = StackStepD * d;
            var rowHalf = (n - 1) * step / 2;
            var slide = 0.5 * d;

            for (var k = 0; k <= Rings; k++)
            {
                var o = GapD * d + k * RingStepD * d + r; // anchor edge to first centre
                const double penaltyBase = 0.0;

                // Right / left: a row going outward, slid along the edge; or a column.
                foreach (var side in new[] { Side.Right, Side.Left })
                {
                    var sign = side == Side.Right ? 1 : -1;
                    var edgeX = side == Side.Right ? a.MaxX : a.MinX;
                    foreach (var y in Slides(a.CentreY, a.MinY, a.MaxY, slide))
                    {
                        yield return Make(side, penaltyBase, Row(edgeX + sign * o, y, sign * step, 0, n), a, r);
                        if (n > 1) yield return Make(side, penaltyBase + 0.1, Row(edgeX + sign * o, y + rowHalf, 0, -step, n), a, r);
                    }
                }

                // Top / bottom: a row centred over the edge, slid along it.
                foreach (var side in new[] { Side.Top, Side.Bottom })
                {
                    var sign = side == Side.Top ? 1 : -1;
                    var edgeY = side == Side.Top ? a.MaxY : a.MinY;
                    foreach (var x in Slides(a.CentreX, a.MinX, a.MaxX, slide))
                        yield return Make(side, penaltyBase, Row(x - rowHalf, edgeY + sign * o, step, 0, n), a, r);
                }

                // Corners: diagonal off the corner, the row going outward horizontally.
                var diag = o / Math.Sqrt(2);
                yield return Make(Side.TopRight, penaltyBase, Row(a.MaxX + diag, a.MaxY + diag, step, 0, n), a, r);
                yield return Make(Side.BottomRight, penaltyBase, Row(a.MaxX + diag, a.MinY - diag, step, 0, n), a, r);
                yield return Make(Side.TopLeft, penaltyBase, Row(a.MinX - diag, a.MaxY + diag, -step, 0, n), a, r);
                yield return Make(Side.BottomLeft, penaltyBase, Row(a.MinX - diag, a.MinY - diag, -step, 0, n), a, r);
            }
        }

        /// <summary>The edge centre first, then alternately either side out to the ends.</summary>
        private static IEnumerable<double> Slides(double centre, double min, double max, double step)
        {
            yield return centre;
            var half = (max - min) / 2;
            for (var j = 1; j * step <= half + 1e-12; j++)
            {
                yield return centre + j * step;
                yield return centre - j * step;
            }
        }

        private static (double X, double Y)[] Row(double x, double y, double dx, double dy, int n)
        {
            var c = new (double X, double Y)[n];
            for (var i = 0; i < n; i++) c[i] = (x + i * dx, y + i * dy);
            return c;
        }

        private static Candidate Make(Side side, double extra, (double X, double Y)[] centres, Box anchor, double r)
        {
            var (x, y) = centres[0];
            return new Candidate
            {
                Centres = centres,
                // From the first balloon's edge to the text.
                EdgeDistance = Math.Max(0, anchor.DistanceTo(x, y) - r),
                SidePenalty = SidePenalty(side) + extra,
            };
        }

        // ------------------------------------------------------------------ spatial index

        /// <summary>Uniform grid over the scene so a candidate only looks at what is near it.</summary>
        private sealed class SceneIndex
        {
            private readonly Scene _scene;
            private readonly double _cell;
            private readonly double _ox, _oy;
            private readonly Dictionary<long, List<int>> _text = new Dictionary<long, List<int>>();
            private readonly Dictionary<long, List<int>> _balloons = new Dictionary<long, List<int>>();
            private readonly Dictionary<long, List<int>> _annLines = new Dictionary<long, List<int>>();
            private readonly Dictionary<long, List<int>> _geoLines = new Dictionary<long, List<int>>();
            private readonly int[] _stamp;
            private int _tick;

            public SceneIndex(Scene scene, double diameter)
            {
                _scene = scene;
                _cell = 2 * diameter;
                _ox = scene.Usable.MinX;
                _oy = scene.Usable.MinY;
                for (var i = 0; i < scene.Text.Count; i++) Add(_text, scene.Text[i], i);
                for (var i = 0; i < scene.Balloons.Count; i++)
                {
                    var b = scene.Balloons[i];
                    Add(_balloons, new Box(b.X - b.R, b.Y - b.R, b.X + b.R, b.Y + b.R), i);
                }
                for (var i = 0; i < scene.AnnotationLines.Count; i++) AddSegment(_annLines, scene.AnnotationLines[i], i);
                for (var i = 0; i < scene.GeometryLines.Count; i++) AddSegment(_geoLines, scene.GeometryLines[i], i);
                _stamp = new int[Math.Max(Math.Max(scene.Text.Count, scene.Balloons.Count),
                    Math.Max(scene.AnnotationLines.Count, scene.GeometryLines.Count)) + 1];
            }

            private long Key(int cx, int cy) => ((long)cx << 32) ^ (uint)cy;
            private int Cx(double x) => (int)Math.Floor((x - _ox) / _cell);
            private int Cy(double y) => (int)Math.Floor((y - _oy) / _cell);

            private void Add(Dictionary<long, List<int>> map, Box b, int i)
            {
                // A huge item (a border line) is split by its cells; cap the walk for a malformed one.
                var x0 = Cx(b.MinX); var x1 = Cx(b.MaxX); var y0 = Cy(b.MinY); var y1 = Cy(b.MaxY);
                if ((long)(x1 - x0 + 1) * (y1 - y0 + 1) > 250_000) return;
                for (var cx = x0; cx <= x1; cx++)
                    for (var cy = y0; cy <= y1; cy++)
                    {
                        var k = Key(cx, cy);
                        if (!map.TryGetValue(k, out var list)) map[k] = list = new List<int>();
                        list.Add(i);
                    }
            }

            private void AddSegment(Dictionary<long, List<int>> map, Segment s, int i)
            {
                // Walk the cells along the segment instead of its whole bounding box (a long diagonal
                // would otherwise fill every cell of the box).
                var len = Math.Sqrt((s.X2 - s.X1) * (s.X2 - s.X1) + (s.Y2 - s.Y1) * (s.Y2 - s.Y1));
                var steps = Math.Max(1, (int)Math.Ceiling(len / (_cell / 2)));
                if (steps > 100_000) return;
                var seen = new HashSet<long>();
                for (var j = 0; j <= steps; j++)
                {
                    var t = (double)j / steps;
                    var cx = Cx(s.X1 + (s.X2 - s.X1) * t);
                    var cy = Cy(s.Y1 + (s.Y2 - s.Y1) * t);
                    for (var ddx = -1; ddx <= 1; ddx++)
                        for (var ddy = -1; ddy <= 1; ddy++)
                        {
                            var k = Key(cx + ddx, cy + ddy);
                            if (!seen.Add(k)) continue;
                            if (!map.TryGetValue(k, out var list)) map[k] = list = new List<int>();
                            list.Add(i);
                        }
                }
            }

            private IEnumerable<int> Near(Dictionary<long, List<int>> map, double x, double y, double radius)
            {
                _tick++;
                if (_tick == int.MaxValue) { Array.Clear(_stamp, 0, _stamp.Length); _tick = 1; }
                var x0 = Cx(x - radius); var x1 = Cx(x + radius); var y0 = Cy(y - radius); var y1 = Cy(y + radius);
                for (var cx = x0; cx <= x1; cx++)
                    for (var cy = y0; cy <= y1; cy++)
                    {
                        if (!map.TryGetValue(Key(cx, cy), out var list)) continue;
                        foreach (var i in list)
                        {
                            if (_stamp[i] == _tick) continue;
                            _stamp[i] = _tick;
                            yield return i;
                        }
                    }
            }

            public double TextOverlap(double x, double y, double radius, double d)
            {
                double cost = 0;
                foreach (var i in Near(_text, x, y, radius).ToList())
                {
                    var dist = _scene.Text[i].DistanceTo(x, y);
                    if (dist < radius) cost += HardCost + (radius - dist) / d;
                }
                return cost;
            }

            public double BalloonOverlap(double x, double y, double radius, double d)
            {
                double cost = 0;
                foreach (var i in Near(_balloons, x, y, radius).ToList())
                {
                    var b = _scene.Balloons[i];
                    var dist = Math.Sqrt((x - b.X) * (x - b.X) + (y - b.Y) * (y - b.Y));
                    var min = radius + b.R;
                    if (dist < min) cost += HardCost + (min - dist) / d;
                }
                return cost;
            }

            public double AnnotationLineLength(double x, double y, double radius) =>
                Near(_annLines, x, y, radius).ToList().Sum(i => LengthInside(_scene.AnnotationLines[i], x, y, radius));

            public double GeometryLineLength(double x, double y, double radius) =>
                Near(_geoLines, x, y, radius).ToList().Sum(i => LengthInside(_scene.GeometryLines[i], x, y, radius));
        }

        /// <summary>Length of the part of a segment inside a circle.</summary>
        internal static double LengthInside(Segment s, double cx, double cy, double r)
        {
            var dx = s.X2 - s.X1;
            var dy = s.Y2 - s.Y1;
            var fx = s.X1 - cx;
            var fy = s.Y1 - cy;
            var a = dx * dx + dy * dy;
            if (a < 1e-18) return 0;
            var b = 2 * (fx * dx + fy * dy);
            var c = fx * fx + fy * fy - r * r;
            var disc = b * b - 4 * a * c;
            if (disc <= 0) return 0;
            var sq = Math.Sqrt(disc);
            var t1 = Math.Max(0, (-b - sq) / (2 * a));
            var t2 = Math.Min(1, (-b + sq) / (2 * a));
            return t2 > t1 ? (t2 - t1) * Math.Sqrt(a) : 0;
        }
    }
}
