import os
import subprocess
import glob

# Check PowerPoint COM via powershell script file
ps_script = r"""
$ErrorActionPreference = "Stop"
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue

$sourceDir = "C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault\Katihal_Elektronigi\Kaynaklar"
$targetDir1 = "C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault\Katihal_Elektronigi\_ekler"
$targetDir2 = "C:\Users\cavit\Desktop\Katihal_Elektronigi_Vault\_ekler"

$files = Get-ChildItem -Path $sourceDir -Include *.ppsx, *.pptx -Recurse

foreach ($file in $files) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $pdfPath1 = Join-Path $targetDir1 ($baseName + ".pdf")
    $pdfPath2 = Join-Path $targetDir2 ($baseName + ".pdf")
    
    if (-not (Test-Path $pdfPath1)) {
        Write-Host "Converting: $($file.Name)"
        $presentation = $ppt.Presentations.Open($file.FullName, [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
        # 32 = ppSaveAsPDF
        $presentation.SaveAs($pdfPath1, 32)
        $presentation.Close()
        Copy-Item -Path $pdfPath1 -Destination $pdfPath2 -Force
        Write-Host "Saved: $pdfPath1"
    } else {
        Write-Host "Already exists: $pdfPath1"
    }
}

$ppt.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
Write-Host "TUM_CONVERT_TAMAMLANDI"
"""

with open(r"C:\Users\cavit\ai-workstation\convert_ppt.ps1", "w", encoding="utf-8") as f:
    f.write(ps_script)

print("ps1 script oluşturuldu.")
