using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Point every file of a review package at the copies inside the package, headlessly.
    ///
    /// The renderer downloads a drawing and its dependency closure, at pinned versions, into
    /// <c>&lt;package&gt;\&lt;vault-relative path&gt;</c>. Each assembly and drawing still stores the
    /// absolute paths it was saved with, so opening it would load whatever sits at those paths - the
    /// current vault copy, not the pinned version. This rewrites the stored paths through Document
    /// Manager's ReplaceReference, the same call DuplicateWithReferences uses, so no SOLIDWORKS seat
    /// is needed.
    ///
    /// Safety: only files inside the package folder are opened for writing, and a replacement only
    /// ever points inside the package. The read-only attribute is cleared just for the save and put
    /// back afterwards.
    /// </summary>
    public partial class DocumentManagerAPI
    {
        public const string RetargetOutsidePackageCode = "OUTSIDE_PACKAGE";
        public const string RetargetPackageRootInvalidCode = "PACKAGE_ROOT_INVALID";
        public const string RetargetFileNotFoundCode = "FILE_NOT_FOUND";
        public const string RetargetUnsupportedTypeCode = "UNSUPPORTED_FILE_TYPE";
        public const string RetargetOpenFailedCode = "DM_OPEN_FAILED";
        public const string RetargetReplaceFailedCode = "DM_REPLACE_FAILED";
        public const string RetargetSaveFailedCode = "DM_SAVE_FAILED";
        public const string RetargetNotVerifiedCode = "RETARGET_NOT_VERIFIED";
        public const string RetargetFailedCode = "RETARGET_FAILED";

        /// <summary>
        /// Reference read for retargeting. No search paths and no root-folder search, so Document
        /// Manager hands back the path stored in the file instead of a copy it found in the package
        /// folder. Resolving to the package copy would make a stale reference look already retargeted.
        /// </summary>
        private const SwDmSearchFilter StoredReferenceFilters =
            SwDmSearchFilter.ExternalReference | SwDmSearchFilter.InContextReference;

        private static readonly string[] DefaultParentExtensions = { ".sldasm", ".slddrw" };
        private static readonly string[] RetargetableExtensions = { ".sldasm", ".slddrw", ".sldprt" };

        /// <param name="packageRoot">Absolute package folder.</param>
        /// <param name="files">
        /// Files to retarget, absolute or relative to the package. Null or empty: every .sldasm and
        /// .slddrw in the package.
        /// </param>
        /// <param name="vaultRoots">Optional local vault roots, for exact vault-relative matching.</param>
        public CommandResult RetargetReferences(string? packageRoot, IReadOnlyList<string>? files, IReadOnlyList<string>? vaultRoots)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available", ErrorCode = "DM_UNAVAILABLE" };

            string root;
            try
            {
                if (string.IsNullOrWhiteSpace(packageRoot) || !Path.IsPathRooted(packageRoot))
                    throw new ArgumentException("'packageRoot' must be an absolute folder path");
                root = ReferenceRetargetPlanner.NormalizeRoot(packageRoot!);
                // A drive root would make the whole drive "the package".
                if (string.Equals(root, Path.GetPathRoot(root), StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("'packageRoot' cannot be a drive root");
                if (!Directory.Exists(root))
                    throw new ArgumentException($"Package folder not found: {packageRoot}");
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorCode = RetargetPackageRootInvalidCode };
            }

            var packageFiles = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                // SOLIDWORKS lock files sit next to open documents and are never references.
                .Where(f => !Path.GetFileName(f).StartsWith("~$", StringComparison.Ordinal))
                .ToList();
            var planner = new ReferenceRetargetPlanner(root, packageFiles, vaultRoots);

            var targets = files != null && files.Count > 0
                ? files.Where(f => !string.IsNullOrWhiteSpace(f)).Select(f => Path.IsPathRooted(f) ? f : Path.Combine(root, f)).ToList()
                : packageFiles.Where(f => DefaultParentExtensions.Contains(Path.GetExtension(f).ToLowerInvariant())).ToList();

            Console.Error.WriteLine($"[DM-API] RetargetReferences: {targets.Count} file(s) in {root} ({packageFiles.Count} package files)");

            var results = targets.Select(t => RetargetOneFile(t, planner)).ToList();

            return new CommandResult
            {
                Success = true,
                Data = new
                {
                    packageRoot = root.TrimEnd('\\'),
                    files = results,
                    summary = new
                    {
                        total = results.Count,
                        retargeted = results.Count(r => r.Status == "retargeted"),
                        unchanged = results.Count(r => r.Status == "unchanged"),
                        failed = results.Count(r => r.Status == "failed"),
                        missingReferences = results.Sum(r => r.References.Count(x => x.Status == "missing" || x.Status == "ambiguous")),
                    },
                },
            };
        }

        /// <summary>Wire shape of one file's outcome.</summary>
        public sealed class RetargetFileResult
        {
            [Newtonsoft.Json.JsonProperty("filePath")] public string FilePath { get; set; } = "";
            /// <summary>"retargeted" | "unchanged" | "failed".</summary>
            [Newtonsoft.Json.JsonProperty("status")] public string Status { get; set; } = "failed";
            [Newtonsoft.Json.JsonProperty("references")] public List<RetargetReferenceResult> References { get; set; } = new();
            [Newtonsoft.Json.JsonProperty("errorCode", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)] public string? ErrorCode { get; set; }
            [Newtonsoft.Json.JsonProperty("error", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)] public string? Error { get; set; }
        }

        /// <summary>Wire shape of one stored reference's outcome.</summary>
        public sealed class RetargetReferenceResult
        {
            [Newtonsoft.Json.JsonProperty("oldPath")] public string OldPath { get; set; } = "";
            [Newtonsoft.Json.JsonProperty("newPath", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)] public string? NewPath { get; set; }
            /// <summary>"retargeted" | "unchanged" | "missing" | "ambiguous".</summary>
            [Newtonsoft.Json.JsonProperty("status")] public string Status { get; set; } = "missing";
            /// <summary>"package" | "vaultPath" | "pathSuffix" | "fileName".</summary>
            [Newtonsoft.Json.JsonProperty("matchedBy", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)] public string? MatchedBy { get; set; }
            [Newtonsoft.Json.JsonProperty("candidates", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)] public List<string>? Candidates { get; set; }
        }

        private RetargetFileResult RetargetOneFile(string requestedPath, ReferenceRetargetPlanner planner)
        {
            var result = new RetargetFileResult { FilePath = requestedPath };

            string filePath;
            try
            {
                filePath = ReferenceRetargetPlanner.NormalizePath(requestedPath);
            }
            catch (Exception ex)
            {
                return Fail(result, RetargetOutsidePackageCode, $"Invalid path: {ex.Message}");
            }
            result.FilePath = filePath;

            if (!ReferenceRetargetPlanner.IsUnder(filePath, planner.PackageRoot))
                return Fail(result, RetargetOutsidePackageCode, "Refused: the file is outside the package folder");
            if (!RetargetableExtensions.Contains(Path.GetExtension(filePath).ToLowerInvariant()))
                return Fail(result, RetargetUnsupportedTypeCode, "Only .sldasm, .slddrw and .sldprt files carry references");
            if (!File.Exists(filePath))
                return Fail(result, RetargetFileNotFoundCode, "File not found");

            var fileLock = GetFileLock(filePath);
            fileLock.Wait();
            object? doc = null;
            FileAttributes? restoreAttributes = null;
            try
            {
                var attributes = File.GetAttributes(filePath);
                if (attributes.HasFlag(FileAttributes.ReadOnly))
                {
                    File.SetAttributes(filePath, attributes & ~FileAttributes.ReadOnly);
                    restoreAttributes = attributes;
                }

                doc = OpenDocumentForWrite(filePath, out var openError);
                if (doc == null)
                {
                    var code = (SwDmDocumentOpenError)openError switch
                    {
                        SwDmDocumentOpenError.FileReadOnly => FileReadOnlyCode,
                        SwDmDocumentOpenError.FutureVersion => "DM_FUTURE_VERSION",
                        SwDmDocumentOpenError.NoLicense => "DM_NO_LICENSE",
                        _ => RetargetOpenFailedCode,
                    };
                    return Fail(result, code, $"Could not open for writing: {DescribeOpenError(openError)}");
                }

                var searchOpt = CreateReferenceSearchOption(Array.Empty<string>(), StoredReferenceFilters);
                if (searchOpt == null)
                    return Fail(result, ReferencesUnresolvedCode, "Document Manager would not create a search option");

                var read = ReadExternalReferences(doc, searchOpt);
                if (!read.IsResolved)
                    return Fail(result, ReferencesUnresolvedCode, read.Detail ?? "references could not be read");

                var replacements = new List<(string OldPath, string NewPath)>();
                foreach (var reference in read.References)
                {
                    var match = planner.Resolve(reference.Path);
                    var entry = new RetargetReferenceResult { OldPath = reference.Path, MatchedBy = match.Rule };
                    switch (match.Kind)
                    {
                        case ReferenceRetargetPlanner.MatchKind.AlreadyInPackage:
                            entry.Status = "unchanged";
                            entry.NewPath = match.NewPath;
                            break;
                        case ReferenceRetargetPlanner.MatchKind.Mapped:
                            entry.Status = "retargeted";
                            entry.NewPath = match.NewPath;
                            replacements.Add((reference.Path, match.NewPath!));
                            break;
                        case ReferenceRetargetPlanner.MatchKind.Ambiguous:
                            entry.Status = "ambiguous";
                            entry.Candidates = match.Candidates.ToList();
                            break;
                        default:
                            entry.Status = "missing";
                            break;
                    }
                    result.References.Add(entry);
                }

                if (replacements.Count == 0)
                {
                    result.Status = "unchanged";
                    return result;
                }

                foreach (var (oldPath, newPath) in replacements)
                {
                    // Both guaranteed by the planner; checked again because this is the write.
                    if (!ReferenceRetargetPlanner.IsUnder(newPath, planner.PackageRoot))
                        return Fail(result, RetargetOutsidePackageCode, $"Refused replacement outside the package: {newPath}");
                    try
                    {
                        InvokeReplaceReference(doc, oldPath, newPath);
                    }
                    catch (Exception ex)
                    {
                        var message = ex.InnerException?.Message ?? ex.Message;
                        return Fail(result, RetargetReplaceFailedCode, $"ReplaceReference failed for {Path.GetFileName(oldPath)}: {message}");
                    }
                }

                var saveError = SaveDocument(doc);
                if (saveError != SwDmDocumentSaveError.None)
                {
                    return Fail(
                        result,
                        saveError == SwDmDocumentSaveError.ReadOnly ? FileReadOnlyCode : RetargetSaveFailedCode,
                        $"Save refused: {DescribeSaveError(saveError)}");
                }

                try { ((dynamic)doc).CloseDoc(); } catch { }
                LogDocClose(filePath);
                doc = null;

                var unverified = VerifyRetarget(filePath, replacements, out var verifyDetail);
                if (unverified)
                    return Fail(result, RetargetNotVerifiedCode, verifyDetail);

                result.Status = "retargeted";
                Console.Error.WriteLine($"[DM-API] Retargeted {replacements.Count} reference(s) in {Path.GetFileName(filePath)}");
                return result;
            }
            catch (Exception ex)
            {
                return Fail(result, RetargetFailedCode, ex.Message);
            }
            finally
            {
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                    LogDocClose(filePath);
                }
                if (restoreAttributes.HasValue)
                {
                    try { File.SetAttributes(filePath, restoreAttributes.Value); }
                    catch (Exception ex) { Console.Error.WriteLine($"[DM-API] Could not restore attributes on {Path.GetFileName(filePath)}: {ex.Message}"); }
                }
                fileLock.Release();
            }
        }

        /// <summary>
        /// Re-open read-only and confirm every new path is stored and no replaced old path remains.
        /// Returns true when the rewrite could NOT be verified.
        /// </summary>
        private bool VerifyRetarget(string filePath, IReadOnlyList<(string OldPath, string NewPath)> replacements, out string detail)
        {
            object? doc = null;
            try
            {
                doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                {
                    detail = $"could not re-open ({DescribeOpenError(openError)})";
                    return true;
                }

                var searchOpt = CreateReferenceSearchOption(Array.Empty<string>(), StoredReferenceFilters);
                if (searchOpt == null)
                {
                    detail = "could not create search options";
                    return true;
                }

                var read = ReadExternalReferences(doc, searchOpt);
                if (!read.IsResolved)
                {
                    detail = read.Detail ?? "references could not be read";
                    return true;
                }

                var stored = new HashSet<string>(read.References.Select(r => r.Path), StringComparer.OrdinalIgnoreCase);
                var absent = replacements.Where(r => !stored.Contains(r.NewPath)).Select(r => Path.GetFileName(r.NewPath)).ToList();
                // An old path equal to its new path (case only) is not a leftover.
                var leftover = replacements
                    .Where(r => !string.Equals(r.OldPath, r.NewPath, StringComparison.OrdinalIgnoreCase) && stored.Contains(r.OldPath))
                    .Select(r => r.OldPath)
                    .ToList();

                if (absent.Count == 0 && leftover.Count == 0)
                {
                    detail = "";
                    return false;
                }

                detail = $"after save, missing new references [{string.Join(", ", absent)}], old references still stored [{string.Join(", ", leftover)}]";
                return true;
            }
            catch (Exception ex)
            {
                detail = ex.Message;
                return true;
            }
            finally
            {
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                    LogDocClose(filePath);
                }
            }
        }

        private static RetargetFileResult Fail(RetargetFileResult result, string code, string message)
        {
            result.Status = "failed";
            result.ErrorCode = code;
            result.Error = message;
            Console.Error.WriteLine($"[DM-API] Retarget failed for {Path.GetFileName(result.FilePath)} ({code}): {message}");
            return result;
        }
    }
}
