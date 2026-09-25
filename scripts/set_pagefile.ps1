# 관리자 권한으로 실행됨 — C: pagefile을 고정 8~16GB로 설정
$ErrorActionPreference = 'Stop'
$log = @()

try {
    $cs = Get-WmiObject Win32_ComputerSystem
    if ($cs.AutomaticManagedPagefile) {
        $cs.AutomaticManagedPagefile = $false
        $cs.Put() | Out-Null
        $log += 'automatic-managed-pagefile: disabled'
    } else {
        $log += 'automatic-managed-pagefile: already off'
    }

    $pf = Get-WmiObject Win32_PageFileSetting | Where-Object { $_.Name -eq 'C:\pagefile.sys' }
    if ($pf) {
        $pf.InitialSize = 8192
        $pf.MaximumSize = 16384
        $pf.Put() | Out-Null
        $log += 'C: pagefile set to 8192-16384 MB'
    } else {
        Set-WmiInstance -Class Win32_PageFileSetting -Arguments @{Name='C:\pagefile.sys'; InitialSize=8192; MaximumSize=16384} | Out-Null
        $log += 'C: pagefile created at 8192-16384 MB'
    }
} catch {
    $log += 'ERROR: ' + $_.Exception.Message
}

$log += '--- final settings ---'
Get-CimInstance Win32_PageFileSetting | ForEach-Object {
    $log += ('{0} : initial={1}MB max={2}MB' -f $_.Name, $_.InitialSize, $_.MaximumSize)
}

$log | Out-File 'C:\pagefile_result.txt' -Encoding utf8
