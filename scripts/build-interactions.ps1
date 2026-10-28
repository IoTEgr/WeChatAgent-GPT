param([string]$VcVars='D:\VS2013\VC\vcvarsall.bat',[string]$MinHookRoot='')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(!$MinHookRoot){$MinHookRoot=Join-Path $root 'components\WeChat-Hook\minhook'}
if(!(Test-Path -LiteralPath (Join-Path $MinHookRoot 'src\hook.c'))){throw 'MinHook source directory is required.'}
if(!(Test-Path -LiteralPath $VcVars)){throw 'Provide -VcVars pointing to the Visual C++ environment script.'}
$build=Join-Path $root 'state\hook\interaction-build';$output=Join-Path $root 'state\hook\interactions'
New-Item -ItemType Directory -Path $build,$output -Force|Out-Null
$cpp=Join-Path $PSScriptRoot 'native-hook\interaction_sender.cpp'
$dll=Join-Path $output 'WeChatInteractions.dll'
$sources=@('buffer.c','hook.c','trampoline.c','hde\hde64.c')|ForEach-Object {'"'+(Join-Path $MinHookRoot ('src\'+$_))+'"'}
$command='call "'+$VcVars+'" amd64 >nul && cl /nologo /LD /MT /EHsc /O2 /D_WIN32_WINNT=0x0601 /I"'+(Join-Path $MinHookRoot 'include')+'" "'+$cpp+'" '+($sources -join ' ')+' /link /MAP:interaction.map /OUT:"'+$dll+'" kernel32.lib'
$script=Join-Path $build 'build.cmd';[IO.File]::WriteAllText($script,$command,[Text.Encoding]::Default)
Push-Location $build
try{& cmd.exe /d /c $script;if($LASTEXITCODE){throw 'Interaction companion build failed.'}}finally{Pop-Location}
$hash=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
@{version=2;targetVersion='4.1.10.27';weixinSha256='f487e4f56930456a25fb0d7b058c77e2dcd364e268d49bdfff4dc0e3be26ba36';sha256=$hash;backend='pat-cgi-wire-v1';allowedCgi=@(849);sourceSha256=(Get-FileHash -LiteralPath $cpp).Hash.ToLowerInvariant()}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $output 'build.json') -Encoding UTF8
Write-Output ('Interaction companion compiled: '+$dll)
