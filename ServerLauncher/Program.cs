using System.Diagnostics;
var root=AppContext.BaseDirectory;
var python=Path.Combine(root,".venv","Scripts","python.exe");
var script=Path.Combine(root,"server.py");
if(!File.Exists(python)){Console.WriteLine("Run setup_server.bat first.");Console.ReadKey();return;}
using var p=Process.Start(new ProcessStartInfo{FileName=python,Arguments=$"\"{script}\"",WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=false});
p!.WaitForExit();