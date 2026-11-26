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
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class WinTitleHelper {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int dwProcessId);

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

    private static string ExpectedProcName(string appId, string platform) {
        string a = (appId ?? "").ToLowerInvariant();
        if (a.Contains("spotify") || platform == "spotify") return "spotify";
        if (a.Contains("vlc") || platform == "vlc") return "vlc";
        if (a.Contains("applemusic") || platform == "apple") return "applemusic";
        if (a.Contains("msedge") || a.Contains("edge")) return "msedge";
        if (a.Contains("chrome") || a.Contains("cinhimbnkkaeohfgghhklpknlkffjgod")) return "chrome";
        if (a.Contains("firefox")) return "firefox";
        if (a.Contains("brave")) return "brave";
        if (a.Contains("opera")) return "opera";
        if (a.Contains("vivaldi")) return "vivaldi";
        int bang = a.IndexOf('!');
        string basePart = bang > 0 ? a.Substring(0, bang) : a;
        int slash = Math.Max(basePart.LastIndexOf('\\'), basePart.LastIndexOf('/'));
        if (slash >= 0) basePart = basePart.Substring(slash + 1);
        if (basePart.EndsWith(".exe")) basePart = basePart.Substring(0, basePart.Length - 4);
        return basePart;
    }

    private static void FocusHwnd(IntPtr hwnd) {
        AllowSetForegroundWindow(-1);
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
        else ShowWindow(hwnd, 5);
        IntPtr fg = GetForegroundWindow();
        uint dummy;
        uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
        uint tgtThread = GetWindowThreadProcessId(hwnd, out dummy);
        uint curThread = GetCurrentThreadId();
        bool attFg = (fgThread != 0 && fgThread != curThread) && AttachThreadInput(curThread, fgThread, true);
        bool attTgt = (tgtThread != 0 && tgtThread != curThread && tgtThread != fgThread) && AttachThreadInput(curThread, tgtThread, true);
        try {
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            SwitchToThisWindow(hwnd, true);
        } finally {
            if (attTgt) AttachThreadInput(curThread, tgtThread, false);
            if (attFg) AttachThreadInput(curThread, fgThread, false);
        }
    }

    public static bool FindAndFocus(string appId, string title, string platform) {
        string expProc = ExpectedProcName(appId, platform);
        string tLow = (title ?? "").Trim().ToLowerInvariant();
        string pLow = (platform ?? "").Trim().ToLowerInvariant();
        IntPtr bestHwnd = IntPtr.Zero;
        int bestScore = 0;

        EnumWindows((hwnd, lp) => {
            if (!IsWindowVisible(hwnd)) return true;
            int len = GetWindowTextLength(hwnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hwnd, sb, sb.Capacity);
            string wt = sb.ToString().Trim();
            if (wt.Length == 0) return true;
            string wLow = wt.ToLowerInvariant();

            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            string procName = "";
            try {
                if (pid != 0) procName = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
            } catch {}

            if (procName == "agydesk" || procName == "msedgewebview2" || procName == "powershell" || procName == "pwsh") return true;

            int score = 0;
            bool procMatch = expProc.Length >= 2 && (procName == expProc || procName.Contains(expProc));
            if (procMatch) score += 40;
            if (tLow.Length >= 3 && wLow.Contains(tLow)) score += 100;
            if (pLow == "ytmusic" && wLow.Contains("youtube music")) score += 80;
            else if (pLow == "youtube" && wLow.Contains("youtube")) score += 80;
            else if (pLow == "spotify" && (wLow.Contains("spotify") || procName == "spotify")) score += 80;
            else if (pLow == "soundcloud" && wLow.Contains("soundcloud")) score += 80;

            if (score > bestScore) {
                bestScore = score;
                bestHwnd = hwnd;
            }
            return true;
        }, IntPtr.Zero);

        if (bestScore >= 40 && bestHwnd != IntPtr.Zero) {
            FocusHwnd(bestHwnd);
            return true;
        }
        return false;
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject {}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public static class AudioVolHelper {
    private static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    private static IAudioEndpointVolume GetEndpoint(out IMMDeviceEnumerator enumerator, out IMMDevice device) {
        enumerator = null;
        device = null;
        enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        if (hr != 0 || device == null) {
            hr = enumerator.GetDefaultAudioEndpoint(0, 0, out device);
        }
        if (hr != 0 || device == null) return null;
        Guid iid = IID_IAudioEndpointVolume;
        object obj;
        hr = device.Activate(ref iid, 23u, IntPtr.Zero, out obj);
        if (hr != 0 || obj == null) return null;
        return obj as IAudioEndpointVolume;
    }

    private static void ReleaseAll(object a, object b, object c) {
        try { if (a != null) Marshal.ReleaseComObject(a); } catch {}
        try { if (b != null) Marshal.ReleaseComObject(b); } catch {}
        try { if (c != null) Marshal.ReleaseComObject(c); } catch {}
    }

    public static int[] Get() {
        IMMDeviceEnumerator en = null;
        IMMDevice dev = null;
        IAudioEndpointVolume ep = null;
        try {
            ep = GetEndpoint(out en, out dev);
            if (ep == null) return null;
            float scalar = 0f;
            bool muted = false;
            if (ep.GetMasterVolumeLevelScalar(out scalar) != 0) return null;
            ep.GetMute(out muted);
            int pct = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100.0)));
            return new int[] { pct, muted ? 1 : 0 };
        } catch {
            return null;
        } finally {
            ReleaseAll(ep, dev, en);
        }
    }

    public static int[] Set(int level, int muteMode) {
        IMMDeviceEnumerator en = null;
        IMMDevice dev = null;
        IAudioEndpointVolume ep = null;
        try {
            ep = GetEndpoint(out en, out dev);
            if (ep == null) return null;
            Guid ctx = Guid.Empty;
            bool curMute = false;
            ep.GetMute(out curMute);

            if (muteMode == 2) {
                ep.SetMute(!curMute, ref ctx);
                curMute = !curMute;
            } else if (muteMode == 1) {
                ep.SetMute(true, ref ctx);
                curMute = true;
            } else if (muteMode == 0) {
                ep.SetMute(false, ref ctx);
                curMute = false;
            }

            if (level >= 0) {
                int clamped = Math.Max(0, Math.Min(100, level));
                ep.SetMasterVolumeLevelScalar(clamped / 100.0f, ref ctx);
                if (clamped > 0 && muteMode < 0 && curMute) {
                    ep.SetMute(false, ref ctx);
                }
            }

            float scalar = 0f;
            bool muted = false;
            ep.GetMasterVolumeLevelScalar(out scalar);
            ep.GetMute(out muted);
            int pct = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100.0)));
            return new int[] { pct, muted ? 1 : 0 };
        } catch {
            return null;
        } finally {
            ReleaseAll(ep, dev, en);
        }
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
        if ($null -eq $winTitles) { $winTitles = [WinTitleHelper]::VisibleTitles() }
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
    $winTitles = $null
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
            $posMs = 0L
            $durMs = 0L
            try {
                $tl = $s.GetTimelineProperties()
                if ($tl) {
                    $durSec = [Math]::Max(0.0, $tl.EndTime.TotalSeconds)
                    $posSec = [Math]::Max(0.0, $tl.Position.TotalSeconds)
                    if ($isPlay -and $tl.LastUpdatedTime.Year -gt 1970) {
                        $elapsed = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
                        if ($elapsed -gt 0 -and $elapsed -lt 3600) { $posSec += $elapsed }
                    }
                    if ($durSec -gt 0 -and $posSec -gt $durSec) { $posSec = $durSec }
                    $posMs = [long][Math]::Round($posSec * 1000.0)
                    $durMs = [long][Math]::Round($durSec * 1000.0)
                }
            } catch {}
            $item = [ordered]@{
                app = $appId
                platform = $plat[0]
                platform_label = $plat[1]
                title = $title
                artist = $artist
                album = $album
                playing = $isPlay
                status = $st
                position_ms = $posMs
                duration_ms = $durMs
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

    $av = Get-AudioVol
    if ($best) {
        $best['thumbnail'] = $bestThumb
        return [ordered]@{ ok = $true; active = $best; sessions = $list; volume = $av.volume; muted = $av.muted }
    }
    return [ordered]@{ ok = $true; active = $null; sessions = @(); volume = $av.volume; muted = $av.muted }
}

