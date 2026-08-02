Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
InstallRoot = ScriptDir
If FSO.FileExists(ScriptDir & "\..\engine\dist\server.js") Then
  InstallRoot = FSO.GetParentFolderName(ScriptDir)
End If

PyW = InstallRoot & "\runtime\python\pythonw.exe"
If Not FSO.FileExists(PyW) Then PyW = InstallRoot & "\engine\runtime\python\pythonw.exe"
If Not FSO.FileExists(PyW) Then PyW = InstallRoot & "\runtime\python\python.exe"
If Not FSO.FileExists(PyW) Then PyW = InstallRoot & "\engine\runtime\python\python.exe"

Cmd = """" & PyW & """ -m gui.settings_window --install-root """ & InstallRoot & """"
WshShell.CurrentDirectory = InstallRoot & "\engine\python"
WshShell.Run Cmd, 0, False
