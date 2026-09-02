param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath,

  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = "Stop"

function ConvertTo-PlainValue($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [System.Array]) {
    $flat = @()
    foreach ($item in $value) { $flat += ConvertTo-PlainValue $item }
    return $flat
  }
  return $value
}

function Convert-InputValue($inputItem) {
  if ($null -eq $inputItem.value) { return $null }
  if ($inputItem.type -eq "number") { return [double]$inputItem.value }
  if ($inputItem.type -eq "date" -and $inputItem.value -match "^\d{4}-\d{2}-\d{2}$") {
    $date = [datetime]::ParseExact($inputItem.value, "yyyy-MM-dd", $null)
    return $date.ToOADate()
  }
  return [string]$inputItem.value
}

function Read-RangeOutput($range, $format) {
  if ($format -eq "sum-currency") {
    $total = 0
    $values = $range.Value2
    if ($values -is [System.Array]) {
      foreach ($value in $values) {
        if ($null -ne $value -and $value -is [double]) { $total += $value }
        elseif ($null -ne $value -and "$value" -match "^-?\d+(\.\d+)?$") { $total += [double]$value }
      }
    }
    elseif ($null -ne $values) {
      $total = [double]$values
    }
    return @{ value = $total; text = $total.ToString("0.00") }
  }

  return @{ value = ConvertTo-PlainValue $range.Value2; text = $range.Text }
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
  if ([bool]$payload.allowMacros) {
    $excel.AutomationSecurity = 1
  }
  else {
    $excel.AutomationSecurity = 3
  }

  $workbook = $excel.Workbooks.Open($WorkbookPath)

  foreach ($inputItem in $payload.inputs) {
    $sheet = $workbook.Worksheets.Item($inputItem.sheet)
    $sheet.Range($inputItem.cell).Value2 = Convert-InputValue $inputItem
  }

  $excel.CalculateFullRebuild()

  $results = @{}
  foreach ($outputItem in $payload.outputs) {
    $sheet = $workbook.Worksheets.Item($outputItem.sheet)
    $range = $sheet.Range($outputItem.cell)
    $read = Read-RangeOutput $range $outputItem.format
    $results[$outputItem.id] = @{
      label = $outputItem.label
      sheet = $outputItem.sheet
      cell = $outputItem.cell
      value = $read.value
      text = $read.text
      format = $outputItem.format
    }
  }

  $workbook.Close($false)
  $workbook = $null

  [pscustomobject]@{ ok = $true; results = $results } | ConvertTo-Json -Depth 10 -Compress
}
catch {
  if ($workbook -ne $null) { $workbook.Close($false) }
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 10 -Compress
  exit 1
}
finally {
  if ($excel -ne $null) { $excel.Quit() }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
