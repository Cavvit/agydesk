$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$tRas = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$tRasCt = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStream', [type[]]@($tRas))

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinTitleHelper {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);

    public static List<string> VisibleTitles() {
        var list = new List<string>();
        EnumWindows((hwnd, lp) => {
            if (!IsWindowVisible(hwnd)) return true;
            int len = GetWindowTextLength(hwnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hwnd, sb, sb.Capacity);
            string t = sb.ToString().Trim();
            if (t.Length > 0) list.Add(t);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethodDefinition })[0]
$asTaskPlain = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethodDefinition })[0]

function Await-Op($op, $type) {
    $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)).GetAwaiter().GetResult()
}

function Await-Action($op) {
    $asTaskPlain.Invoke($null, @($op)).GetAwaiter().GetResult()
}

$mgr = Await-Op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$script:thumbCache = @{}
$script:thumbOrder = New-Object System.Collections.Generic.List[string]
$script:appLastThumb = @{}
$script:platCache = @{}

function Save-ThumbCache($appId, $title, $key, $dataUri) {
    if (-not $dataUri) { return }
    if (-not $script:thumbCache.ContainsKey($key)) {
        $script:thumbOrder.Add($key)
        while ($script:thumbOrder.Count -gt 24) {
            $old = $script:thumbOrder[0]
            $script:thumbOrder.RemoveAt(0)
            $script:thumbCache.Remove($old)
        }
    }
    $script:thumbCache[$key] = $dataUri
    if ($appId) {
        $script:appLastThumb[$appId] = @{ title = $title; data = $dataUri }
    }
}

