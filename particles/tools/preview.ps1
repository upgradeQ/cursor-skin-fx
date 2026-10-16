<#
.SYNOPSIS
Renders cursor VFX preview frames offline, without OBS.

.DESCRIPTION
Loads OBS's own LuaJIT (lua51.dll) into this PowerShell process and runs
tools/preview.lua, which creates a standalone D3D11 device, drives an effect
with a scripted cursor path and writes PNG snapshots plus a log with GPU
timings and any D3D11 debug-layer messages.

.EXAMPLE
pwsh -File tools/preview.ps1 -Effect ribbon
pwsh -File tools/preview.ps1 -Effect glass_dust -Set "sparkle=8,flare=14"
#>
param(
	[ValidateSet("ribbon", "magic", "glass_dust")]
	[string]$Effect = "magic",
	[int]$Width = 960,
	[int]$Height = 540,
	[int]$Frames = 240,
	[string]$Snapshots = "90,150,200,236",
	[string]$Set = "",
	[string]$Script = "preview.lua",
	[ValidateSet("desktop", "black")]
	[string]$Backdrop = "desktop",
	[string]$OutDir = (Join-Path $PSScriptRoot "..\preview"),
	[string]$ObsBin = "C:\Program Files\obs-studio\bin\64bit",
	[switch]$NoDebugLayer
)

$ErrorActionPreference = "Stop"
$luaDll = Join-Path $ObsBin "lua51.dll"
if (-not (Test-Path $luaDll)) {
	throw "lua51.dll not found in $ObsBin (pass -ObsBin)"
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path.Replace('\', '/') + '/'
$out = (Resolve-Path $OutDir).Path.Replace('\', '/')

if (-not ("VfxLuaHost" -as [type])) {
	Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class VfxLuaHost {
	const string Lib = @"$luaDll";
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr luaL_newstate();
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void luaL_openlibs(IntPtr L);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern int luaL_loadfile(IntPtr L, [MarshalAs(UnmanagedType.LPStr)] string path);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern int lua_pcall(IntPtr L, int nargs, int nresults, int errfunc);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr lua_tolstring(IntPtr L, int idx, IntPtr len);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void lua_pushstring(IntPtr L, [MarshalAs(UnmanagedType.LPStr)] string s);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void lua_setfield(IntPtr L, int idx, [MarshalAs(UnmanagedType.LPStr)] string k);
	[DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void lua_close(IntPtr L);
}
"@
}

$LUA_GLOBALSINDEX = -10002
$L = [VfxLuaHost]::luaL_newstate()
[VfxLuaHost]::luaL_openlibs($L)
$globals = [ordered]@{
	VFX_ROOT   = $root
	VFX_OUT    = $out
	VFX_EFFECT = $Effect
	VFX_W      = "$Width"
	VFX_H      = "$Height"
	VFX_FRAMES = "$Frames"
	VFX_SNAPS  = $Snapshots
	VFX_SET    = $Set
	VFX_BG     = $Backdrop
	VFX_DEBUG  = $(if ($NoDebugLayer) { "0" } else { "1" })
}
foreach ($k in $globals.Keys) {
	[VfxLuaHost]::lua_pushstring($L, $globals[$k])
	[VfxLuaHost]::lua_setfield($L, $LUA_GLOBALSINDEX, $k)
}

$rc = [VfxLuaHost]::luaL_loadfile($L, (Join-Path $PSScriptRoot $Script))
if ($rc -eq 0) {
	$rc = [VfxLuaHost]::lua_pcall($L, 0, 0, 0)
}
if ($rc -ne 0) {
	$msg = [Runtime.InteropServices.Marshal]::PtrToStringAnsi([VfxLuaHost]::lua_tolstring($L, -1, [IntPtr]::Zero))
	Write-Host "Lua error: $msg"
}
[VfxLuaHost]::lua_close($L)
exit $rc
