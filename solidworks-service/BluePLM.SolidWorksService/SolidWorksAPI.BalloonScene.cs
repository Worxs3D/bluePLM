using System;
using System.Collections.Generic;
using System.Linq;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using Box = BluePLM.SolidWorksService.BalloonLayout.Box;
using Segment = BluePLM.SolidWorksService.BalloonLayout.Segment;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Reads what is already on a sheet into a <see cref="BalloonLayout.Scene"/> (1.30.0): the text and
    /// lines of every annotation (IAnnotation.GetDisplayData), the edges and hatching of every view
    /// (IView.GetPolylines7), and the sheet format and sheet sketches.
    ///
    /// Every source is checked against something independent before it is used, because the
    /// coordinate spaces below are not verified on a real SOLIDWORKS session:
    ///   R27 IDisplayData of an annotation is in sheet coordinates, like IAnnotation.GetPosition (R2).
    ///       Checked: data far from the annotation's own position, or off the sheet, is dropped and the
    ///       annotation's text box is estimated from its position instead.
    ///   R28 IDisplayData text position is the text's reference point named by GetTextRefPositionAtIndex
    ///       (swTextPosition_e), GetTextInBoxWidth/HeightAtIndex its size, GetTextAngleAtIndex radians.
    ///       A missing size is estimated from the text and its height.
    ///   R29 IView.GetPolylines7 packs, per polyline: type, geometry size, geometry, six line
    ///       attributes, point count, points (x, y, z). The parser accepts five to seven attributes and
    ///       only a layout that consumes the array exactly. Points are tried as given, through
    ///       ModelToViewTransform, and that plus the view position; the first space that puts nine in
    ///       ten points inside the view outline is used. If none does, the view outline is a soft area.
    ///   R30 ISheet.GetTemplateSketch and the sheet view's sketch are in sheet coordinates (checked:
    ///       points off the sheet drop the sketch).
    ///   R31 A note balloon's IDisplayData holds its circle as its largest arc; after inserting a
    ///       balloon the service moves it by the gap between that arc's centre and the wanted centre,
    ///       so where SetPosition2 anchors a note does not matter.
    /// </summary>
    public partial class SolidWorksAPI
    {
        /// <summary>
        /// Margin kept free along the sheet edges. ISO 5457 puts the drawing frame at least 10 mm in
        /// from the trimmed sheet edge; the frame and title block lines are obstacles on top of this.
        /// </summary>
        internal const double SheetBorderMarginM = 0.010;

        private sealed class BalloonSceneBuild
        {
            public readonly BalloonLayout.Scene Scene = new BalloonLayout.Scene();
            /// <summary>Characteristic text box per site on the sheet.</summary>
            public readonly Dictionary<AnnotationSite, Box> Anchors = new Dictionary<AnnotationSite, Box>();
            public int AnnotationsRead, AnnotationsEstimated, ViewsRead, ViewsOutlineOnly, SketchLines;

            public string Summary(string sheet) =>
                $"sheet {sheet}: annotations {AnnotationsRead} read / {AnnotationsEstimated} estimated, " +
                $"views {ViewsRead} read / {ViewsOutlineOnly} outline only, sketch lines {SketchLines}, " +
                $"text boxes {Scene.Text.Count}, annotation lines {Scene.AnnotationLines.Count}, " +
                $"geometry lines {Scene.GeometryLines.Count}, balloons {Scene.Balloons.Count}";
        }

        /// <summary>
        /// The scene of one sheet. <paramref name="leaving"/> are sites whose annotation was deleted or
        /// will move (relaid balloons): they are not obstacles.
        /// </summary>
        private static BalloonSceneBuild BuildBalloonScene(InspectionSheet sheet, IEnumerable<AnnotationSite> sheetSites,
            ISet<AnnotationSite> leaving, double diameter)
        {
            var build = new BalloonSceneBuild();
            var scene = build.Scene;
            var w = sheet.WidthM > 0 ? sheet.WidthM : 0.42;
            var h = sheet.HeightM > 0 ? sheet.HeightM : 0.297;
            var margin = Math.Min(SheetBorderMarginM, Math.Min(w, h) / 10);
            scene.Usable = new Box(margin, margin, w - margin, h - margin);

            foreach (var site in sheetSites)
            {
                if (site.Hidden || leaving.Contains(site)) continue;
                var texts = new List<Box>();
                var lines = new List<Segment>();
                if (ReadAnnotationGraphics(site.Annotation, site.X, site.Y, w, h, diameter, texts, lines)) build.AnnotationsRead++;
                else
                {
                    texts.Clear();
                    lines.Clear();
                    texts.Add(EstimatedTextBox(site.X, site.Y, diameter));
                    build.AnnotationsEstimated++;
                }

                if (IsCharacteristicType(site.Type))
                    build.Anchors[site] = texts.Aggregate(Box.Union);

                var isBluePlmBalloon = site.Type == (int)swAnnotationType_e.swNote
                    && string.Equals(site.Layer, InspectionNative.BalloonLayer, StringComparison.OrdinalIgnoreCase);
                if (isBluePlmBalloon)
                {
                    // A kept balloon is a circle; its number is inside it, so its text adds nothing.
                    var circle = BalloonCircleOf(site.Annotation, diameter) ?? new BalloonLayout.Circle(site.X, site.Y, diameter / 2);
                    scene.Balloons.Add(circle);
                    continue;
                }

                scene.Text.AddRange(texts);
                scene.AnnotationLines.AddRange(lines);
            }

            foreach (var view in sheet.Views)
            {
                bool visible = true;
                try { visible = view.GetVisible(); } catch { }
                if (!visible) continue;
                var outline = ViewOutline(view);
                var geometry = outline == null ? null : ReadViewGeometry(view, outline.Value);
                if (geometry != null)
                {
                    scene.GeometryLines.AddRange(geometry);
                    build.ViewsRead++;
                }
                else if (outline != null)
                {
                    scene.SoftAreas.Add(outline.Value);
                    build.ViewsOutlineOnly++;
                }
                if (outline != null)
                {
                    // Sketch entities of the view (detail circles, sketched lines), when their space checks out.
                    var sketch = ReadSketchLines(SafeSketch(() => view.GetSketch()), outline.Value.Inflate(Math.Max(outline.Value.Width, outline.Value.Height) * 0.05), ViewOrigin(view));
                    if (sketch != null) { scene.GeometryLines.AddRange(sketch); build.SketchLines += sketch.Count; }
                }
            }

            var sheetBox = new Box(0, 0, w, h);
            foreach (var sketchSource in new Func<object?>[] { () => sheet.Sheet?.GetTemplateSketch(), () => sheet.SheetView?.GetSketch() })
            {
                var lines = ReadSketchLines(SafeSketch(sketchSource), sheetBox.Inflate(0.001), null);
                if (lines == null) continue;
                scene.GeometryLines.AddRange(lines);
                build.SketchLines += lines.Count;
            }
            return build;
        }

        private static object? SafeSketch(Func<object?> get)
        {
            try { return get(); } catch { return null; }
        }

        /// <summary>A text box from an annotation position alone: about ten characters of note text, centred.</summary>
        private static Box EstimatedTextBox(double x, double y, double diameter)
        {
            var charHeight = diameter / 2.5; // BalloonDiameter is 2.5 character heights
            var width = 10 * EstimatedCharWidth(charHeight);
            var height = 1.2 * charHeight;
            return new Box(x - width / 2, y - height / 2, x + width / 2, y + height / 2);
        }

        /// <summary>Mean advance of a drawing font's character: 0.7 of its height (wide sans faces).</summary>
        private static double EstimatedCharWidth(double charHeight) => 0.7 * charHeight;

        private static double[]? Doubles(object? raw)
        {
            if (!(raw is Array a) || a.Length == 0) return null;
            var d = new double[a.Length];
            try
            {
                for (var i = 0; i < a.Length; i++) d[i] = Convert.ToDouble(a.GetValue(i));
            }
            catch { return null; }
            return d;
        }

        /// <summary>
        /// Text boxes and line segments of one annotation from its display data (R27, R28). False when
        /// the data is missing or fails the position check, so the caller estimates instead.
        /// </summary>
        private static bool ReadAnnotationGraphics(Annotation ann, double posX, double posY, double sheetW, double sheetH,
            double diameter, List<Box> texts, List<Segment> lines)
        {
            DisplayData? dd = null;
            try { dd = ann.GetDisplayData() as DisplayData; } catch { }
            if (dd == null) return false;

            try
            {
                int n = 0;
                try { n = dd.GetTextCount(); } catch { }
                for (var i = 0; i < n; i++)
                {
                    var p = Doubles(dd.GetTextPositionAtIndex(i));
                    if (p == null || p.Length < 2) continue;
                    double th = 0, bw = 0, bh = 0, angle = 0;
                    int refPos = -1;
                    string text = "";
                    try { th = dd.GetTextHeightAtIndex(i); } catch { }
                    try { bw = dd.GetTextInBoxWidthAtIndex(i); } catch { }
                    try { bh = dd.GetTextInBoxHeightAtIndex(i); } catch { }
                    try { angle = dd.GetTextAngleAtIndex(i); } catch { }
                    try { refPos = dd.GetTextRefPositionAtIndex(i); } catch { }
                    try { text = dd.GetTextAtIndex(i) ?? ""; } catch { }
                    if (th <= 0) th = diameter / 2.5;
                    var lineCount = Math.Max(1, text.Split('\n').Length);
                    var width = bw > 0 ? bw : Math.Max(1, text.Split('\n').Max(l => l.Length)) * EstimatedCharWidth(th);
                    double spacing = 0;
                    try { spacing = dd.GetTextLineSpacingAtIndex(i); } catch { }
                    var height = bh > 0 ? bh : th + (lineCount - 1) * (spacing > 0 ? spacing : 1.5 * th);
                    texts.Add(TextBox(p[0], p[1], width, height, angle, refPos));
                }

                int lc = 0;
                try { lc = dd.GetLineCount(); } catch { }
                for (var i = 0; i < lc; i++)
                {
                    var l = Doubles(dd.GetLineAtIndex(i));
                    if (l == null) continue;
                    if (l.Length >= 6) lines.Add(new Segment(l[0], l[1], l[3], l[4]));
                    else if (l.Length >= 4) lines.Add(new Segment(l[0], l[1], l[2], l[3]));
                }

                int ac = 0;
                try { ac = dd.GetArcCount(); } catch { }
                for (var i = 0; i < ac; i++)
                {
                    var a = Doubles(dd.GetArcAtIndex(i));
                    if (a == null || a.Length < 9) continue;
                    var ccw = a.Length < 12 || a[11] >= 0;
                    lines.AddRange(ArcSegments(a[0], a[1], a[3], a[4], a[6], a[7], ccw ? 1 : -1, null));
                }

                int pc = 0;
                try { pc = dd.GetPolyLineCount(); } catch { }
                for (var i = 0; i < pc; i++) lines.AddRange(PointChain(Doubles(dd.GetPolylineAtIndex(i)), false));
                int gc = 0;
                try { gc = dd.GetPolygonCount(); } catch { }
                for (var i = 0; i < gc; i++) lines.AddRange(PointChain(Doubles(dd.GetPolygonAtIndex(i)), true));
            }
            catch
            {
                return false;
            }

            if (texts.Count == 0 && lines.Count == 0) return false;

            // R27: sheet coordinates, around the annotation's own position.
            var all = texts.Concat(lines.Select(s => s.Bounds)).Aggregate(Box.Union);
            var sheet = new Box(0, 0, sheetW, sheetH).Inflate(Math.Max(sheetW, sheetH) * 0.25);
            if (all.MinX < sheet.MinX || all.MinY < sheet.MinY || all.MaxX > sheet.MaxX || all.MaxY > sheet.MaxY) return false;
            var near = (texts.Count > 0 ? texts.Aggregate(Box.Union) : all).Inflate(3 * diameter);
            if (near.DistanceTo(posX, posY) > 0) return false;
            if (texts.Count == 0) texts.Add(EstimatedTextBox(posX, posY, diameter));
            return true;
        }

        /// <summary>Axis-aligned box of a text block given its reference point and kind (swTextPosition_e).</summary>
        internal static Box TextBox(double px, double py, double width, double height, double angle, int refPos)
        {
            double x0, y0; // lower-left corner relative to the reference point, before rotation
            switch (refPos)
            {
                case (int)swTextPosition_e.swUPPER_LEFT: x0 = 0; y0 = -height; break;
                case (int)swTextPosition_e.swLOWER_LEFT: x0 = 0; y0 = 0; break;
                case (int)swTextPosition_e.swCENTER: x0 = -width / 2; y0 = -height / 2; break;
                case (int)swTextPosition_e.swUPPER_RIGHT: x0 = -width; y0 = -height; break;
                case (int)swTextPosition_e.swLOWER_RIGHT: x0 = -width; y0 = 0; break;
                case (int)swTextPosition_e.swUPPER_CENTER: x0 = -width / 2; y0 = -height; break;
                default:
                    // Unknown reference: cover every way the block could hang off the point.
                    return new Box(px - width, py - height, px + width, py + height);
            }
            var cos = Math.Cos(angle);
            var sin = Math.Sin(angle);
            var corners = new[] { (x0, y0), (x0 + width, y0), (x0, y0 + height), (x0 + width, y0 + height) };
            var box = new Box(px, py, px, py);
            var first = true;
            foreach (var (cx, cy) in corners)
            {
                var x = px + cx * cos - cy * sin;
                var y = py + cx * sin + cy * cos;
                box = first ? new Box(x, y, x, y) : Box.Union(box, new Box(x, y, x, y));
                first = false;
            }
            return box;
        }

        private static IEnumerable<Segment> PointChain(double[]? p, bool closed)
        {
            if (p == null || p.Length < 6) yield break;
            var n = p.Length / 3;
            for (var i = 1; i < n; i++) yield return new Segment(p[3 * (i - 1)], p[3 * (i - 1) + 1], p[3 * i], p[3 * i + 1]);
            if (closed && n > 2) yield return new Segment(p[3 * (n - 1)], p[3 * (n - 1) + 1], p[0], p[1]);
        }

        /// <summary>
        /// An arc as segments, from centre, start and end. <paramref name="dir"/> is +1 counter-clockwise
        /// or -1 clockwise; with <paramref name="length"/> known the direction whose sweep matches it wins.
        /// Start equal to end is a full circle.
        /// </summary>
        internal static List<Segment> ArcSegments(double cx, double cy, double sx, double sy, double ex, double ey, int dir, double? length)
        {
            var result = new List<Segment>();
            var r = Math.Sqrt((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy));
            if (r < 1e-9) return result;
            var a0 = Math.Atan2(sy - cy, sx - cx);
            var a1 = Math.Atan2(ey - cy, ex - cx);
            var ccwSweep = a1 - a0;
            while (ccwSweep <= 1e-12) ccwSweep += 2 * Math.PI;
            double sweep;
            if (length != null && length > 0 && ccwSweep < 2 * Math.PI - 1e-9)
                sweep = Math.Abs(ccwSweep * r - length.Value) <= Math.Abs((2 * Math.PI - ccwSweep) * r - length.Value) ? ccwSweep : -(2 * Math.PI - ccwSweep);
            else
                sweep = dir >= 0 ? ccwSweep : -(2 * Math.PI - ccwSweep);
            if (ccwSweep >= 2 * Math.PI - 1e-9) sweep = 2 * Math.PI;

            var steps = Math.Max(4, (int)Math.Ceiling(Math.Abs(sweep) / (Math.PI / 18)));
            double px = sx, py = sy;
            for (var i = 1; i <= steps; i++)
            {
                var a = a0 + sweep * i / steps;
                var x = cx + r * Math.Cos(a);
                var y = cy + r * Math.Sin(a);
                result.Add(new Segment(px, py, x, y));
                px = x; py = y;
            }
            return result;
        }

        /// <summary>A note balloon's circle from its largest display-data arc (R31), else null.</summary>
        private static BalloonLayout.Circle? BalloonCircleOf(Annotation ann, double diameter)
        {
            try
            {
                if (!(ann.GetDisplayData() is DisplayData dd)) return null;
                BalloonLayout.Circle? best = null;
                var count = dd.GetArcCount();
                for (var i = 0; i < count; i++)
                {
                    var a = Doubles(dd.GetArcAtIndex(i));
                    if (a == null || a.Length < 6) continue;
                    var r = Math.Sqrt((a[3] - a[0]) * (a[3] - a[0]) + (a[4] - a[1]) * (a[4] - a[1]));
                    if (r < diameter * 0.2 || r > diameter * 3) continue;
                    if (best == null || r > best.Value.R) best = new BalloonLayout.Circle(a[0], a[1], r);
                }
                return best;
            }
            catch { return null; }
        }

        private static Box? ViewOutline(View view)
        {
            try
            {
                var o = Doubles(view.GetOutline());
                if (o == null || o.Length < 4) return null;
                var b = new Box(o[0], o[1], o[2], o[3]);
                return b.Width > 0 && b.Height > 0 ? b : (Box?)null;
            }
            catch { return null; }
        }

        private static (double X, double Y)? ViewOrigin(View view)
        {
            try
            {
                var p = Doubles(view.Position);
                return p != null && p.Length >= 2 ? (p[0], p[1]) : ((double, double)?)null;
            }
            catch { return null; }
        }

        /// <summary>A view's edges and hatching as segments in sheet space (R29), or null when unreadable.</summary>
        private static List<Segment>? ReadViewGeometry(View view, Box outline)
        {
            double[]? data = null;
            try
            {
                object polylines = null!;
                view.GetPolylines7((short)swCrossHatchFilter_e.swCrossHatchInclude, out polylines);
                data = Doubles(polylines);
            }
            catch { }
            var chains = data == null ? null : ParsePolylines(data);
            if (chains == null || chains.Count == 0) return null;

            double[]? xf = null;
            try { xf = Doubles(view.ModelToViewTransform?.ArrayData); } catch { }
            var origin = ViewOrigin(view);
            var spaces = new List<Func<double, double, double, (double, double)>> { (x, y, z) => (x, y) };
            if (xf != null && xf.Length >= 13)
            {
                (double, double) T(double x, double y, double z) =>
                    ((x * xf[0] + y * xf[3] + z * xf[6]) * xf[12] + xf[9], (x * xf[1] + y * xf[4] + z * xf[7]) * xf[12] + xf[10]);
                spaces.Add(T);
                if (origin != null)
                    spaces.Add((x, y, z) => { var (a, b) = T(x, y, z); return (a + origin.Value.X, b + origin.Value.Y); });
            }

            var check = outline.Inflate(Math.Max(outline.Width, outline.Height) * 0.05);
            foreach (var space in spaces)
            {
                int inside = 0, total = 0;
                foreach (var chain in chains)
                    for (var i = 0; i + 2 < chain.Length; i += 3)
                    {
                        var (x, y) = space(chain[i], chain[i + 1], chain[i + 2]);
                        total++;
                        if (check.DistanceTo(x, y) <= 0) inside++;
                    }
                if (total == 0 || inside < 0.9 * total) continue;

                var result = new List<Segment>();
                foreach (var chain in chains)
                    for (var i = 3; i + 2 < chain.Length; i += 3)
                    {
                        var (x0, y0) = space(chain[i - 3], chain[i - 2], chain[i - 1]);
                        var (x1, y1) = space(chain[i], chain[i + 1], chain[i + 2]);
                        result.Add(new Segment(x0, y0, x1, y1));
                    }
                return result;
            }
            return null;
        }

        /// <summary>
        /// The point lists of a GetPolylines7 array (R29). Tries five, six and seven line attributes and
        /// returns the layout that consumes the array exactly, else null.
        /// </summary>
        internal static List<double[]>? ParsePolylines(double[] data)
        {
            foreach (var attributes in new[] { 6, 5, 7 })
            {
                var chains = new List<double[]>();
                var i = 0;
                var ok = true;
                while (i < data.Length)
                {
                    if (i + 2 > data.Length) { ok = false; break; }
                    var geomSize = data[i + 1];
                    if (geomSize < 0 || geomSize != Math.Floor(geomSize) || geomSize > data.Length) { ok = false; break; }
                    i += 2 + (int)geomSize + attributes;
                    if (i >= data.Length) { ok = false; break; }
                    var count = data[i];
                    if (count < 0 || count != Math.Floor(count)) { ok = false; break; }
                    i++;
                    var len = 3 * (int)count;
                    if (i + len > data.Length) { ok = false; break; }
                    var pts = new double[len];
                    Array.Copy(data, i, pts, 0, len);
                    chains.Add(pts);
                    i += len;
                }
                if (ok && i == data.Length) return chains;
            }
            return null;
        }

        /// <summary>
        /// Non-construction lines and arcs of a sketch (R30), as given or shifted by the view origin;
        /// null unless nine in ten end points land inside <paramref name="check"/>.
        /// </summary>
        private static List<Segment>? ReadSketchLines(object? sketchObj, Box check, (double X, double Y)? viewOrigin)
        {
            if (!(sketchObj is Sketch sketch)) return null;
            object? raw = null;
            try { raw = sketch.GetSketchSegments(); } catch { }
            if (!(raw is Array segments) || segments.Length == 0) return null;

            var local = new List<Segment>();
            foreach (var item in segments)
            {
                if (!(item is SketchSegment seg)) continue;
                try
                {
                    if (seg.ConstructionGeometry) continue;
                    if (seg is SketchLine line
                        && line.GetStartPoint2() is SketchPoint s && line.GetEndPoint2() is SketchPoint e)
                        local.Add(new Segment(s.X, s.Y, e.X, e.Y));
                    else if (seg is SketchArc arc
                        && arc.GetCenterPoint2() is SketchPoint c && arc.GetStartPoint2() is SketchPoint a0 && arc.GetEndPoint2() is SketchPoint a1)
                    {
                        double? length = null;
                        try { length = seg.GetLength(); } catch { }
                        local.AddRange(ArcSegments(c.X, c.Y, a0.X, a0.Y, a1.X, a1.Y, 1, length));
                    }
                }
                catch { }
            }
            if (local.Count == 0) return null;

            var offsets = new List<(double X, double Y)> { (0, 0) };
            if (viewOrigin != null) offsets.Add(viewOrigin.Value);
            foreach (var (ox, oy) in offsets)
            {
                var inside = local.Count(s => check.DistanceTo(s.X1 + ox, s.Y1 + oy) <= 0 && check.DistanceTo(s.X2 + ox, s.Y2 + oy) <= 0);
                if (inside >= 0.9 * local.Count)
                    return local.Select(s => new Segment(s.X1 + ox, s.Y1 + oy, s.X2 + ox, s.Y2 + oy)).ToList();
            }
            return null;
        }

        /// <summary>
        /// Moves a just-inserted balloon so its circle is centred on the wanted point (R31). Does
        /// nothing when the circle cannot be read or is already within 0.01 mm.
        /// </summary>
        private static void CentreBalloon(Annotation ann, double x, double y, double diameter)
        {
            var circle = BalloonCircleOf(ann, diameter);
            if (circle == null) return;
            var dx = x - circle.Value.X;
            var dy = y - circle.Value.Y;
            if (Math.Abs(dx) < 1e-5 && Math.Abs(dy) < 1e-5) return;
            if (Math.Sqrt(dx * dx + dy * dy) > 2 * diameter) return; // not this balloon's own offset: leave it
            try
            {
                if (!(ann.GetPosition() is Array p) || p.Length < 2) return;
                var px = Convert.ToDouble(p.GetValue(0)) + dx;
                var py = Convert.ToDouble(p.GetValue(1)) + dy;
                if (!ann.SetPosition2(px, py, 0)) ann.SetPosition(px, py, 0);
            }
            catch { }
        }
    }
}
