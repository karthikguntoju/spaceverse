param(
    [string]$Source = (Join-Path $PSScriptRoot '..\models\discovery_space_shuttle.glb'),
    [string]$Destination = (Join-Path $PSScriptRoot '..\models\discovery_space_shuttle_web.glb')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $Source))
$jsonLength = [BitConverter]::ToInt32($sourceBytes, 12)
$gltf = [System.Text.Encoding]::UTF8.GetString($sourceBytes, 20, $jsonLength) | ConvertFrom-Json
$binaryStart = 20 + $jsonLength + 8
$imageViews = @{}
foreach ($image in $gltf.images) { $imageViews[[int]$image.bufferView] = $image.mimeType }

$binary = [System.IO.MemoryStream]::new()
try {
    for ($index = 0; $index -lt $gltf.bufferViews.Count; $index++) {
        $view = $gltf.bufferViews[$index]
        $offset = if ($null -eq $view.byteOffset) { 0 } else { [int]$view.byteOffset }
        $length = [int]$view.byteLength
        if ($null -eq $view.byteOffset) {
            $view | Add-Member -NotePropertyName byteOffset -NotePropertyValue ([int]$binary.Length)
        } else {
            $view.byteOffset = [int]$binary.Length
        }

        if ($imageViews.ContainsKey($index)) {
            $inputStream = [System.IO.MemoryStream]::new($sourceBytes, $binaryStart + $offset, $length, $false)
            $image = [System.Drawing.Image]::FromStream($inputStream)
            try {
                $limit = if ($imageViews[$index] -eq 'image/jpeg' -and $index -in @(0, 6)) { 2048 } else { 1024 }
                if ([Math]::Max($image.Width, $image.Height) -gt $limit) {
                    $factor = $limit / [double][Math]::Max($image.Width, $image.Height)
                    $width = [int][Math]::Round($image.Width * $factor)
                    $height = [int][Math]::Round($image.Height * $factor)
                    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                    $outputStream = [System.IO.MemoryStream]::new()
                    try {
                        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                        $graphics.DrawImage($image, 0, 0, $width, $height)
                        if ($imageViews[$index] -eq 'image/jpeg') {
                            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                                Where-Object MimeType -eq 'image/jpeg' | Select-Object -First 1
                            $quality = [System.Drawing.Imaging.EncoderParameters]::new(1)
                            try {
                                $quality.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
                                    [System.Drawing.Imaging.Encoder]::Quality, [long]88)
                                $bitmap.Save($outputStream, $codec, $quality)
                            } finally { $quality.Dispose() }
                        } else {
                            $bitmap.Save($outputStream, [System.Drawing.Imaging.ImageFormat]::Png)
                        }
                        $converted = $outputStream.ToArray()
                        $binary.Write($converted, 0, $converted.Length)
                        $view.byteLength = $converted.Length
                    } finally {
                        $outputStream.Dispose()
                        $graphics.Dispose()
                        $bitmap.Dispose()
                    }
                } else {
                    $binary.Write($sourceBytes, $binaryStart + $offset, $length)
                }
            } finally {
                $image.Dispose()
                $inputStream.Dispose()
            }
        } else {
            $binary.Write($sourceBytes, $binaryStart + $offset, $length)
        }

        while ($binary.Length % 4) { $binary.WriteByte(0) }
    }

    $gltf.buffers[0].byteLength = [int]$binary.Length
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes(($gltf | ConvertTo-Json -Depth 100 -Compress))
    $jsonPadding = (4 - ($jsonBytes.Length % 4)) % 4
    $totalLength = 12 + 8 + $jsonBytes.Length + $jsonPadding + 8 + $binary.Length

    $file = [System.IO.File]::Create($Destination)
    $writer = [System.IO.BinaryWriter]::new($file)
    try {
        $writer.Write([uint32]0x46546C67) # glTF
        $writer.Write([uint32]2)
        $writer.Write([uint32]$totalLength)
        $writer.Write([uint32]($jsonBytes.Length + $jsonPadding))
        $writer.Write([uint32]0x4E4F534A) # JSON
        $writer.Write($jsonBytes)
        for ($pad = 0; $pad -lt $jsonPadding; $pad++) { $writer.Write([byte]32) }
        $writer.Write([uint32]$binary.Length)
        $writer.Write([uint32]0x004E4942) # BIN
        $binary.WriteTo($file)
    } finally {
        $writer.Dispose()
    }
} finally {
    $binary.Dispose()
}

Write-Output "Optimized shuttle: $([Math]::Round($sourceBytes.Length / 1MB, 1)) MB -> $([Math]::Round((Get-Item $Destination).Length / 1MB, 1)) MB"
