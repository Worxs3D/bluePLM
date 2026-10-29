// Records what "Open in eDrawings" handed the viewer: its arguments, and whether the first one
// is a file this process can read. The log path comes from BLUEPLM_CI_VIEWER_LOG. The log is
// written once on start and again when the read finishes, so a slow read shows as "started".
using System.Text.Json;

var logPath = Environment.GetEnvironmentVariable("BLUEPLM_CI_VIEWER_LOG");
if (string.IsNullOrEmpty(logPath)) return 2;
File.WriteAllText(logPath, JsonSerializer.Serialize(new { stage = "started", args }));
var first = args.Length > 0 ? args[0] : null;
var readable = false;
if (first is not null)
{
    try
    {
        using var stream = File.OpenRead(first);
        readable = stream.ReadByte() >= 0;
    }
    catch
    {
        readable = false;
    }
}
File.WriteAllText(logPath, JsonSerializer.Serialize(new { stage = "done", args, readable }));
return 0;
