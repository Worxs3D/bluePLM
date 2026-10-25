using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The C# half of the SolidWorks service wire contract, <c>solidworks-service/wire-manifest.json</c>.
    /// <c>electron/handlers/solidworksWire.contract.test.ts</c> checks the TypeScript half against the
    /// same file, so an action, request field or error code renamed on one side only fails one of them.
    ///
    /// This reads the service source as text and reflects over its types. It needs no SolidWorks, no
    /// Document Manager licence and no COM, hence the Headless trait.
    /// </summary>
    [Trait("Category", "Headless")]
    public class WireManifestTests
    {
        static string ThisFile([CallerFilePath] string path = "") => path;

        static string ServiceRoot =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(ThisFile())!, ".."));

        static JObject Manifest =>
            JObject.Parse(File.ReadAllText(Path.Combine(ServiceRoot, "wire-manifest.json")));

        static string ProgramSource =>
            File.ReadAllText(Path.Combine(ServiceRoot, "BluePLM.SolidWorksService", "Program.cs"));

        static string AllServiceSource =>
            string.Join("\n", Directory
                .GetFiles(Path.Combine(ServiceRoot, "BluePLM.SolidWorksService"), "*.cs", SearchOption.AllDirectories)
                .Where(f => !f.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar)
                         && !f.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar))
                .Select(File.ReadAllText));

        /// <summary>Action name to the text of its switch arm in ProcessCommand.</summary>
        static Dictionary<string, string> SwitchArms()
        {
            var src = ProgramSource;
            var start = src.IndexOf("var result = action switch", StringComparison.Ordinal);
            var end = src.IndexOf("_ => UnknownAction(action)", start, StringComparison.Ordinal);
            Assert.True(start >= 0 && end > start, "ProcessCommand's action switch was not found in Program.cs");

            var parts = Regex.Split(src.Substring(start, end - start), "\\n\\s*\"(\\w+)\"\\s*=>");
            var arms = new Dictionary<string, string>();
            for (var i = 1; i + 1 < parts.Length; i += 2) arms[parts[i]] = parts[i + 1];
            return arms;
        }

        /// <summary>Body of a static method in Program.cs, up to the next member at the same indent.</summary>
        static string MethodBody(string source, string name)
        {
            var m = Regex.Match(source, "\\n\\s*(?:public |private |internal )?static [^\\n=;]*\\b" + name + "\\(");
            if (!m.Success) return "";
            var rest = source.Substring(m.Index + 1);
            var next = Regex.Match(rest.Substring(1), "\\n {8}(?:public |private |internal )?static |\\n {8}/// ");
            return next.Success ? rest.Substring(0, next.Index + 1) : rest;
        }

        /// <summary>The command fields an action reads: in its arm, and in Program.cs helpers the arm calls.</summary>
        static HashSet<string> FieldsRead(string arm)
        {
            var src = ProgramSource;
            var bodies = new List<string> { arm };
            foreach (Match call in Regex.Matches(arm, "\\b([A-Z]\\w+)\\("))
                bodies.Add(MethodBody(src, call.Groups[1].Value));

            var fields = new HashSet<string>();
            foreach (var body in bodies)
                foreach (Match read in Regex.Matches(body, "command\\[\"(\\w+)\"\\]"))
                    fields.Add(read.Groups[1].Value);
            fields.Remove("filePath");
            return fields;
        }

        [Fact]
        public void The_action_switch_has_exactly_the_manifest_actions()
        {
            var inSwitch = SwitchArms().Keys.OrderBy(a => a, StringComparer.Ordinal).ToList();
            var inManifest = ((JObject)Manifest["actions"]!).Properties().Select(p => p.Name)
                .OrderBy(a => a, StringComparer.Ordinal).ToList();

            Assert.Equal(inManifest, inSwitch);
        }

        [Fact]
        public void Each_action_reads_the_manifest_fields_and_ignores_only_the_listed_ones()
        {
            var actions = (JObject)Manifest["actions"]!;
            var problems = new List<string>();

            foreach (var arm in SwitchArms())
            {
                var entry = (JObject?)actions[arm.Key];
                if (entry == null) continue; // reported by the switch test
                var request = new HashSet<string>(entry["request"]!.Values<string>()!);
                var ignored = new HashSet<string>(((JObject?)entry["ignoredByService"])?.Properties().Select(p => p.Name)
                                                  ?? Enumerable.Empty<string>());
                var read = FieldsRead(arm.Value);

                foreach (var f in read.Where(f => !request.Contains(f)))
                    problems.Add($"{arm.Key} reads '{f}', which the manifest does not list");
                foreach (var f in request.Where(f => !read.Contains(f) && !ignored.Contains(f)))
                    problems.Add($"{arm.Key} lists '{f}', which the service does not read (move it to ignoredByService or drop it)");
                foreach (var f in ignored.Where(read.Contains))
                    problems.Add($"{arm.Key} now reads '{f}': remove it from ignoredByService");
            }

            Assert.Empty(problems);
        }

        [Fact]
        public void CommandResult_serializes_exactly_the_manifest_response_fields()
        {
            var names = typeof(CommandResult).GetProperties()
                .Select(p => p.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName)
                .Where(n => n != null)
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToList();
            var expected = Manifest["responseFields"]!.Values<string>()!
                .OrderBy(n => n, StringComparer.Ordinal).ToList();

            Assert.Equal(expected, names);
        }

        [Fact]
        public void Every_ComErrorCode_is_in_the_manifest()
        {
            var expected = Manifest["errorCodes"]!["comErrorCode"]!.Values<string>()!
                .OrderBy(n => n, StringComparer.Ordinal).ToList();
            var actual = Enum.GetNames(typeof(ComErrorCode)).OrderBy(n => n, StringComparer.Ordinal).ToList();

            Assert.Equal(expected, actual);
        }

        [Fact]
        public void Every_error_code_the_service_sets_is_in_the_manifest_and_none_is_stale()
        {
            var src = AllServiceSource;
            var manifestCodes = new HashSet<string>(Manifest["errorCodes"]!["service"]!.Values<string>()!);

            // ErrorCode = "X", const string FooCode = "X", and the arms of an ErrorCode = ... switch.
            var emitted = new HashSet<string>();
            foreach (Match m in Regex.Matches(src, "ErrorCode\\s*=\\s*\"([A-Z][A-Z0-9_]+)\""))
                emitted.Add(m.Groups[1].Value);
            foreach (Match m in Regex.Matches(src, "const string \\w+Code\\s*=\\s*\"([A-Z][A-Z0-9_]+)\""))
                emitted.Add(m.Groups[1].Value);
            foreach (Match sw in Regex.Matches(src, "ErrorCode\\s*=\\s*\\w+\\s+switch\\s*\\{([^}]*)\\}"))
                foreach (Match arm in Regex.Matches(sw.Groups[1].Value, "=>\\s*\"([A-Z][A-Z0-9_]+)\""))
                    emitted.Add(arm.Groups[1].Value);

            Assert.Empty(emitted.Where(c => !manifestCodes.Contains(c)).OrderBy(c => c));
            Assert.Empty(manifestCodes.Where(c => !src.Contains("\"" + c + "\"")).OrderBy(c => c));
        }
    }
}
