using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Decides where each stored reference of a file in a review package should point.
    ///
    /// A review package is a folder that holds a drawing and its dependency closure laid out by
    /// vault-relative path: <c>&lt;package&gt;\&lt;vault-relative path&gt;</c>. The files keep the
    /// absolute paths they were saved with, which point into somebody's vault, so SOLIDWORKS would
    /// load the vault copies rather than the pinned versions in the package.
    ///
    /// Pure: no Document Manager, no file reads beyond the list it is handed, so the matching rules are
    /// covered by the test suite without a licence.
    ///
    /// Matching, in order:
    /// 1. The reference already lies inside the package: nothing to do.
    /// 2. The reference lies under one of the given vault roots: its vault-relative path must exist
    ///    in the package. That is exact.
    /// 3. Otherwise compare trailing path segments with every package file of the same name. The
    ///    longest common tail wins when it is unique; a tail of one segment is a file-name match.
    ///    A tie is ambiguous and nothing is guessed.
    /// </summary>
    public sealed class ReferenceRetargetPlanner
    {
        public enum MatchKind
        {
            /// <summary>The reference already points at a file inside the package.</summary>
            AlreadyInPackage,

            /// <summary>The reference maps to a package file.</summary>
            Mapped,

            /// <summary>No package file matches.</summary>
            Missing,

            /// <summary>Several package files match equally well; nothing is chosen.</summary>
            Ambiguous,
        }

        public sealed class Match
        {
            public Match(MatchKind kind, string? newPath, string? rule, IReadOnlyList<string>? candidates = null)
            {
                Kind = kind;
                NewPath = newPath;
                Rule = rule;
                Candidates = candidates ?? Array.Empty<string>();
            }

            public MatchKind Kind { get; }

            /// <summary>Absolute path inside the package, for Mapped and AlreadyInPackage.</summary>
            public string? NewPath { get; }

            /// <summary>"package", "vaultPath", "pathSuffix" or "fileName".</summary>
            public string? Rule { get; }

            /// <summary>For Ambiguous: the package paths that tied.</summary>
            public IReadOnlyList<string> Candidates { get; }
        }

        private readonly string _packageRoot;
        private readonly Dictionary<string, string> _byRelative = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, List<string>> _byName = new(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> _vaultRoots;

        /// <param name="packageRoot">Absolute package folder.</param>
        /// <param name="packageFiles">Absolute paths of every file inside the package.</param>
        /// <param name="vaultRoots">Optional absolute vault roots the stored references may start with.</param>
        public ReferenceRetargetPlanner(string packageRoot, IEnumerable<string> packageFiles, IEnumerable<string>? vaultRoots = null)
        {
            _packageRoot = NormalizeRoot(packageRoot);

            foreach (var file in packageFiles)
            {
                var full = NormalizePath(file);
                if (!IsUnder(full, _packageRoot)) continue;
                var relative = full.Substring(_packageRoot.Length);
                _byRelative[relative] = full;

                var name = Path.GetFileName(full);
                if (!_byName.TryGetValue(name, out var list))
                {
                    list = new List<string>();
                    _byName[name] = list;
                }
                list.Add(full);
            }

            _vaultRoots = (vaultRoots ?? Enumerable.Empty<string>())
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .Select(NormalizeRoot)
                .Where(r => !string.Equals(r, _packageRoot, StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        public string PackageRoot => _packageRoot;

        public Match Resolve(string reference)
        {
            string normalized;
            try
            {
                normalized = NormalizePath(reference);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                // A stored path Windows cannot parse is one reference the package cannot place; it
                // must not fail the whole file and leave its other references pointing at the vault.
                return new Match(MatchKind.Missing, null, null);
            }

            if (IsUnder(normalized, _packageRoot))
            {
                var relative = normalized.Substring(_packageRoot.Length);
                return _byRelative.TryGetValue(relative, out var inside)
                    ? new Match(MatchKind.AlreadyInPackage, inside, "package")
                    : new Match(MatchKind.Missing, null, "package");
            }

            foreach (var root in _vaultRoots)
            {
                if (!IsUnder(normalized, root)) continue;
                var relative = normalized.Substring(root.Length);
                if (_byRelative.TryGetValue(relative, out var exact))
                    return new Match(MatchKind.Mapped, exact, "vaultPath");
                // The file may have moved in the vault since; fall through to the tail match.
                break;
            }

            var name = Path.GetFileName(normalized);
            if (string.IsNullOrEmpty(name) || !_byName.TryGetValue(name, out var sameName))
                return new Match(MatchKind.Missing, null, null);

            var referenceSegments = Segments(normalized);
            var best = 0;
            var winners = new List<string>();
            foreach (var candidate in sameName)
            {
                var common = CommonTail(referenceSegments, Segments(candidate.Substring(_packageRoot.Length)));
                if (common > best)
                {
                    best = common;
                    winners.Clear();
                    winners.Add(candidate);
                }
                else if (common == best)
                {
                    winners.Add(candidate);
                }
            }

            if (winners.Count == 1)
                return new Match(MatchKind.Mapped, winners[0], best > 1 ? "pathSuffix" : "fileName");

            return new Match(MatchKind.Ambiguous, null, null, winners);
        }

        /// <summary>True when <paramref name="path"/> is strictly inside <paramref name="root"/>.</summary>
        public static bool IsUnder(string path, string root)
        {
            var normalizedRoot = NormalizeRoot(root);
            var normalizedPath = NormalizePath(path);
            return normalizedPath.Length > normalizedRoot.Length
                && normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Backslashes, no "." or "..", no trailing separator. Throws on a malformed path.</summary>
        public static string NormalizePath(string path)
        {
            var slashed = path.Trim().Replace('/', '\\');
            // GetFullPath collapses "..", which is what keeps a crafted "pkg\..\vault\x" outside.
            var full = Path.GetFullPath(slashed);
            return full.Length > 3 ? full.TrimEnd('\\') : full;
        }

        /// <summary>A folder path with exactly one trailing separator, for prefix tests.</summary>
        public static string NormalizeRoot(string root)
        {
            var full = NormalizePath(root);
            return full.EndsWith("\\", StringComparison.Ordinal) ? full : full + "\\";
        }

        private static string[] Segments(string path) =>
            path.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);

        private static int CommonTail(string[] a, string[] b)
        {
            var count = 0;
            while (count < a.Length && count < b.Length
                && string.Equals(a[a.Length - 1 - count], b[b.Length - 1 - count], StringComparison.OrdinalIgnoreCase))
            {
                count++;
            }
            return count;
        }
    }
}
