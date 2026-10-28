param([string]$VcVars='D:\VS2013\VC\vcvarsall.bat')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(!(Test-Path -LiteralPath $VcVars)){throw 'Provide the Visual C++ environment script.'}
$build=Join-Path $root 'state\hook\mention-build';$output=Join-Path $root 'state\hook\mentions'
New-Item -ItemType Directory -Path $build,$output -Force|Out-Null
$cpp=Join-Path $PSScriptRoot 'native-hook\mention_sender.cpp';$dll=Join-Path $output 'WeChatMentions.dll'
$command='call "'+$VcVars+'" amd64 >nul && cl /nologo /LD /MT /EHsc /O2 /D_WIN32_WINNT=0x0601 "'+$cpp+'" /link /OUT:"'+$dll+'" kernel32.lib'
$script=Join-Path $build 'build.cmd';[IO.File]::WriteAllText($script,$command,[Text.Encoding]::Default)
Push-Location $build
try{& cmd.exe /d /c $script;if($LASTEXITCODE){throw 'Mention companion build failed.'}}finally{Pop-Location}
@{version=2;targetVersion='4.1.10.27';weixinSha256='f487e4f56930456a25fb0d7b058c77e2dcd364e268d49bdfff4dc0e3be26ba36';sha256=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant();backend='text-atlist-v2';sourceSha256=(Get-FileHash -LiteralPath $cpp -Algorithm SHA256).Hash.ToLowerInvariant();upstreamCommit='e905d07ade50d2c6472e4eb3bd4f3fe19cf662c6'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $output 'build.json') -Encoding UTF8
