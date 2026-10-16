<#
.SYNOPSIS
Crops a region of a preview PNG and scales it up (nearest neighbour) for inspection.
#>
param(
	[Parameter(Mandatory)] [string]$Path,
	[int]$X, [int]$Y, [int]$W = 240, [int]$H = 135,
	[int]$Scale = 4,
	[string]$Out = ""
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Path))
$dst = New-Object System.Drawing.Bitmap ($W * $Scale), ($H * $Scale)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, ($W * $Scale), ($H * $Scale)), (New-Object System.Drawing.Rectangle $X, $Y, $W, $H), [System.Drawing.GraphicsUnit]::Pixel)
if (-not $Out) { $Out = [IO.Path]::ChangeExtension($Path, $null) + "_crop.png" }
$dst.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
$Out
