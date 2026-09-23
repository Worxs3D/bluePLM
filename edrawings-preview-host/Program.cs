using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace BluePLM.EDrawingsPreviewHost;

internal static class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(IntPtr handle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    internal const uint NoActivate = 0x0010;
    internal const uint ShowWindow = 0x0040;
}

internal sealed class EDrawingsControl : AxHost
{
    private const string ProgId = "EModelView.EModelViewControl";

    public EDrawingsControl() : base(ResolveClsid())
    { }

    private static string ResolveClsid()
    {
        var type = Type.GetTypeFromProgID(ProgId, throwOnError: false)
            ?? throw new InvalidOperationException($"The eDrawings ActiveX control ({ProgId}) is not registered.");
        return type.GUID.ToString("B");
    }

    public void OpenDocument(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("The preview file does not exist.", path);
        var control = GetOcx() ?? throw new InvalidOperationException("The eDrawings ActiveX control did not initialize.");
        var method = control.GetType().GetMethod("OpenDoc", BindingFlags.Instance | BindingFlags.Public)
            ?? control.GetType().GetMethod("OpenDocument", BindingFlags.Instance | BindingFlags.Public);
        if (method is null) throw new MissingMethodException("The installed eDrawings control does not expose OpenDoc.");
        var parameters = method.GetParameters();
        var args = parameters.Length switch
        {
            1 => new object?[] { path },
            2 => new object?[] { path, false },
            3 => new object?[] { path, false, false },
            4 => new object?[] { path, false, false, true },
            _ => new object?[] { path, false, false, true, string.Empty },
        };
        method.Invoke(control, args);
    }
}

internal sealed class PreviewForm : Form
{
    private readonly IntPtr _parent;
    private readonly string _handleFile;
    private readonly int _x;
    private readonly int _y;
    private readonly int _width;
    private readonly int _height;
    private readonly string _file;
    private EDrawingsControl? _control;

    public PreviewForm(IReadOnlyDictionary<string, string> args)
    {
        _parent = ParseHandle(args, "parent");
        _handleFile = Require(args, "handle-file");
        _file = Require(args, "file");
        _x = ParseInt(args, "x", 0);
        _y = ParseInt(args, "y", 0);
        _width = Math.Max(1, ParseInt(args, "width", 1));
        _height = Math.Max(1, ParseInt(args, "height", 1));
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        ControlBox = false;
        MinimizeBox = false;
        MaximizeBox = false;
        BackColor = Color.Black;
        Load += OnLoaded;
        FormClosed += (_, _) => _control?.Dispose();
    }

    private void OnLoaded(object? sender, EventArgs e)
    {
        if (_parent == IntPtr.Zero || !NativeMethods.SetParent(Handle, _parent).Equals(_parent))
            throw new InvalidOperationException("Could not attach the eDrawings host to BluePLM.");
        NativeMethods.SetWindowPos(Handle, IntPtr.Zero, _x, _y, _width, _height,
            NativeMethods.NoActivate | NativeMethods.ShowWindow);
        try
        {
            _control = new EDrawingsControl { Dock = DockStyle.Fill };
            Controls.Add(_control);
            _control.CreateControl();
            _control.OpenDocument(_file);
            File.WriteAllText(_handleFile, Handle.ToInt64().ToString(), Encoding.ASCII);
        }
        catch
        {
            File.WriteAllText(_handleFile, "0", Encoding.ASCII);
            throw;
        }
    }

    private static string Require(IReadOnlyDictionary<string, string> args, string key) =>
        args.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException($"Missing --{key}.");

    private static int ParseInt(IReadOnlyDictionary<string, string> args, string key, int fallback) =>
        args.TryGetValue(key, out var value) && int.TryParse(value, out var parsed) ? parsed : fallback;

    private static IntPtr ParseHandle(IReadOnlyDictionary<string, string> args, string key) =>
        args.TryGetValue(key, out var value) && long.TryParse(value, out var parsed) ? new IntPtr(parsed) : IntPtr.Zero;
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] argv)
    {
        try
        {
            ApplicationConfiguration.Initialize();
            var args = ParseArguments(argv);
            Application.Run(new PreviewForm(args));
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Environment.ExitCode = 1;
        }
    }

    private static IReadOnlyDictionary<string, string> ParseArguments(string[] argv)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i + 1 < argv.Length; i += 2)
        {
            if (argv[i].StartsWith("--", StringComparison.Ordinal)) result[argv[i][2..]] = argv[i + 1];
        }
        return result;
    }
}