function Get-AudioVol {
    try {
        $v = [AudioVolHelper]::Get()
        if ($null -ne $v -and $v.Length -ge 2) {
            return @{ volume = [int]$v[0]; muted = ($v[1] -ne 0) }
        }
    } catch {}
    return @{ volume = $null; muted = $false }
}

function Invoke-MediaCmd($action, $targetApp, $positionMs) {
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
        'seek'      {
            if ($null -eq $positionMs) { return [ordered]@{ ok = $false; error = 'position_ms gerekli' } }
            $ticks = [long]([Math]::Max(0L, [long]$positionMs) * 10000L)
            $res = Await-Op ($target.TryChangePlaybackPositionAsync($ticks)) ([bool])
        }
        default     { return [ordered]@{ ok = $false; error = "Gecersiz komut: $action" } }
    }
    return [ordered]@{ ok = $true; handled = $res; app = $target.SourceAppUserModelId }
}

function Invoke-MediaOpen($targetApp, $title, $platform) {
    $a = ($targetApp + '').Trim()
    $t = ($title + '').Trim()
    $p = ($platform + '').Trim().ToLowerInvariant()
    try {
        if ([WinTitleHelper]::FindAndFocus($a, $t, $p)) {
            return [ordered]@{ ok = $true; method = 'focus' }
        }
    } catch {}
    try {
        if ($a -match 'spotify' -or $p -eq 'spotify') {
            try { Start-Process 'spotify:'; return [ordered]@{ ok = $true; method = 'uri' } } catch {}
            if ($a -match '!') { Start-Process "shell:AppsFolder\$a"; return [ordered]@{ ok = $true; method = 'aumid' } }
            Start-Process 'https://open.spotify.com'
            return [ordered]@{ ok = $true; method = 'web' }
        }
        if ($a -match '!' -or $a -match '_crx_') {
            Start-Process "shell:AppsFolder\$a"
            return [ordered]@{ ok = $true; method = 'aumid' }
        }
        if ($p -eq 'ytmusic') { Start-Process 'https://music.youtube.com'; return [ordered]@{ ok = $true; method = 'web' } }
        if ($p -eq 'youtube') { Start-Process 'https://www.youtube.com'; return [ordered]@{ ok = $true; method = 'web' } }
        if ($p -eq 'soundcloud') { Start-Process 'https://soundcloud.com'; return [ordered]@{ ok = $true; method = 'web' } }
        if ($a) {
            Start-Process $a
            return [ordered]@{ ok = $true; method = 'launch' }
        }
    } catch {
        return [ordered]@{ ok = $false; error = $_.Exception.Message }
    }
    return [ordered]@{ ok = $false; error = 'Medya uygulaması açılamadı' }
}

