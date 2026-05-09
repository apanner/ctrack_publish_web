' Shipped in release\ next to \engine. No console window. No tray icon (plain Node limitation).
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
engineDir = root & "\engine\"
embedded = root & "\runtime\node.exe"
Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = engineDir
If fso.FileExists(embedded) Then
  sh.Run """" & embedded & """ dist\server.js", 0, False
Else
  sh.Run "cmd /c node dist\server.js", 0, False
End If
