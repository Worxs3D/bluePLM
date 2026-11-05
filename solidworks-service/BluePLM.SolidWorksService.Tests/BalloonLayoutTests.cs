using System;
using System.Collections.Generic;
using System.Linq;
using BluePLM.SolidWorksService;
using Xunit;
using Box = BluePLM.SolidWorksService.BalloonLayout.Box;
using Segment = BluePLM.SolidWorksService.BalloonLayout.Segment;

namespace BluePLM.SolidWorksService.Tests
{
    public class BalloonLayoutTests
    {
        private const double D = 0.00875; // 3.5 mm notes -> 8.75 mm balloons
        private const double R = D / 2;

        private static BalloonLayout.Scene EmptyA3()
        {
            var scene = new BalloonLayout.Scene { Usable = new Box(0.01, 0.01, 0.41, 0.287) };
            return scene;
        }

        private static Box TextAt(double x, double y, double w = 0.02, double h = 0.0035) => new Box(x, y, x + w, y + h);

        private static double Dist((double X, double Y) a, (double X, double Y) b) =>
            Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));

        private static void AssertClearOfText(BalloonLayout.Scene scene, IEnumerable<(double X, double Y)> centres)
        {
            foreach (var c in centres)
                foreach (var t in scene.Text)
                    Assert.True(t.DistanceTo(c.X, c.Y) >= R, $"balloon at {c} covers text {t}");
        }

        [Fact]
        public void A_lone_dimension_gets_its_balloon_just_after_its_text()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15);
            scene.Text.Add(text);

            var (x, y) = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D)[0].Single();

            Assert.Equal(text.MaxX + BalloonLayout.GapD * D + R, x, 9);
            Assert.Equal(text.CentreY, y, 9);
        }

        [Fact]
        public void Text_after_the_dimension_sends_the_balloon_above_it()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15);
            scene.Text.Add(text);
            scene.Text.Add(TextAt(text.MaxX + 0.002, 0.15, 0.03)); // the next dimension right behind it

            var c = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D)[0].Single();

            AssertClearOfText(scene, new[] { c });
            Assert.True(c.Y > text.MaxY, $"expected above the text, got {c}");
            Assert.True(text.DistanceTo(c.X, c.Y) < 2 * D, "the balloon stays next to its text");
        }

        [Fact]
        public void A_line_through_the_preferred_spot_is_avoided_when_free_space_is_near()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15);
            scene.Text.Add(text);
            // A vertical edge just right of the text, the full height of the area.
            var edgeX = text.MaxX + BalloonLayout.GapD * D + R;
            scene.GeometryLines.Add(new Segment(edgeX, 0.10, edgeX, 0.20));

            var c = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D)[0].Single();

            Assert.Equal(0, BalloonLayout.LengthInside(scene.GeometryLines[0], c.X, c.Y, R));
        }

        [Fact]
        public void Neighbouring_dimensions_each_get_a_balloon_nearer_their_own_text()
        {
            var scene = EmptyA3();
            // Two values stacked one above the other, 2 mm apart (a typical crowded detail view).
            var upper = TextAt(0.2, 0.1555);
            var lower = TextAt(0.2, 0.150);
            scene.Text.Add(upper);
            scene.Text.Add(lower);

            var placed = BalloonLayout.Place(new[] { new BalloonLayout.Subject(upper, 1), new BalloonLayout.Subject(lower, 1) }, scene, D);
            var u = placed[0].Single();
            var l = placed[1].Single();

            AssertClearOfText(scene, new[] { u, l });
            Assert.True(Dist(u, l) >= D, "balloons do not overlap");
            Assert.True(upper.DistanceTo(u.X, u.Y) < lower.DistanceTo(u.X, u.Y), "upper balloon reads as the upper value's");
            Assert.True(lower.DistanceTo(l.X, l.Y) < upper.DistanceTo(l.X, l.Y), "lower balloon reads as the lower value's");
        }

        [Fact]
        public void A_two_value_callout_gets_a_row_of_touching_but_separate_balloons()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15, 0.03);
            scene.Text.Add(text);

            var row = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 2) }, scene, D)[0];

            Assert.Equal(2, row.Count);
            Assert.Equal(BalloonLayout.StackStepD * D, Dist(row[0], row[1]), 9);
            Assert.True(row[1].X > row[0].X, "second value goes further out, in label order");
            AssertClearOfText(scene, row);
        }

        [Fact]
        public void Balloons_stay_inside_the_usable_sheet()
        {
            var scene = EmptyA3();
            var text = TextAt(0.41 - 0.021, 0.2); // text against the right margin
            scene.Text.Add(text);

            var c = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D)[0].Single();

            Assert.True(c.X + R <= scene.Usable.MaxX + 1e-12);
            AssertClearOfText(scene, new[] { c });
        }

        [Fact]
        public void Kept_balloons_are_never_covered()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15);
            scene.Text.Add(text);
            var kept = new BalloonLayout.Circle(text.MaxX + BalloonLayout.GapD * D + R, text.CentreY, R);
            scene.Balloons.Add(kept);

            var c = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D)[0].Single();

            Assert.True(Dist(c, (kept.X, kept.Y)) >= 2 * R);
        }

        [Fact]
        public void A_fully_boxed_in_dimension_still_gets_its_balloon()
        {
            var scene = EmptyA3();
            var text = TextAt(0.2, 0.15);
            scene.Text.Add(text);
            // Text everywhere around it.
            for (var dx = -0.06; dx <= 0.06; dx += 0.004)
                for (var dy = -0.04; dy <= 0.04; dy += 0.004)
                    if (Math.Abs(dx) > 0.001 || Math.Abs(dy) > 0.001)
                        scene.Text.Add(TextAt(0.2 + dx, 0.15 + dy, 0.0035, 0.0035));

            var placed = BalloonLayout.Place(new[] { new BalloonLayout.Subject(text, 1) }, scene, D);

            Assert.Single(placed[0]);
        }

        [Fact]
        public void The_same_sheet_always_gives_the_same_balloons()
        {
            var (scene1, subjects1) = RandomSheet(7, 40);
            var (scene2, subjects2) = RandomSheet(7, 40);

            var a = BalloonLayout.Place(subjects1, scene1, D);
            var b = BalloonLayout.Place(subjects2, scene2, D);

            for (var i = 0; i < a.Length; i++) Assert.Equal(a[i], b[i]);
        }

        [Theory]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(3)]
        [InlineData(4)]
        public void A_busy_sheet_with_room_gets_no_balloon_on_text_or_another_balloon(int seed)
        {
            var (scene, subjects) = RandomSheet(seed, 45);

            var placed = BalloonLayout.Place(subjects, scene, D);

            var all = placed.SelectMany(p => p).ToList();
            Assert.Equal(subjects.Sum(s => s.Count), all.Count);
            AssertClearOfText(scene, all);
            for (var i = 0; i < all.Count; i++)
                for (var j = i + 1; j < all.Count; j++)
                    Assert.True(Dist(all[i], all[j]) >= D, $"balloons {all[i]} and {all[j]} overlap");
            foreach (var c in all)
                Assert.True(c.X - R >= scene.Usable.MinX && c.X + R <= scene.Usable.MaxX && c.Y - R >= scene.Usable.MinY && c.Y + R <= scene.Usable.MaxY);
            // And every balloon reads as its own: nearer its own text than any other characteristic's.
            for (var s = 0; s < subjects.Count; s++)
                foreach (var c in placed[s])
                {
                    var own = subjects[s].Anchor.DistanceTo(c.X, c.Y);
                    for (var o = 0; o < subjects.Count; o++)
                        if (o != s) Assert.True(own < subjects[o].Anchor.DistanceTo(c.X, c.Y), $"balloon of {s} at {c} is nearer characteristic {o}");
                }
        }

        /// <summary>Non-overlapping dimension texts with hatch-like geometry between them, A3.</summary>
        private static (BalloonLayout.Scene, List<BalloonLayout.Subject>) RandomSheet(int seed, int count)
        {
            var rng = new Random(seed);
            var scene = EmptyA3();
            var subjects = new List<BalloonLayout.Subject>();
            var tries = 0;
            while (subjects.Count < count && tries++ < 10_000)
            {
                var w = 0.008 + rng.NextDouble() * 0.025;
                var box = TextAt(0.03 + rng.NextDouble() * 0.33, 0.03 + rng.NextDouble() * 0.22, w);
                if (scene.Text.Any(t => t.Inflate(3 * D).DistanceTo(box.CentreX, box.CentreY) <= 0 || box.Inflate(3 * D).DistanceTo(t.CentreX, t.CentreY) <= 0))
                    continue;
                scene.Text.Add(box);
                subjects.Add(new BalloonLayout.Subject(box, rng.Next(10) == 0 ? 2 : 1));
            }
            for (var i = 0; i < 60; i++)
            {
                var x = 0.02 + rng.NextDouble() * 0.37;
                var y = 0.02 + rng.NextDouble() * 0.25;
                scene.GeometryLines.Add(new Segment(x, y, x + 0.03, y + 0.03));
            }
            return (scene, subjects);
        }

        [Fact]
        public void Length_inside_a_circle_is_the_chord_clipped_to_the_segment()
        {
            Assert.Equal(2.0, BalloonLayout.LengthInside(new Segment(-5, 0, 5, 0), 0, 0, 1), 12);
            Assert.Equal(1.0, BalloonLayout.LengthInside(new Segment(0, 0, 5, 0), 0, 0, 1), 12);
            Assert.Equal(0.0, BalloonLayout.LengthInside(new Segment(-5, 2, 5, 2), 0, 0, 1), 12);
            Assert.Equal(0.5, BalloonLayout.LengthInside(new Segment(-0.25, 0, 0.25, 0), 0, 0, 1), 12);
        }

        // ------------------------------------------------------------------ scene readers

        [Theory]
        [InlineData(0, 1.0, 1.0, 3.0, 2.0)]   // upper left: hangs right and down
        [InlineData(1, 1.0, 2.0, 3.0, 3.0)]   // lower left: right and up
        [InlineData(2, 0.0, 1.5, 2.0, 2.5)]   // centre
        [InlineData(3, -1.0, 1.0, 1.0, 2.0)]  // upper right
        [InlineData(4, -1.0, 2.0, 1.0, 3.0)]  // lower right
        [InlineData(5, 0.0, 1.0, 2.0, 2.0)]   // upper centre
        public void Text_boxes_hang_off_their_reference_point(int refPos, double minX, double minY, double maxX, double maxY)
        {
            var b = SolidWorksAPI.TextBox(1, 2, 2, 1, 0, refPos);
            Assert.Equal(minX, b.MinX, 12);
            Assert.Equal(minY, b.MinY, 12);
            Assert.Equal(maxX, b.MaxX, 12);
            Assert.Equal(maxY, b.MaxY, 12);
        }

        [Fact]
        public void Vertical_text_box_turns_about_its_reference_point()
        {
            var b = SolidWorksAPI.TextBox(0, 0, 2, 1, Math.PI / 2, 1); // lower left, rotated 90 degrees
            Assert.Equal(-1, b.MinX, 9);
            Assert.Equal(0, b.MinY, 9);
            Assert.Equal(0, b.MaxX, 9);
            Assert.Equal(2, b.MaxY, 9);
        }

        [Fact]
        public void Unknown_text_reference_covers_every_way_the_text_could_hang()
        {
            var b = SolidWorksAPI.TextBox(0, 0, 2, 1, 0, 99);
            Assert.Equal(new[] { -2.0, -1.0, 2.0, 1.0 }, new[] { b.MinX, b.MinY, b.MaxX, b.MaxY });
        }

        [Fact]
        public void An_arc_follows_the_direction_its_length_says()
        {
            // Quarter circle from (1,0) to (0,1): counter-clockwise is pi/2 long, clockwise 3pi/2.
            var ccw = SolidWorksAPI.ArcSegments(0, 0, 1, 0, 0, 1, -1, Math.PI / 2);
            var cw = SolidWorksAPI.ArcSegments(0, 0, 1, 0, 0, 1, 1, 3 * Math.PI / 2);
            Assert.True(ccw.All(s => s.X2 >= -1e-9 && s.Y2 >= -1e-9), "short way stays in the first quadrant");
            Assert.Contains(cw, s => s.X2 < -0.5);
            Assert.Equal(Math.PI / 2, ccw.Sum(s => Math.Sqrt((s.X2 - s.X1) * (s.X2 - s.X1) + (s.Y2 - s.Y1) * (s.Y2 - s.Y1))), 2);
        }

        [Fact]
        public void An_arc_that_ends_where_it_starts_is_a_full_circle()
        {
            var circle = SolidWorksAPI.ArcSegments(0, 0, 1, 0, 1, 0, 1, null);
            var len = circle.Sum(s => Math.Sqrt((s.X2 - s.X1) * (s.X2 - s.X1) + (s.Y2 - s.Y1) * (s.Y2 - s.Y1)));
            Assert.Equal(2 * Math.PI, len, 1);
        }

        [Fact]
        public void Polylines_parse_when_the_layout_consumes_the_array_exactly()
        {
            // Two polylines: type, geometry size, geometry, six attributes, point count, points.
            var data = new double[]
            {
                0, 0, /* attrs */ 1, 2, 3, 4, 5, 6, 2, 0, 0, 0, 1, 1, 0,
                1, 2, 9, 9, /* attrs */ 1, 2, 3, 4, 5, 6, 3, 0, 0, 0, 1, 0, 0, 1, 1, 0,
            };
            var chains = SolidWorksAPI.ParsePolylines(data);
            Assert.NotNull(chains);
            Assert.Equal(2, chains!.Count);
            Assert.Equal(6, chains[0].Length);
            Assert.Equal(9, chains[1].Length);
        }

        [Fact]
        public void A_polyline_array_that_fits_no_layout_is_refused()
        {
            Assert.Null(SolidWorksAPI.ParsePolylines(new double[] { 0, 0, 1, 2, 3, 4, 5, 6, 5, 0, 0 }));
            Assert.Null(SolidWorksAPI.ParsePolylines(new double[] { 0, -1, 0 }));
        }

        // ------------------------------------------------------------------ relaying old balloons

        [Fact]
        public void A_balloon_left_where_the_old_placer_put_it_is_relaid_and_a_moved_one_is_not()
        {
            var legacy = InspectionNative.BalloonPositions(0.1, 0.1, 0.05, 0.1, 1, D, 0.42, 0.297)[0];
            var untouched = new InspectionNative.OldBalloon { Label = "3", Sheet = "Sheet1", X = legacy.X, Y = legacy.Y };
            var moved = new InspectionNative.OldBalloon { Label = "3", Sheet = "Sheet1", X = legacy.X + 0.001, Y = legacy.Y };

            Assert.True(InspectionNative.AtLegacyPosition(untouched, legacy));
            Assert.False(InspectionNative.AtLegacyPosition(moved, legacy));
        }
    }
}
