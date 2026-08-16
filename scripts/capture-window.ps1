param([string]$OutputPath = '.\release\overlay-qa.png')

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DesktopWindowCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
'@
Add-Type -AssemblyName System.Drawing

$process = Get-Process -Name 'DeepSeek Harness' -ErrorAction Stop |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
if ($null -eq $process) { throw 'DeepSeek Harness main window not found' }

$handle = $process.MainWindowHandle
[DesktopWindowCapture]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object DesktopWindowCapture+RECT
if (-not [DesktopWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'Could not read window bounds' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $deviceContext = $graphics.GetHdc()
    try {
        if (-not [DesktopWindowCapture]::PrintWindow($handle, $deviceContext, 2)) { throw 'PrintWindow failed' }
    } finally {
        $graphics.ReleaseHdc($deviceContext)
    }
    $resolved = [System.IO.Path]::GetFullPath($OutputPath)
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolved)) | Out-Null
    $bitmap.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $resolved
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
