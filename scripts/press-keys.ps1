param([int[]]$Keys)
# Presses virtual keys one after another at OS level (like a real keyboard).
Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);'
foreach ($k in $Keys) {
  [W.K]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [W.K]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}
