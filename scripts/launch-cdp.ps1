Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c cd /d C:\Users\rhlin\Desktop\Attempt3\MotiveRevival && node_modules\.bin\electron.cmd . --remote-debugging-port=9222 1> "%TEMP%\mr-out.log" 2> "%TEMP%\mr-err.log"' }
Write-Output ("create:" + $r.ReturnValue)
Start-Sleep 7
$count = (Get-Process -Name electron -ErrorAction SilentlyContinue).Count
Write-Output ("procs:" + $count)
