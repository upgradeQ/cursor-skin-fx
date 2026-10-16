<#
.SYNOPSIS
Tiles preview PNGs into one image (2 columns) for quick side-by-side review.
#>
param(
	[Parameter(Mandatory)] [string]$Paths,  # comma-separated
	[Parameter(Mandatory)] [string]$Out,
	[int]$Columns = 2,
	[double]$Scale = 0.5
)
$files = @($Paths -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Add-Type -AssemblyName System.Drawing
$images = @($files | ForEach-Object { [System.Drawing.Bitmap]::FromFile((Resolve-Path $_)) })
$tw = [int]($images[0].Width * $Scale)
$th = [int]($images[0].Height * $Scale)
$rows = [math]::Ceiling($images.Count / $Columns)
$dst = New-Object System.Drawing.Bitmap ($tw * $Columns), ($th * $rows)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font = New-Object System.Drawing.Font "Segoe UI", 11
for ($i = 0; $i -lt $images.Count; $i++) {
	$x = ($i % $Columns) * $tw
	$y = [math]::Floor($i / $Columns) * $th
	$g.DrawImage($images[$i], $x, $y, $tw, $th)
	$g.DrawString([IO.Path]::GetFileNameWithoutExtension($files[$i]), $font, [System.Drawing.Brushes]::Gray, $x + 6, $y + 4)
}
$dst.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $images | ForEach-Object { $_.Dispose() }
$Out
