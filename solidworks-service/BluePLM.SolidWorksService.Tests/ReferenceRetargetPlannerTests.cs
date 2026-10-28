using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The matching rules of retargetReferences, which need no Document Manager licence: where each
    /// stored reference of a review-package file should point, and when nothing may be guessed.
    /// </summary>
    public sealed class ReferenceRetargetPlannerTests
    {
        private const string Package = @"C:\Reviews\R-12";

        private static ReferenceRetargetPlanner Planner(params string[] relativeFiles) =>
            new ReferenceRetargetPlanner(
                Package,
                relativeFiles.Select(f => System.IO.Path.Combine(Package, f)),
                new[] { @"C:\BluePLM\acme-vault" });

        [Fact]
        public void MapsByVaultRelativePathUnderAKnownVaultRoot()
        {
            var match = Planner(@"Frames\BR-100.sldprt", @"Old\BR-100.sldprt")
                .Resolve(@"C:\BluePLM\acme-vault\Frames\BR-100.SLDPRT");

            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Mapped, match.Kind);
            Assert.Equal(@"C:\Reviews\R-12\Frames\BR-100.sldprt", match.NewPath);
            Assert.Equal("vaultPath", match.Rule);
        }

        [Fact]
        public void ForwardSlashesAreTheSamePath()
        {
            var match = Planner(@"Frames\BR-100.sldprt").Resolve("C:/BluePLM/acme-vault/Frames/BR-100.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Mapped, match.Kind);
        }

        [Fact]
        public void AnotherMachinesVaultMatchesOnTheLongestUniqueTail()
        {
            var match = Planner(@"Frames\A\BR-100.sldprt", @"Frames\B\BR-100.sldprt")
                .Resolve(@"D:\Other\vault\Frames\B\BR-100.sldprt");

            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Mapped, match.Kind);
            Assert.Equal(@"C:\Reviews\R-12\Frames\B\BR-100.sldprt", match.NewPath);
            Assert.Equal("pathSuffix", match.Rule);
        }

        [Fact]
        public void AUniqueFileNameIsEnough()
        {
            var match = Planner(@"Frames\BR-100.sldprt").Resolve(@"Z:\elsewhere\BR-100.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Mapped, match.Kind);
            Assert.Equal("fileName", match.Rule);
        }

        [Fact]
        public void ATieIsAmbiguousAndNothingIsChosen()
        {
            var match = Planner(@"A\BR-100.sldprt", @"B\BR-100.sldprt").Resolve(@"Z:\elsewhere\BR-100.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Ambiguous, match.Kind);
            Assert.Null(match.NewPath);
            Assert.Equal(2, match.Candidates.Count);
        }

        [Fact]
        public void AReferenceNotInThePackageIsMissing()
        {
            var match = Planner(@"Frames\BR-100.sldprt").Resolve(@"C:\SOLIDWORKS Data\toolbox\hex nut.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Missing, match.Kind);
        }

        [Fact]
        public void AReferenceAlreadyInsideThePackageIsLeftAlone()
        {
            var match = Planner(@"Frames\BR-100.sldprt").Resolve(@"c:\reviews\r-12\frames\br-100.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.AlreadyInPackage, match.Kind);
        }

        [Fact]
        public void AnUnparsableStoredPathIsMissingNotAnException()
        {
            var match = Planner(@"Frames\BR-100.sldprt").Resolve("C:\\Vault\\Frames\\BR-100\0.sldprt");
            Assert.Equal(ReferenceRetargetPlanner.MatchKind.Missing, match.Kind);
        }

        [Fact]
        public void DotDotCannotEscapeThePackage()
        {
            Assert.False(ReferenceRetargetPlanner.IsUnder(@"C:\Reviews\R-12\..\R-13\x.sldasm", Package));
            Assert.False(ReferenceRetargetPlanner.IsUnder(@"C:\Reviews\R-123\x.sldasm", Package));
            Assert.False(ReferenceRetargetPlanner.IsUnder(Package, Package));
            Assert.True(ReferenceRetargetPlanner.IsUnder(@"C:\Reviews\R-12\sub\x.sldasm", Package));
        }
    }
}
