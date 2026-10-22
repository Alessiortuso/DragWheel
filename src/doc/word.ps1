# Ponte con Microsoft Word (automazione COM), usato per il PDF fedele all'originale e per unire i documenti.
# Uso: powershell -File word.ps1 -Op pdf|merge -Json <file.json>
# Se Word è già aperto lo si usa senza chiuderlo; se non lo è, si avvia invisibile e si chiude a fine lavoro.
param([string]$Op, [string]$Json)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $Json -Raw -Encoding UTF8 | ConvertFrom-Json

$wasRunning = $false
try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application'); $wasRunning = $true }
catch { $word = New-Object -ComObject Word.Application; $word.Visible = $false }
$oldAlerts = $word.DisplayAlerts
$opened = @()
try {
  $word.DisplayAlerts = 0
  $m = [Type]::Missing
  # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, ..., Revert, ..., Visible
  function Open-Doc($path) { $word.Documents.Open($path, $false, $true, $false, $m, $m, $false, $m, $m, $m, $m, $false) }

  if ($Op -eq 'pdf') {
    $doc = Open-Doc $cfg.input; $opened += $doc
    # OutputFileName, wdExportFormatPDF, OpenAfterExport, OptimizeFor, Range, From, To, Item, IncludeDocProps, KeepIRM, CreateBookmarks(titoli)
    $doc.ExportAsFixedFormat($cfg.output, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1)
  }
  elseif ($Op -eq 'merge') {
    $new = $word.Documents.Add(); $opened += $new
    $i = 0
    foreach ($f in $cfg.files) {
      if ($i -gt 0 -and $cfg.pageBreak) { $r = $new.Content; $r.Collapse(0); $r.InsertBreak(7) }   # wdPageBreak
      $r = $new.Content; $r.Collapse(0)                                                           # wdCollapseEnd
      $r.InsertFile($f, '', $false, $false, $false)
      $i++
    }
    $new.SaveAs2($cfg.output, 16)                                                                 # wdFormatXMLDocument (docx)
  }
  else { throw "operazione sconosciuta: $Op" }
  @{ ok = $true } | ConvertTo-Json -Compress
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
finally {
  foreach ($d in $opened) { try { $d.Close([ref]0) } catch {} }          # 0 = senza salvare
  try { $word.DisplayAlerts = $oldAlerts } catch {}
  if (-not $wasRunning) { try { $word.Quit([ref]0) } catch {} }
  try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) } catch {}
}