function Get-ThumbDataUri($thumbRef, $appId, $title, $artist) {
    $key = "$appId|$title|$artist"
    $titleKey = "$appId|$title|"
    if ($script:thumbCache.ContainsKey($key) -and $script:thumbCache[$key]) {
        return $script:thumbCache[$key]
    }
    if ($thumbRef) {
        try {
            $stream = Await-Op ($thumbRef.OpenReadAsync()) $tRasCt
            if ($stream) {
                $net = $asStreamMethod.Invoke($null, @($stream))
                $ms = New-Object System.IO.MemoryStream
                $net.CopyTo($ms)
                $bytes = $ms.ToArray()
                $ms.Dispose()
                $net.Dispose()
                if ($bytes.Length -gt 0 -and $bytes.Length -le 2097152) {
                    $ct = if ($bytes.Length -ge 4 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { 'image/png' } else { 'image/jpeg' }
                    $uri = "data:$ct;base64," + [Convert]::ToBase64String($bytes)
                    Save-ThumbCache $appId $title $key $uri
                    Save-ThumbCache $appId $title $titleKey $uri
                    return $uri
                }
            }
        } catch {}
    }
    if ($script:thumbCache.ContainsKey($titleKey) -and $script:thumbCache[$titleKey]) {
        return $script:thumbCache[$titleKey]
    }
    if ($appId -and $script:appLastThumb.ContainsKey($appId)) {
        $last = $script:appLastThumb[$appId]
        if ($last -and $last.data -and (-not $title -or $last.title -eq $title)) {
            return $last.data
        }
    }
    return ''
}

function Detect-Platform($appId, $title, $artist, $winTitles) {
    $a = ($appId + '').ToLowerInvariant()
    $meta = (($title + ' ' + $artist) + '').ToLowerInvariant()
    if ($a -match 'spotify') { return @('spotify', 'Spotify') }
    if ($a -match 'cinhimbnkkaeohfgghhklpknlkffjgod' -or $a -match 'youtube\s*music') { return @('ytmusic', 'YouTube Music') }
    if ($a -match 'youtube') { return @('youtube', 'YouTube') }
    if ($a -match 'vlc') { return @('vlc', 'VLC') }
    if ($a -match 'soundcloud') { return @('soundcloud', 'SoundCloud') }
    if ($a -match 'applemusic|itunes') { return @('apple', 'Apple Music') }
    $isBrowser = ($a -match 'chrome|msedge|edge|firefox|brave|opera|vivaldi')
    if ($isBrowser) {
        $tLow = ($title + '').ToLowerInvariant()
        foreach ($wt in $winTitles) {
            $wLow = $wt.ToLowerInvariant()
            if ($tLow.Length -ge 3 -and $wLow.Contains($tLow)) {
                if ($wLow -match 'youtube music') { return @('ytmusic', 'YouTube Music') }
                if ($wLow -match 'youtube') { return @('youtube', 'YouTube') }
                if ($wLow -match 'spotify') { return @('spotify', 'Spotify Web') }
                if ($wLow -match 'soundcloud') { return @('soundcloud', 'SoundCloud') }
            }
        }
        foreach ($wt in $winTitles) {
            $wLow = $wt.ToLowerInvariant()
            if ($wLow -match ' - youtube music') { return @('ytmusic', 'YouTube Music') }
            if ($wLow -match ' - youtube') { return @('youtube', 'YouTube') }
            if ($wLow -match 'spotify - web player') { return @('spotify', 'Spotify Web') }
            if ($wLow -match 'soundcloud') { return @('soundcloud', 'SoundCloud') }
        }
        if ($meta -match 'youtube music') { return @('ytmusic', 'YouTube Music') }
        if ($meta -match 'youtube') { return @('youtube', 'YouTube') }
        return @('browser', 'Tarayıcı')
    }
    if ($a.Length -gt 0) { return @('media', 'PC Medya') }
    return @('idle', 'Medya Yok')
}

function Get-StatusObj($targetApp) {
    $sessions = $mgr.GetSessions()
    $cur = $mgr.GetCurrentSession()
    $winTitles = [WinTitleHelper]::VisibleTitles()
    $list = @()
    $best = $null
    $bestIsPlaying = $false
    $bestThumb = ''
    $matchedTarget = $false

    foreach ($s in $sessions) {
        try {
            $pb = $s.GetPlaybackInfo()
            $st = $pb.PlaybackStatus.ToString()
            $isPlay = ($st -eq 'Playing')
            $props = Await-Op ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $title = ($props.Title + '').Trim()
            $artist = ($props.Artist + '').Trim()
            $album = ($props.AlbumTitle + '').Trim()
            $appId = ($s.SourceAppUserModelId + '').Trim()
            if (-not $title -and -not $artist) { continue }
            $plat = Detect-Platform $appId $title $artist $winTitles
            $pKey = "$appId|$title"
            if ($plat[0] -eq 'browser' -and $title -and $script:platCache.ContainsKey($pKey)) {
                $plat = $script:platCache[$pKey]
            } elseif ($plat[0] -ne 'browser' -and $plat[0] -ne 'idle' -and $title) {
                $script:platCache[$pKey] = $plat
            }
            $thumb = Get-ThumbDataUri $props.Thumbnail $appId $title $artist
            $item = [ordered]@{
                app = $appId
                platform = $plat[0]
                platform_label = $plat[1]
                title = $title
                artist = $artist
                album = $album
                playing = $isPlay
                status = $st
            }
            $list += $item
            if ($targetApp -and $appId -eq $targetApp) {
                $best = $item
                $bestThumb = $thumb
                $matchedTarget = $true
            } elseif (-not $matchedTarget) {
                $isCur = ($cur -and $cur.SourceAppUserModelId -eq $appId)
                if (-not $best -or ($isPlay -and -not $bestIsPlaying) -or ($isPlay -eq $bestIsPlaying -and $isCur)) {
                    $best = $item
                    $bestIsPlaying = $isPlay
                    $bestThumb = $thumb
                }
            }
        } catch {}
    }

    if ($best) {
        $best['thumbnail'] = $bestThumb
        return [ordered]@{ ok = $true; active = $best; sessions = $list }
    }
    return [ordered]@{ ok = $true; active = $null; sessions = @() }
}

function Invoke-MediaCmd($action, $targetApp) {
    $sessions = $mgr.GetSessions()
    $target = $null
    if ($targetApp) {
        foreach ($s in $sessions) {
            if ($s.SourceAppUserModelId -eq $targetApp) { $target = $s; break }
        }
    }
    if (-not $target) {
        foreach ($s in $sessions) {
            if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $target = $s; break }
        }
    }
    if (-not $target) { $target = $mgr.GetCurrentSession() }
    if (-not $target) { return [ordered]@{ ok = $false; error = 'Aktif medya oturumu yok' } }

    $res = $false
    switch ($action) {
        'playpause' { $res = Await-Op ($target.TryTogglePlayPauseAsync()) ([bool]) }
        'next'      { $res = Await-Op ($target.TrySkipNextAsync()) ([bool]) }
        'prev'      { $res = Await-Op ($target.TrySkipPreviousAsync()) ([bool]) }
        default     { return [ordered]@{ ok = $false; error = "Gecersiz komut: $action" } }
    }
    return [ordered]@{ ok = $true; handled = $res; app = $target.SourceAppUserModelId }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if (-not $line) { continue }
    try {
        $req = $line | ConvertFrom-Json
        if ($req.op -eq 'status') {
            $out = Get-StatusObj $req.app
        } elseif ($req.op -eq 'cmd') {
            $out = Invoke-MediaCmd $req.action $req.app
        } else {
            $out = [ordered]@{ ok = $false; error = 'Bilinmeyen op' }
        }
        [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
    } catch {
        [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
    [Console]::Out.Flush()
}
