param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath,

  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = "Stop"

function Convert-Color($oleColor) {
  if ($null -eq $oleColor -or [int]$oleColor -lt 0) { return $null }
  $value = [int]$oleColor
  $r = $value -band 255
  $g = ($value -shr 8) -band 255
  $b = ($value -shr 16) -band 255
  return ("#{0:X2}{1:X2}{2:X2}" -f $r, $g, $b)
}

function Parse-CellRef($ref) {
  $m = [regex]::Match($ref, "^([A-Z]+)(\d+)$")
  $col = 0
  foreach ($ch in $m.Groups[1].Value.ToCharArray()) {
    $col = $col * 26 + ([int][char]$ch - [int][char]'A' + 1)
  }
  return @{ Col = $col; Row = [int]$m.Groups[2].Value }
}

function Convert-InputValue($item) {
  if ($null -eq $item.value) { return $null }
  if ($item.value -is [string] -and $item.value -eq "") { return "" }
  if ($item.type -eq "number") { return [double]$item.value }
  if ($item.type -eq "date" -and $item.value -match "^\d{4}-\d{2}-\d{2}$") {
    $date = [datetime]::ParseExact($item.value, "yyyy-MM-dd", $null)
    return $date.ToOADate()
  }
  return [string]$item.value
}

function Read-Cell($range, $rowOffset, $colOffset, $editableSet, $sheetName) {
  $cell = $range.Cells.Item($rowOffset, $colOffset)
  $address = $cell.Address($false, $false)
  $key = "$sheetName!$address"
  $mergeArea = $cell.MergeArea
  $isMergeChild = $cell.MergeCells -and ($mergeArea.Cells.Item(1, 1).Address($false, $false) -ne $address)
  if ($isMergeChild) { return $null }

  $fontColor = Convert-Color $cell.Font.Color
  $fillColor = Convert-Color $cell.Interior.Color
  $borderColor = Convert-Color $cell.Borders.Item(7).Color
  $formula = ""
  try { $formula = [string]$cell.Formula } catch { $formula = "" }

  return @{
    address = $address
    row = $cell.Row
    col = $cell.Column
    text = [string]$cell.Text
    value = $cell.Value2
    formula = $formula
    editable = $editableSet.Contains($key)
    rowSpan = if ($cell.MergeCells) { $mergeArea.Rows.Count } else { 1 }
    colSpan = if ($cell.MergeCells) { $mergeArea.Columns.Count } else { 1 }
    style = @{
      background = $fillColor
      color = $fontColor
      borderColor = $borderColor
      bold = [bool]$cell.Font.Bold
      italic = [bool]$cell.Font.Italic
      fontSize = [double]$cell.Font.Size
      horizontal = [int]$cell.HorizontalAlignment
      vertical = [int]$cell.VerticalAlignment
      wrap = [bool]$cell.WrapText
      numberFormat = [string]$cell.NumberFormat
    }
  }
}

$payloadText = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
$payload = $payloadText | ConvertFrom-Json
$excel = $null
$workbook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = [bool]$payload.allowMacros
  if ([bool]$payload.allowMacros) { $excel.AutomationSecurity = 1 } else { $excel.AutomationSecurity = 3 }
  $workbook = $excel.Workbooks.Open($WorkbookPath)

  foreach ($edit in $payload.edits) {
    try {
      $sheet = $workbook.Worksheets.Item($edit.sheet)
      $sheet.Range($edit.cell).Value2 = Convert-InputValue $edit
    }
    catch {
      throw "Falha ao escrever em '$($edit.sheet)!$($edit.cell)': $($_.Exception.Message)"
    }
  }

  $excel.CalculateFullRebuild()

  $editableSet = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($item in $payload.editableCells) { [void]$editableSet.Add([string]$item) }

  $views = @()
  foreach ($view in $payload.views) {
    try {
      $sheet = $workbook.Worksheets.Item($view.sheet)
      $range = $sheet.Range($view.range)
    }
    catch {
      throw "Falha ao abrir a vista '$($view.label)' em '$($view.sheet)!$($view.range)': $($_.Exception.Message)"
    }
    $cells = @()
    for ($r = 1; $r -le $range.Rows.Count; $r++) {
      $rowCells = @()
      for ($c = 1; $c -le $range.Columns.Count; $c++) {
        $cellData = Read-Cell $range $r $c $editableSet $view.sheet
        if ($null -ne $cellData) { $rowCells += $cellData }
      }
      $cells += ,@($rowCells)
    }
    $views += @{ id = $view.id; label = $view.label; sheet = $view.sheet; range = $view.range; cells = $cells }
  }

  $results = @{}
  foreach ($outputItem in $payload.outputs) {
    try {
      $sheet = $workbook.Worksheets.Item($outputItem.sheet)
      $range = $sheet.Range($outputItem.cell)
    }
    catch {
      throw "Falha ao ler resultado '$($outputItem.label)' em '$($outputItem.sheet)!$($outputItem.cell)': $($_.Exception.Message)"
    }
    $value = $range.Value2
    if ($outputItem.format -eq "sum-currency") {
      $total = 0
      if ($value -is [System.Array]) {
        foreach ($v in $value) { if ($null -ne $v -and "$v" -match "^-?\d+(\.\d+)?$") { $total += [double]$v } }
      } elseif ($null -ne $value) { $total = [double]$value }
      $value = $total
    }
    $results[$outputItem.id] = @{ label = $outputItem.label; sheet = $outputItem.sheet; cell = $outputItem.cell; value = $value; text = [string]$range.Text; format = $outputItem.format }
  }

  $workbook.Close($false)
  $workbook = $null
  [pscustomobject]@{ ok = $true; views = $views; results = $results } | ConvertTo-Json -Depth 20 -Compress
}
catch {
  if ($workbook -ne $null) { $workbook.Close($false) }
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 20 -Compress
  exit 1
}
finally {
  if ($excel -ne $null) { $excel.Quit() }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