function Invoke-VolumeCmd($vol, $muted, $toggleMute) {
    $lvl = -1
    if ($null -ne $vol) {
        try { $lvl = [int][Math]::Max(0, [Math]::Min(100, [int]$vol)) } catch { $lvl = -1 }
    }
    $mMode = -1
    if ($toggleMute -eq $true) {
        $mMode = 2
    } elseif ($null -ne $muted) {
        $mMode = if ([bool]$muted) { 1 } else { 0 }
    }
    try {
        $v = [AudioVolHelper]::Set($lvl, $mMode)
        if ($null -ne $v -and $v.Length -ge 2) {
            return [ordered]@{ ok = $true; volume = [int]$v[0]; muted = ($v[1] -ne 0) }
        }
    } catch {
        return [ordered]@{ ok = $false; error = $_.Exception.Message }
    }
    return [ordered]@{ ok = $false; error = 'Ses aygıtı bulunamadı' }
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
            $out = Invoke-MediaCmd $req.action $req.app $req.position_ms
        } elseif ($req.op -eq 'open') {
            $out = Invoke-MediaOpen $req.app $req.title $req.platform
        } elseif ($req.op -eq 'volume') {
            $out = Invoke-VolumeCmd $req.volume $req.muted $req.toggle_mute
        } else {
            $out = [ordered]@{ ok = $false; error = 'Bilinmeyen op' }
        }
        [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
    } catch {
        [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
    [Console]::Out.Flush()
}
