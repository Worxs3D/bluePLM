# Win32 probes for scripts/edrawings-ci/system-check.cjs, at physical screen coordinates.
#   probe.ps1 point X Y  -> the process id owning the top-level window under that point
#   probe.ps1 click X Y  -> a real left click there (SendInput), then that process id
param(
  [Parameter(Mandatory = $true)][ValidateSet('point', 'click')][string]$Action,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BluePlmProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  // MOUSEINPUT is the largest member of the INPUT union, so this layout has the x64 size (40).
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static uint OwnerAt(int x, int y) {
    SetProcessDPIAware();
    var window = WindowFromPoint(new POINT { X = x, Y = y });
    if (window == IntPtr.Zero) return 0;
    var root = GetAncestor(window, 2);
    uint processId;
    GetWindowThreadProcessId(root == IntPtr.Zero ? window : root, out processId);
    return processId;
  }
  public static void Click(int x, int y) {
    SetProcessDPIAware();
    SetCursorPos(x, y);
    var inputs = new INPUT[2];
    inputs[0].type = 0; inputs[0].mi.dwFlags = 0x0002;
    inputs[1].type = 0; inputs[1].mi.dwFlags = 0x0004;
    if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) throw new InvalidOperationException("SendInput was refused.");
  }
}
'@
if ($Action -eq 'click') { [BluePlmProbe]::Click($X, $Y) }
[BluePlmProbe]::OwnerAt($X, $Y)
