Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
InstallRoot = ScriptDir
If FSO.FileExists(ScriptDir & "\..\engine\dist\server.js") Then
  InstallRoot = FSO.GetParentFolderName(ScriptDir)
End If

Bat = InstallRoot & "\handle-ctrack-protocol.bat"
If Not FSO.FileExists(Bat) Then Bat = ScriptDir & "\handle-ctrack-protocol.bat"

Url = ""
If WScript.Arguments.Count > 0 Then Url = WScript.Arguments(0)

Cmd = """" & Bat & """ """ & Url & """"
WshShell.Run Cmd, 0, False
