Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = Chr(34) & shell.ExpandEnvironmentStrings("%ComSpec%") & Chr(34) & " /d /s /c " & Chr(34) & Chr(34) & root & "\carecast-start.bat" & Chr(34) & Chr(34)
shell.Run command, 0, False
