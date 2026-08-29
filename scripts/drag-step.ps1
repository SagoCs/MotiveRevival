Add-Type @'
using System;
using System.Runtime.InteropServices;
public class XD {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
[XD]::SetCursorPos(720, 166)
Start-Sleep -Milliseconds 150
[XD]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
for ($i = 1; $i -le 12; $i++) {
  [XD]::SetCursorPos(720 + $i * 20, 169)
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 200
[XD]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
